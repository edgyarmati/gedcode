import {
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  ThreadId,
  type OrchestrationHelperRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildHelperRunTimelineRows, selectPinnedPmHelperCard } from "./HelperRunTimeline";

const makeRun = (overrides: Partial<OrchestrationHelperRun> = {}): OrchestrationHelperRun => ({
  id: HelperRunId.make("helper-ui"),
  projectId: ProjectId.make("project-ui"),
  attachment: { kind: "pm", threadId: ThreadId.make("pm:project-ui") },
  accessMode: "read-only",
  tier: "cheap",
  providerInstanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  modelOptions: null,
  prompt: "Find the relevant implementation paths.",
  status: "completed",
  transientRetryCount: 0,
  providerThreadId: ThreadId.make("helper:helper-ui"),
  result: "The implementation is in src/example.ts.",
  failureMessage: null,
  createdAt: "2026-07-18T12:00:00.000Z",
  startedAt: "2026-07-18T12:00:01.000Z",
  completedAt: "2026-07-18T12:00:02.000Z",
  updatedAt: "2026-07-18T12:00:02.000Z",
  ...overrides,
});

describe("buildHelperRunTimelineRows", () => {
  it("shows the stamped tier/backend and bounded terminal result", () => {
    expect(buildHelperRunTimelineRows([makeRun()])).toEqual([
      {
        id: "helper-ui",
        prompt: "Find the relevant implementation paths.",
        tierLabel: "Cheap",
        backendLabel: "codex · gpt-5.6-sol",
        statusLabel: "Completed",
        statusVariant: "success",
        result: "The implementation is in src/example.ts.",
        failureMessage: null,
      },
    ]);
  });

  it("uses a destructive status for failed and interrupted helpers", () => {
    expect(
      buildHelperRunTimelineRows([
        makeRun({ status: "failed", result: null, failureMessage: "Provider failed." }),
        makeRun({ id: HelperRunId.make("helper-interrupted"), status: "interrupted" }),
      ]).map((row) => [row.statusLabel, row.statusVariant]),
    ).toEqual([
      ["Failed", "destructive"],
      ["Interrupted", "destructive"],
    ]);
  });
});

describe("selectPinnedPmHelperCard", () => {
  // The PM surface pins exactly one card, so the selector — not the renderer —
  // has to settle which run wins when several are in flight.
  it("pins the newest PM helper regardless of input order", () => {
    const card = selectPinnedPmHelperCard([
      makeRun({ id: HelperRunId.make("helper-middle"), createdAt: "2026-07-18T12:00:01.000Z" }),
      makeRun({ id: HelperRunId.make("helper-newest"), createdAt: "2026-07-18T12:00:03.000Z" }),
      makeRun({ id: HelperRunId.make("helper-oldest"), createdAt: "2026-07-18T12:00:00.000Z" }),
    ]);

    expect(card?.id).toBe("helper-newest");
  });

  it("breaks identical creation stamps by helper id", () => {
    const card = selectPinnedPmHelperCard([
      makeRun({ id: HelperRunId.make("helper-b"), createdAt: "2026-07-18T12:00:00.000Z" }),
      makeRun({ id: HelperRunId.make("helper-a"), createdAt: "2026-07-18T12:00:00.000Z" }),
    ]);

    expect(card?.id).toBe("helper-b");
  });

  it("has nothing to pin without PM helpers", () => {
    expect(selectPinnedPmHelperCard([])).toBeNull();
  });

  // Task-attached helpers belong to Task history; a newer one must not steal the
  // project card, and it must not become the card when it is the only run.
  it("never pins a task-attached helper", () => {
    const taskHelper = makeRun({
      id: HelperRunId.make("helper-task"),
      attachment: { kind: "task", taskId: TaskId.make("task-1") },
      createdAt: "2026-07-18T12:00:09.000Z",
    });

    expect(selectPinnedPmHelperCard([taskHelper])).toBeNull();
    expect(
      selectPinnedPmHelperCard([
        taskHelper,
        makeRun({ id: HelperRunId.make("helper-pm"), createdAt: "2026-07-18T12:00:01.000Z" }),
      ])?.id,
    ).toBe("helper-pm");
  });

  // A run in flight has nothing to dismiss yet: hiding it would strand the user
  // with no way back to a result they are still waiting for.
  it("only offers dismissal once the pinned helper is terminal", () => {
    const dismissibleByStatus = (
      ["pending", "running", "completed", "failed", "interrupted"] as const
    ).map((status) => [status, selectPinnedPmHelperCard([makeRun({ status })])?.dismissible]);

    expect(dismissibleByStatus).toEqual([
      ["pending", false],
      ["running", false],
      ["completed", true],
      ["failed", true],
      ["interrupted", true],
    ]);
  });
});
