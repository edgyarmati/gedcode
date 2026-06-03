import type { ProviderRuntimeEvent } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { shouldInvalidateVerifierForRuntimeEvent } from "./GedWorkflowEventReactor.ts";

const fileChangeEvent = (payload: {
  readonly detail?: string;
  readonly data?: unknown;
  readonly itemType?: string;
}): ProviderRuntimeEvent =>
  ({
    eventId: "event-1",
    provider: "codex",
    threadId: "thread-1",
    createdAt: "2026-06-03T00:00:00.000Z",
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
