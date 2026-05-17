import * as Schema from "effect/Schema";

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
  initialized: Schema.Boolean,
  phase: GedWorkflowPhase,
  classification: GedTaskClassification,
  activeTaskId: Schema.optional(Schema.String),
  plannerCheckpointValid: Schema.Boolean,
  verifierCheckpointValid: Schema.Boolean,
});
export type GedWorkflowState = typeof GedWorkflowState.Type;
