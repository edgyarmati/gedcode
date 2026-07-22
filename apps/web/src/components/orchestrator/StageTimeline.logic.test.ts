import {
  ProjectId,
  ProviderInstanceId,
  TaskId,
  ThreadId,
  type OrchestrationHelperRun,
  type OrchestrationStageHistoryEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildStageTimelineRows, buildTaskHistoryRows } from "./StageTimeline";

const makeEntry = (
  overrides: Partial<OrchestrationStageHistoryEntry> = {},
): OrchestrationStageHistoryEntry => ({
  projectId: ProjectId.make("project-1"),
  taskId: TaskId.make("task-1"),
  stageThreadId: ThreadId.make("stage-1"),
  role: "work",
  capabilityTier: null,
  providerInstanceId: ProviderInstanceId.make("codex_work"),
  model: "gpt-5-codex",
  modelOptions: null,
  status: "running",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: null,
  ...overrides,
});

describe("buildStageTimelineRows", () => {
  it("labels the role, formats the backend, and maps status to a badge variant", () => {
    const [row] = buildStageTimelineRows([makeEntry({ role: "verify", status: "completed" })]);
    expect(row).toMatchObject({
      role: "verify",
      roleLabel: "Verify",
      attemptNumber: 1,
      status: "completed",
      statusLabel: "Completed",
      statusVariant: "success",
      backendLabel: "codex_work · gpt-5-codex",
      permissionLabel: "Permission unknown",
    });
  });

  it("labels the effective runtime permission recorded for each stage attempt", () => {
    const rows = buildStageTimelineRows([
      makeEntry({ runtimeMode: "full-access" }),
      makeEntry({
        stageThreadId: ThreadId.make("stage-approval"),
        runtimeMode: "approval-required",
      }),
      makeEntry({
        stageThreadId: ThreadId.make("stage-edits"),
        runtimeMode: "auto-accept-edits",
      }),
    ]);
    expect(rows.map((row) => row.permissionLabel)).toEqual([
      "Full access",
      "Approval required",
      "Auto-accept edits",
    ]);
  });

  it("maps each stage status to its variant", () => {
    const rows = buildStageTimelineRows([
      makeEntry({ stageThreadId: ThreadId.make("s-run"), status: "running" }),
      makeEntry({ stageThreadId: ThreadId.make("s-pause"), status: "paused" }),
      makeEntry({
        stageThreadId: ThreadId.make("s-done"),
        status: "completed",
      }),
      makeEntry({ stageThreadId: ThreadId.make("s-block"), status: "blocked" }),
      makeEntry({
        stageThreadId: ThreadId.make("s-interrupted"),
        status: "interrupted",
      }),
    ]);
    expect(rows.map((row) => [row.status, row.statusVariant])).toEqual([
      ["running", "info"],
      ["paused", "warning"],
      ["completed", "success"],
      ["blocked", "warning"],
      ["interrupted", "destructive"],
    ]);
  });

  it("preserves input order and keys rows by stage thread id", () => {
    const rows = buildStageTimelineRows([
      makeEntry({ stageThreadId: ThreadId.make("stage-plan"), role: "plan" }),
      makeEntry({ stageThreadId: ThreadId.make("stage-work"), role: "work" }),
      makeEntry({
        stageThreadId: ThreadId.make("stage-verify"),
        role: "verify",
      }),
    ]);
    expect(rows.map((row) => row.key)).toEqual(["stage-plan", "stage-work", "stage-verify"]);
    expect(rows.map((row) => row.roleLabel)).toEqual(["Plan", "Work", "Verify"]);
  });

  it("numbers retries independently for each stage role", () => {
    const rows = buildStageTimelineRows([
      makeEntry({ stageThreadId: ThreadId.make("work-1"), role: "work" }),
      makeEntry({ stageThreadId: ThreadId.make("verify-1"), role: "verify" }),
      makeEntry({ stageThreadId: ThreadId.make("verify-2"), role: "verify" }),
      makeEntry({ stageThreadId: ThreadId.make("work-2"), role: "work" }),
    ]);

    expect(rows.map((row) => [row.role, row.attemptNumber])).toEqual([
      ["work", 1],
      ["verify", 1],
      ["verify", 2],
      ["work", 2],
    ]);
  });

  it("returns an empty list for no entries", () => {
    expect(buildStageTimelineRows([])).toEqual([]);
  });
});

describe("buildTaskHistoryRows", () => {
  it("interleaves helpers and stage attempts chronologically without changing attempt selection keys", () => {
    const helper = {
      id: "helper-1",
      providerInstanceId: ProviderInstanceId.make("codex_helper"),
      model: "gpt-5-mini",
      prompt: "Find the affected module.",
      status: "completed",
      result: "src/feature.ts",
      failureMessage: null,
      createdAt: "2026-06-01T00:01:00.000Z",
      startedAt: null,
    } as OrchestrationHelperRun;
    const rows = buildTaskHistoryRows(
      [
        makeEntry({
          stageThreadId: ThreadId.make("stage-plan"),
          role: "plan",
          startedAt: "2026-06-01T00:00:00.000Z",
        }),
        makeEntry({
          stageThreadId: ThreadId.make("stage-work"),
          role: "work",
          startedAt: "2026-06-01T00:02:00.000Z",
        }),
      ],
      [helper],
    );

    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ["stage", "stage-plan"],
      ["helper", "helper-1"],
      ["stage", "stage-work"],
    ]);
    expect(rows[0]).toMatchObject({
      kind: "stage",
      attemptNumber: 1,
      key: "stage-plan",
    });
    expect(rows[2]).toMatchObject({
      kind: "stage",
      attemptNumber: 1,
      key: "stage-work",
    });
    expect(rows[1]).toMatchObject({
      kind: "helper",
      statusLabel: "Completed",
      result: "src/feature.ts",
    });
  });
});
