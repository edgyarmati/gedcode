import {
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  ThreadId,
  type OrchestrationHelperRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildHelperRunTimelineRows,
  buildPmHelperHistoryRows,
  selectPinnedPmHelperCard,
} from "./HelperRunTimeline";

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

  it("appends reasoning labels from the run's model options to the backend label", () => {
    expect(
      buildHelperRunTimelineRows([
        makeRun({ modelOptions: [{ id: "effort", value: "high" }] }),
        makeRun({
          id: HelperRunId.make("helper-thinking"),
          modelOptions: [{ id: "thinking", value: false }],
        }),
        makeRun({ id: HelperRunId.make("helper-unlabeled"), modelOptions: null }),
      ]).map((row) => row.backendLabel),
    ).toEqual([
      "codex · gpt-5.6-sol · Reasoning High",
      "codex · gpt-5.6-sol · Thinking Off",
      "codex · gpt-5.6-sol",
    ]);
  });
});

describe("buildPmHelperHistoryRows", () => {
  // History is the durable record behind the single pinned card: dismissing or
  // replacing a card must never lose the run, and the newest belongs on top.
  it("lists every PM helper newest first, including replaced and active runs", () => {
    const rows = buildPmHelperHistoryRows([
      makeRun({ id: HelperRunId.make("helper-oldest"), createdAt: "2026-07-18T12:00:00.000Z" }),
      makeRun({
        id: HelperRunId.make("helper-active"),
        createdAt: "2026-07-18T12:00:05.000Z",
        status: "running",
        result: null,
        completedAt: null,
      }),
      makeRun({ id: HelperRunId.make("helper-middle"), createdAt: "2026-07-18T12:00:02.000Z" }),
    ]);

    expect(rows.map((row) => row.id)).toEqual(["helper-active", "helper-middle", "helper-oldest"]);
  });

  it("keeps the full result, failure, backend, and timing of each run", () => {
    expect(
      buildPmHelperHistoryRows([
        makeRun({ startedAt: "2026-07-18T12:00:01.000Z" }),
        makeRun({
          id: HelperRunId.make("helper-failed"),
          createdAt: "2026-07-18T11:59:00.000Z",
          startedAt: null,
          status: "failed",
          result: null,
          failureMessage: "Provider failed.",
        }),
      ]),
    ).toEqual([
      {
        id: "helper-ui",
        prompt: "Find the relevant implementation paths.",
        tierLabel: "Cheap",
        backendLabel: "codex · gpt-5.6-sol",
        statusLabel: "Completed",
        statusVariant: "success",
        result: "The implementation is in src/example.ts.",
        failureMessage: null,
        startedAt: "2026-07-18T12:00:01.000Z",
      },
      {
        id: "helper-failed",
        prompt: "Find the relevant implementation paths.",
        tierLabel: "Cheap",
        backendLabel: "codex · gpt-5.6-sol",
        statusLabel: "Failed",
        statusVariant: "destructive",
        result: null,
        failureMessage: "Provider failed.",
        // A run that never started still needs a stamp, so history falls back to
        // when it was requested.
        startedAt: "2026-07-18T11:59:00.000Z",
      },
    ]);
  });

  it("leaves task-attached helpers to Task history", () => {
    expect(
      buildPmHelperHistoryRows([
        makeRun({
          id: HelperRunId.make("helper-task"),
          attachment: { kind: "task", taskId: TaskId.make("task-1") },
        }),
      ]),
    ).toEqual([]);
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

  // Dismissal is per run, so a dismissal recorded for an older helper must never
  // suppress the helper that replaced it.
  it("hides only the pinned helper that was dismissed", () => {
    const older = makeRun({
      id: HelperRunId.make("helper-older"),
      createdAt: "2026-07-18T12:00:00.000Z",
    });
    const newer = makeRun({
      id: HelperRunId.make("helper-newer"),
      createdAt: "2026-07-18T12:00:05.000Z",
    });

    expect(selectPinnedPmHelperCard([older, newer], new Set(["helper-older"]))?.id).toBe(
      "helper-newer",
    );
    expect(selectPinnedPmHelperCard([older, newer], new Set(["helper-newer"]))).toBeNull();
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
