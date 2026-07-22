import {
  ProjectId,
  ProviderInstanceId,
  TaskId,
  ThreadId,
  type OrchestrationStageHistoryEntry,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildStageTimelineRows } from "./StageTimeline";

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
      makeEntry({ stageThreadId: ThreadId.make("stage-edits"), runtimeMode: "auto-accept-edits" }),
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
      makeEntry({ stageThreadId: ThreadId.make("s-done"), status: "completed" }),
      makeEntry({ stageThreadId: ThreadId.make("s-block"), status: "blocked" }),
      makeEntry({ stageThreadId: ThreadId.make("s-interrupted"), status: "interrupted" }),
    ]);
    expect(rows.map((row) => [row.status, row.statusVariant])).toEqual([
      ["running", "info"],
      ["completed", "success"],
      ["blocked", "warning"],
      ["interrupted", "destructive"],
    ]);
  });

  it("preserves input order and keys rows by stage thread id", () => {
    const rows = buildStageTimelineRows([
      makeEntry({ stageThreadId: ThreadId.make("stage-plan"), role: "plan" }),
      makeEntry({ stageThreadId: ThreadId.make("stage-work"), role: "work" }),
      makeEntry({ stageThreadId: ThreadId.make("stage-verify"), role: "verify" }),
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
