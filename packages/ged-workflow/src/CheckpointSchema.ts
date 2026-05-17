import * as Schema from "effect/Schema";

export const CheckpointSource = Schema.Literals(["auto", "manual"]);
export type CheckpointSource = typeof CheckpointSource.Type;

export const CheckpointRecord = Schema.Struct({
  recordedAt: Schema.String,
  source: CheckpointSource,
  valid: Schema.Boolean,
  blocksCommit: Schema.optional(Schema.Boolean),
  summary: Schema.optional(Schema.String),
});
export type CheckpointRecord = typeof CheckpointRecord.Type;

export const SubagentName = Schema.Literals(["ged-explorer", "ged-planner", "ged-verifier"]);
export type SubagentName = typeof SubagentName.Type;

export const LifecycleStatus = Schema.Literals(["active", "verified", "closed"]);
export type LifecycleStatus = typeof LifecycleStatus.Type;

export const TaskClassification = Schema.Literals(["trivial", "non-trivial"]);
export type TaskClassification = typeof TaskClassification.Type;

export const ClarificationRecord = Schema.Struct({
  completedAt: Schema.String,
  questionCount: Schema.Number,
});
export type ClarificationRecord = typeof ClarificationRecord.Type;

export const PlanCheckpoints = Schema.Record(Schema.String, CheckpointRecord);

export const TaskCheckpoints = Schema.Record(
  Schema.String,
  Schema.Record(Schema.String, CheckpointRecord),
);

export const CheckpointState = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  lifecycleStatus: LifecycleStatus,
  classification: TaskClassification,
  classificationReason: Schema.String,
  clarification: Schema.optional(ClarificationRecord),
  planCheckpoints: PlanCheckpoints,
  taskCheckpoints: TaskCheckpoints,
});
export type CheckpointState = typeof CheckpointState.Type;
