import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  getRuntimeFileChangeImpact,
  recordRuntimeFileChangeImpact,
  shouldInvalidateVerifierForRuntimeEvent,
} from "./GedWorkflowEventReactor.ts";

const fileChangeEvent = (payload: {
  readonly detail?: string;
  readonly data?: unknown;
  readonly itemType?: string;
  readonly turnId?: string;
}): ProviderRuntimeEvent =>
  ({
    eventId: "event-1",
    provider: "codex",
    threadId: "thread-1",
    createdAt: "2026-06-03T00:00:00.000Z",
    turnId: payload.turnId,
    type: "item.completed",
    payload: {
      itemType: payload.itemType ?? "file_change",
      detail: payload.detail,
      data: payload.data,
    },
  }) as ProviderRuntimeEvent;

describe("shouldInvalidateVerifierForRuntimeEvent", () => {
  it("skips dot-directory-only file changes", () => {
    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ detail: ".ged/runtime/root/checkpoints.json" }),
      ),
    ).toBe(false);
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: ".git/index" }))).toBe(
      false,
    );
    expect(
      shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: "src/.cache/state.json" })),
    ).toBe(false);
  });

  it("invalidates normal and hidden-file changes", () => {
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: "src/app.ts" }))).toBe(
      true,
    );
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: ".env" }))).toBe(true);
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: ".gitignore" }))).toBe(
      true,
    );
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: "src/.env" }))).toBe(
      true,
    );
  });

  it("extracts nested provider-neutral path keys", () => {
    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ data: { item: { path: ".ged/runtime/root/checkpoints.json" } } }),
      ),
    ).toBe(false);

    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ data: { input: { file_path: "src/app.ts" } } }),
      ),
    ).toBe(true);

    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ data: { input: { old_path: ".ged/old", new_path: ".ged/new" } } }),
      ),
    ).toBe(false);
  });

  it("invalidates mixed dot-directory and normal source paths", () => {
    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ data: { files: [".ged/runtime/root/checkpoints.json", "src/app.ts"] } }),
      ),
    ).toBe(true);

    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({
          detail: ".ged/runtime/root/checkpoints.json",
          data: { input: { newPath: "src/app.ts" } },
        }),
      ),
    ).toBe(true);
  });

  it("fails safe for ambiguous or missing path data", () => {
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({}))).toBe(true);
    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ detail: "Updated checkpoint metadata in .ged runtime" }),
      ),
    ).toBe(true);
    expect(
      shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ detail: "src/app.ts\n.ged/file" })),
    ).toBe(true);
    expect(shouldInvalidateVerifierForRuntimeEvent(fileChangeEvent({ data: { path: 123 } }))).toBe(
      true,
    );
  });

  it("ignores non-file-change item completions", () => {
    expect(
      shouldInvalidateVerifierForRuntimeEvent(
        fileChangeEvent({ itemType: "command", detail: "src/app.ts" }),
      ),
    ).toBe(false);
  });
});

describe("getRuntimeFileChangeImpact", () => {
  it("counts only source paths for runtime auto-escalation", () => {
    const impact = getRuntimeFileChangeImpact(
      fileChangeEvent({ data: { files: [".ged/runtime/root/checkpoints.json", "src/app.ts"] } }),
    );

    expect(impact.shouldInvalidateVerifier).toBe(true);
    expect(impact.changesCheckpointState).toBe(true);
    expect(impact.sourcePaths).toEqual(["src/app.ts"]);
    expect(impact.ambiguousSourceEditCount).toBe(0);
  });

  it("detects checkpoint state metadata changes without treating them as source edits", () => {
    const impact = getRuntimeFileChangeImpact(
      fileChangeEvent({ detail: ".ged/runtime/root/checkpoints.json" }),
    );

    expect(impact.shouldInvalidateVerifier).toBe(false);
    expect(impact.changesCheckpointState).toBe(true);
    expect(impact.sourcePaths).toEqual([]);
    expect(impact.ambiguousSourceEditCount).toBe(0);
  });

  it("detects absolute checkpoint state metadata paths", () => {
    const impact = getRuntimeFileChangeImpact(
      fileChangeEvent({ detail: "/tmp/project/.ged/runtime/root/checkpoints.json" }),
    );

    expect(impact.shouldInvalidateVerifier).toBe(false);
    expect(impact.changesCheckpointState).toBe(true);
    expect(impact.sourcePaths).toEqual([]);
  });

  it("treats ambiguous path data as one unknown source edit", () => {
    const impact = getRuntimeFileChangeImpact(
      fileChangeEvent({ detail: "Updated checkpoint metadata in .ged runtime" }),
    );

    expect(impact.shouldInvalidateVerifier).toBe(true);
    expect(impact.changesCheckpointState).toBe(false);
    expect(impact.sourcePaths).toEqual([]);
    expect(impact.ambiguousSourceEditCount).toBe(1);
  });
});

describe("recordRuntimeFileChangeImpact", () => {
  it("tracks unique source edits across file-change events in the same turn", () => {
    const stateByThread = new Map();
    const first = fileChangeEvent({ detail: "src/app.ts", turnId: "turn-1" });
    const second = fileChangeEvent({ detail: "src/config.ts", turnId: "turn-1" });

    expect(
      recordRuntimeFileChangeImpact(stateByThread, first, getRuntimeFileChangeImpact(first)),
    ).toBe(1);
    expect(
      recordRuntimeFileChangeImpact(stateByThread, second, getRuntimeFileChangeImpact(second)),
    ).toBe(2);
  });

  it("counts ambiguous edits with known source edits", () => {
    const stateByThread = new Map();
    const first = fileChangeEvent({ detail: "src/app.ts", turnId: "turn-1" });
    const second = fileChangeEvent({ data: { path: 123 }, turnId: "turn-1" });

    recordRuntimeFileChangeImpact(stateByThread, first, getRuntimeFileChangeImpact(first));

    expect(
      recordRuntimeFileChangeImpact(stateByThread, second, getRuntimeFileChangeImpact(second)),
    ).toBe(2);
  });

  it("resets source edit accounting when the provider turn id changes", () => {
    const stateByThread = new Map();
    const first = fileChangeEvent({ detail: "src/app.ts", turnId: "turn-1" });
    const second = fileChangeEvent({ detail: "src/config.ts", turnId: "turn-2" });

    recordRuntimeFileChangeImpact(stateByThread, first, getRuntimeFileChangeImpact(first));

    expect(
      recordRuntimeFileChangeImpact(stateByThread, second, getRuntimeFileChangeImpact(second)),
    ).toBe(1);
  });
});
