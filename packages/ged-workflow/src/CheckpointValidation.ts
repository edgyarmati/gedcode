import type { CheckpointRecord, CheckpointState } from "./CheckpointSchema.ts";

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string | undefined;
}

const hasText = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";

const isValidQuestionCount = (value: number): boolean =>
  Number.isInteger(value) && Number.isFinite(value) && value >= 0;

export const validateClarificationGate = (state: CheckpointState): ValidationResult => {
  if (state.classification === "trivial") return { valid: true };

  const clarification = state.clarification;
  if (!clarification) {
    return {
      valid: false,
      reason:
        "Non-trivial task requires a clarification decision before planning: needed or skipped-sufficient.",
    };
  }

  if (!isValidQuestionCount(clarification.questionCount)) {
    return {
      valid: false,
      reason: "Clarification questionCount must be a non-negative integer.",
    };
  }

  if (!clarification.decision) {
    return {
      valid: false,
      reason: "Clarification record must include decision: needed or skipped-sufficient.",
    };
  }

  if (clarification.decision === "needed" && clarification.questionCount <= 0) {
    return {
      valid: false,
      reason: "Clarification decision needed requires questionCount > 0.",
    };
  }

  if (clarification.decision === "skipped-sufficient") {
    if (clarification.questionCount !== 0) {
      return {
        valid: false,
        reason: "Clarification decision skipped-sufficient requires questionCount === 0.",
      };
    }
    if (!hasText(clarification.reason)) {
      return {
        valid: false,
        reason: "Clarification decision skipped-sufficient requires a non-empty reason/evidence.",
      };
    }
  }

  return { valid: true };
};

export const validatePlannerCheckpoint = (state: CheckpointState): ValidationResult => {
  if (state.classification === "trivial") return { valid: true };
  const clarification = validateClarificationGate(state);
  if (!clarification.valid) return clarification;

  const planner = state.planCheckpoints["ged-planner"];
  if (!planner || !planner.valid) {
    return {
      valid: false,
      reason: "Non-trivial task requires ged-planner checkpoint before source edits.",
    };
  }
  return { valid: true };
};

export const validateCommitCheckpoints = (
  state: CheckpointState,
  taskId: string,
): ValidationResult => {
  if (state.classification === "trivial") return { valid: true };
  const taskCps = state.taskCheckpoints[taskId];
  const verifier = taskCps?.["ged-verifier"];
  if (!verifier || !verifier.valid) {
    return {
      valid: false,
      reason: "Non-trivial commit requires ged-verifier checkpoint.",
    };
  }
  if (verifier.blocksCommit) {
    return {
      valid: false,
      reason: "ged-verifier flagged blocksCommit=true. Resolve findings first.",
    };
  }
  return { valid: true };
};

export const shouldAutoEscalate = (state: CheckpointState, filesChanged: number): boolean =>
  state.classification === "trivial" && filesChanged > 1;

export const autoEscalateCheckpointState = (
  state: CheckpointState,
  filesChanged: number,
): CheckpointState => {
  const invalidated = invalidateVerifierCheckpoints(state);
  if (!shouldAutoEscalate(state, filesChanged)) return invalidated;

  return {
    ...invalidated,
    classification: "non-trivial",
    classificationReason: "Runtime auto-escalation: trivial task changed multiple source files.",
    planCheckpoints: {},
  };
};

export const invalidateVerifierCheckpoints = (state: CheckpointState): CheckpointState => {
  const updatedTaskCheckpoints: Record<string, Record<string, CheckpointRecord>> = {};
  for (const [taskId, cps] of Object.entries(state.taskCheckpoints)) {
    if (!cps) continue;
    const updatedCps: Record<string, CheckpointRecord> = {};
    for (const [key, cp] of Object.entries(cps)) {
      updatedCps[key] = key === "ged-verifier" ? { ...cp, valid: false } : cp;
    }
    updatedTaskCheckpoints[taskId] = updatedCps;
  }
  return {
    ...state,
    taskCheckpoints: updatedTaskCheckpoints as CheckpointState["taskCheckpoints"],
  };
};

export const closeCheckpointState = (state: CheckpointState): CheckpointState => ({
  ...state,
  lifecycleStatus: "closed",
});

export const recordCheckpoint = (
  state: CheckpointState,
  location: "plan" | "task",
  name: string,
  recordedAt: string,
  taskId?: string,
): CheckpointState => {
  const record = {
    recordedAt,
    source: "auto" as const,
    valid: true,
  };
  if (location === "plan") {
    return {
      ...state,
      planCheckpoints: {
        ...state.planCheckpoints,
        [name]: record,
      } as CheckpointState["planCheckpoints"],
    };
  }
  const tid = taskId ?? "default";
  return {
    ...state,
    taskCheckpoints: {
      ...state.taskCheckpoints,
      [tid]: { ...state.taskCheckpoints[tid], [name]: record },
    } as CheckpointState["taskCheckpoints"],
  };
};
