import * as Schema from "effect/Schema";

export const GED_SUBAGENT_ROLES = [
  "ged-explorer",
  "ged-planner",
  "ged-plan-reviewer",
  "ged-verifier",
  "ged-worker",
] as const;
export const GedSubagentRole = Schema.Literals(GED_SUBAGENT_ROLES);
export type GedSubagentRole = typeof GedSubagentRole.Type;

export const GedWorkflowPhase = Schema.Literals([
  "inactive",
  "classify",
  "clarify",
  "plan",
  "implement",
  "verify",
  "commit",
  "done",
]);
export type GedWorkflowPhase = typeof GedWorkflowPhase.Type;

export const GedTaskClassification = Schema.Literals(["trivial", "non-trivial", "unclassified"]);
export type GedTaskClassification = typeof GedTaskClassification.Type;

export const GedWorkflowState = Schema.Struct({
  enabled: Schema.Boolean,
  initialized: Schema.Boolean,
  phase: GedWorkflowPhase,
  classification: GedTaskClassification,
  activeTaskId: Schema.optional(Schema.String),
  plannerCheckpointValid: Schema.Boolean,
  verifierCheckpointValid: Schema.Boolean,
});
export type GedWorkflowState = typeof GedWorkflowState.Type;
