import {
  EnvironmentId,
  EventId,
  GateId,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { OrchestratorPendingGate, OrchestratorTask } from "../../types";
import {
  derivePmLifecycleDeliveryAttention,
  deriveTaskLandingPresentation,
  parseTaskStageSearch,
} from "./OrchestratorRoutes.logic";

describe("parseTaskStageSearch", () => {
  it("keeps a deep-linked stage and drops missing or invalid values", () => {
    expect(parseTaskStageSearch({ stage: "stage-verify-2" })).toEqual({
      stage: "stage-verify-2",
    });
    expect(parseTaskStageSearch({})).toEqual({});
    expect(parseTaskStageSearch({ stage: "  " })).toEqual({});
    expect(parseTaskStageSearch({ stage: 42 })).toEqual({});
  });
});

describe("derivePmLifecycleDeliveryAttention", () => {
  it("restores attention when the same settlement is held after recovery", () => {
    const settlementKey = "thread-stage-1::turn-1";
    const lifecycleActivity = (
      id: string,
      kind: "pm.lifecycle.delivery-held" | "pm.lifecycle.delivery-recovered",
      reason: string,
    ) => ({
      id: EventId.make(id),
      tone: kind === "pm.lifecycle.delivery-held" ? ("error" as const) : ("info" as const),
      kind,
      summary: kind === "pm.lifecycle.delivery-held" ? "Delivery held" : "Delivery recovered",
      payload: { settlementKey, reason },
      turnId: null,
      createdAt: "2026-07-22T00:00:00.000Z",
    });

    expect(
      derivePmLifecycleDeliveryAttention([
        lifecycleActivity("lifecycle-held-1", "pm.lifecycle.delivery-held", "auth"),
        lifecycleActivity("lifecycle-recovered-1", "pm.lifecycle.delivery-recovered", "auth"),
        lifecycleActivity("lifecycle-held-2", "pm.lifecycle.delivery-held", "auth"),
      ]),
    ).toEqual({ count: 1, reasons: ["auth"] });
  });
});

const taskId = TaskId.make("task-landing");

function makeTask(overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  return {
    id: taskId,
    environmentId: EnvironmentId.make("environment-landing"),
    projectId: ProjectId.make("project-landing"),
    type: TaskTypeId.make("feature"),
    title: "Land this task",
    status: "review",
    branch: "orchestrator/task-landing",
    worktreePath: "/tmp/task-landing",
    prUrl: null,
    pmMessageId: null,
    stageThreadIds: [],
    currentStageThreadId: null,
    cancellation: null,
    changeReview: null,
    verification: null,
    noChangesNeeded: null,
    landing: null,
    roleCapabilityTiers: {},
    playbookVersion: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function makeLandGate(overrides: Partial<OrchestratorPendingGate> = {}): OrchestratorPendingGate {
  return {
    environmentId: EnvironmentId.make("environment-landing"),
    gateId: GateId.make("gate-land"),
    taskId,
    gate: "land",
    contentHash: "sha256:current",
    stageThreadId: null,
    status: "resolved",
    approvedHash: "sha256:current",
    decision: "approved",
    origin: "human",
    requestedAt: "2026-07-11T00:01:00.000Z",
    resolvedAt: "2026-07-11T00:02:00.000Z",
    ...overrides,
  };
}

describe("deriveTaskLandingPresentation", () => {
  it("offers landing only for a review task with the latest content-matched approval", () => {
    expect(
      deriveTaskLandingPresentation({ task: makeTask(), gates: [makeLandGate()], activities: [] }),
    ).toEqual({ kind: "ready" });

    expect(
      deriveTaskLandingPresentation({
        task: makeTask({ status: "working" }),
        gates: [makeLandGate()],
        activities: [],
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({ currentStageThreadId: ThreadId.make("stage-active") }),
        gates: [makeLandGate()],
        activities: [],
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask(),
        gates: [makeLandGate({ approvedHash: "sha256:stale" })],
        activities: [],
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("does not use an old approval when a newer land gate is pending", () => {
    expect(
      deriveTaskLandingPresentation({
        task: makeTask(),
        gates: [
          makeLandGate(),
          makeLandGate({
            gateId: GateId.make("gate-land-newer"),
            status: "pending",
            approvedHash: null,
            decision: null,
            origin: null,
            resolvedAt: null,
          }),
        ],
        activities: [],
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("shows request, PR-opening, failure, and completed states in authority order", () => {
    expect(
      deriveTaskLandingPresentation({
        task: makeTask(),
        gates: [makeLandGate()],
        activities: [],
        requestPending: true,
      }),
    ).toEqual({ kind: "pending" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask(),
        gates: [makeLandGate()],
        activities: [],
        requestError: "connection reset",
      }),
    ).toEqual({ kind: "request-failed", message: "connection reset" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({ status: "abandoned" }),
        gates: [makeLandGate()],
        activities: [],
        requestError: "connection reset",
      }),
    ).toEqual({ kind: "unavailable" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({
          status: "landed",
          landing: {
            status: "failed",
            failureMessage: "durable provider failure",
            branchPushed: true,
            updatedAt: "2026-07-11T00:04:00.000Z",
          },
        }),
        gates: [],
        activities: [],
      }),
    ).toEqual({ kind: "failed", message: "durable provider failure" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({
          status: "landed",
          landing: {
            status: "failed",
            failureMessage: "durable provider failure",
            branchPushed: true,
            updatedAt: "2026-07-11T00:04:00.000Z",
          },
        }),
        gates: [],
        activities: [],
        requestPending: true,
      }),
    ).toEqual({ kind: "pending" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({
          status: "review",
          landing: {
            status: "opening-pr",
            failureMessage: null,
            branchPushed: false,
            updatedAt: "2026-07-11T00:04:00.000Z",
          },
        }),
        gates: [],
        activities: [],
      }),
    ).toEqual({ kind: "opening-pr" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({
          status: "review",
          landing: {
            status: "failed",
            failureMessage: "GitHub unavailable",
            branchPushed: false,
            updatedAt: "2026-07-11T00:04:00.000Z",
          },
        }),
        gates: [],
        activities: [],
      }),
    ).toEqual({ kind: "failed", message: "GitHub unavailable" });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({ status: "landed" }),
        gates: [],
        activities: [],
      }),
    ).toEqual({ kind: "opening-pr" });

    const failure = {
      id: EventId.make("task-pr-open-failed:task-landing"),
      tone: "error" as const,
      kind: "task.landing.pr-open-failed",
      summary: "Landing: PR open failed - network down; branch pushed: yes",
      payload: { taskId: String(taskId) },
      turnId: null,
      createdAt: "2026-07-11T00:03:00.000Z",
    };
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({ status: "landed" }),
        gates: [],
        activities: [failure],
      }),
    ).toEqual({ kind: "failed", message: failure.summary });
    expect(
      deriveTaskLandingPresentation({
        task: makeTask({ status: "pr-open", prUrl: "https://example.com/pull/42" }),
        gates: [],
        activities: [failure],
      }),
    ).toEqual({ kind: "pr-open", prUrl: "https://example.com/pull/42" });
  });
});
