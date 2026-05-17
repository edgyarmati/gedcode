import type { CheckpointRecord, CheckpointState } from "./CheckpointSchema.ts";

export interface ValidationResult {
  readonly valid: boolean;
  readonly reason?: string | undefined;
}

export const validatePlannerCheckpoint = (state: CheckpointState): ValidationResult => {
  if (state.classification === "trivial") return { valid: true };
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
