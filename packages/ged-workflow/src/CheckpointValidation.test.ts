import { describe, it, expect } from "vitest";
import type { CheckpointState } from "./CheckpointSchema.ts";
import {
  validateClarificationGate,
  validatePlannerCheckpoint,
  validateCommitCheckpoints,
  shouldAutoEscalate,
  invalidateVerifierCheckpoints,
  closeCheckpointState,
} from "./CheckpointValidation.ts";

const stubRecord = (
  overrides?: Partial<CheckpointState["taskCheckpoints"][string]["ged-verifier"]>,
): CheckpointState["taskCheckpoints"][string]["ged-verifier"] => ({
  recordedAt: "2026-05-17T10:00:00Z",
  source: "auto",
  valid: true,
  ...overrides,
});

const makeActiveState = (overrides?: Partial<CheckpointState>): CheckpointState =>
  ({
    schemaVersion: 3,
    lifecycleStatus: "active",
    classification: "non-trivial",
    classificationReason: "test",
    planCheckpoints: {},
    taskCheckpoints: {},
    ...overrides,
  }) as CheckpointState;

const makeTaskCheckpoints = (
  taskId: string,
  verifierOverrides?: Partial<CheckpointState["taskCheckpoints"][string]["ged-verifier"]>,
): CheckpointState["taskCheckpoints"] =>
  ({
    [taskId]: {
      "ged-explorer": stubRecord(),
      "ged-verifier": stubRecord(verifierOverrides),
    },
  }) as CheckpointState["taskCheckpoints"];

describe("validatePlannerCheckpoint", () => {
  it("returns invalid when no planner checkpoint exists for non-trivial", () => {
    const result = validatePlannerCheckpoint(makeActiveState());
    expect(result.valid).toBe(false);
  });

  it("returns valid when planner checkpoint exists", () => {
    const result = validatePlannerCheckpoint(
      makeActiveState({
        clarification: {
          completedAt: "2026-05-17T10:00:00Z",
          decision: "skipped-sufficient",
          questionCount: 0,
          reason: "Request is explicit and tests are known.",
        },
        planCheckpoints: {
          "ged-planner": stubRecord(),
        },
      } as Partial<CheckpointState>),
    );
    expect(result.valid).toBe(true);
  });

  it("returns valid for trivial tasks regardless", () => {
    const result = validatePlannerCheckpoint(makeActiveState({ classification: "trivial" }));
    expect(result.valid).toBe(true);
  });
});

describe("validateClarificationGate", () => {
  it("returns invalid when non-trivial task has no clarification", () => {
    expect(validateClarificationGate(makeActiveState()).valid).toBe(false);
  });

  it("returns invalid when needed has zero questions", () => {
    const result = validateClarificationGate(
      makeActiveState({
        clarification: {
          completedAt: "2026-05-17T10:00:00Z",
          decision: "needed",
          questionCount: 0,
        },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("returns valid when needed has questions", () => {
    const result = validateClarificationGate(
      makeActiveState({
        clarification: {
          completedAt: "2026-05-17T10:00:00Z",
          decision: "needed",
          questionCount: 1,
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("returns valid when skipped-sufficient has zero questions and reason", () => {
    const result = validateClarificationGate(
      makeActiveState({
        clarification: {
          completedAt: "2026-05-17T10:00:00Z",
          decision: "skipped-sufficient",
          questionCount: 0,
          reason: "The user provided goal, scope, and acceptance criteria.",
        },
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("returns invalid when skipped-sufficient has no reason", () => {
    const result = validateClarificationGate(
      makeActiveState({
        clarification: {
          completedAt: "2026-05-17T10:00:00Z",
          decision: "skipped-sufficient",
          questionCount: 0,
        },
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("returns invalid for negative, fractional, or non-finite question counts", () => {
    for (const questionCount of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        validateClarificationGate(
          makeActiveState({
            clarification: {
              completedAt: "2026-05-17T10:00:00Z",
              decision: "needed",
              questionCount,
            },
          }),
        ).valid,
      ).toBe(false);
    }
  });

  it("returns valid for trivial tasks", () => {
    expect(validateClarificationGate(makeActiveState({ classification: "trivial" })).valid).toBe(
      true,
    );
  });
});

describe("validateCommitCheckpoints", () => {
  it("returns invalid when no verifier checkpoint for non-trivial", () => {
    const result = validateCommitCheckpoints(makeActiveState(), "task-1");
    expect(result.valid).toBe(false);
  });

  it("returns invalid when verifier blocks commit", () => {
    const result = validateCommitCheckpoints(
      makeActiveState({
        taskCheckpoints: makeTaskCheckpoints("task-1", { blocksCommit: true }),
      }),
      "task-1",
    );
    expect(result.valid).toBe(false);
  });

  it("returns valid when verifier passes", () => {
    const result = validateCommitCheckpoints(
      makeActiveState({
        taskCheckpoints: makeTaskCheckpoints("task-1", { blocksCommit: false }),
      }),
      "task-1",
    );
    expect(result.valid).toBe(true);
  });

  it("returns valid for trivial tasks", () => {
    const result = validateCommitCheckpoints(
      makeActiveState({ classification: "trivial" }),
      "task-1",
    );
    expect(result.valid).toBe(true);
  });
});

describe("shouldAutoEscalate", () => {
  it("returns true when trivial and >1 file", () => {
    expect(shouldAutoEscalate(makeActiveState({ classification: "trivial" }), 2)).toBe(true);
  });

  it("returns false when trivial and <=1 file", () => {
    expect(shouldAutoEscalate(makeActiveState({ classification: "trivial" }), 1)).toBe(false);
  });

  it("returns false when already non-trivial", () => {
    expect(shouldAutoEscalate(makeActiveState(), 5)).toBe(false);
  });
});

describe("invalidateVerifierCheckpoints", () => {
  it("marks verifier checkpoints as invalid", () => {
    const state = makeActiveState({
      taskCheckpoints: makeTaskCheckpoints("task-1"),
    });
    const result = invalidateVerifierCheckpoints(state);
    expect(result.taskCheckpoints["task-1"]?.["ged-verifier"]?.valid).toBe(false);
  });

  it("preserves non-verifier checkpoints", () => {
    const state = makeActiveState({
      taskCheckpoints: makeTaskCheckpoints("task-1"),
    });
    const result = invalidateVerifierCheckpoints(state);
    expect(result.taskCheckpoints["task-1"]?.["ged-explorer"]?.valid).toBe(true);
  });
});

describe("closeCheckpointState", () => {
  it("transitions lifecycle to closed", () => {
    const result = closeCheckpointState(makeActiveState());
    expect(result.lifecycleStatus).toBe("closed");
  });
});
