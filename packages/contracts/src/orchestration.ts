import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Struct from "effect/Struct";
import { ProviderOptionSelections } from "./model.ts";
import { RepositoryIdentity } from "./environment.ts";
import {
  ApprovalRequestId,
  CheckpointRef,
  CommandId,
  EventId,
  GateId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ProviderItemId,
  TaskId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const ORCHESTRATOR_WS_METHODS = {
  sendMessage: "orchestrator.sendMessage",
  subscribeProject: "orchestrator.subscribeProject",
  subscribeTask: "orchestrator.subscribeTask",
  resolveGate: "orchestrator.resolveGate",
  setTaskRoleSelections: "orchestrator.setTaskRoleSelections",
} as const;

export const OrchestratorPlaybookFrontmatter = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});
export type OrchestratorPlaybookFrontmatter = typeof OrchestratorPlaybookFrontmatter.Type;

export const ProviderApprovalPolicy = Schema.Literals([
  "untrusted",
  "on-failure",
  "on-request",
  "never",
]);
export type ProviderApprovalPolicy = typeof ProviderApprovalPolicy.Type;
export const ProviderSandboxMode = Schema.Literals([
  "read-only",
  "workspace-write",
  "danger-full-access",
]);
export type ProviderSandboxMode = typeof ProviderSandboxMode.Type;

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const ORCHESTRATION_STAGE_ROLES = ["classify", "plan", "review", "work", "verify"] as const;

/**
 * Stage role within a task pipeline. Closed so every runtime mapping and UI
 * projection is exhaustiveness-checked when roles are added.
 */
export const OrchestrationStageRole = Schema.Literals(ORCHESTRATION_STAGE_ROLES);
export type OrchestrationStageRole = typeof OrchestrationStageRole.Type;

const ORCHESTRATION_STAGE_ROLE_SET = new Set<string>(ORCHESTRATION_STAGE_ROLES);

const makeStageRoleKeyedMap = <Value extends Schema.Top>(valueSchema: Value) => {
  const source = Schema.Record(Schema.String, valueSchema);
  const target = Schema.Struct({
    classify: Schema.optionalKey(valueSchema),
    plan: Schema.optionalKey(valueSchema),
    review: Schema.optionalKey(valueSchema),
    work: Schema.optionalKey(valueSchema),
    verify: Schema.optionalKey(valueSchema),
  });
  return source.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformOrFail({
        decode: (value: Record<string, unknown>) => {
          const unknownKeys = Object.keys(value).filter(
            (key) => !ORCHESTRATION_STAGE_ROLE_SET.has(key),
          );
          if (unknownKeys.length > 0) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(Option.some(unknownKeys.join(", ")), {
                message: `Unknown orchestration stage role key(s): ${unknownKeys.join(", ")}`,
              }),
            );
          }
          return Effect.succeed(value as typeof target.Type);
        },
        encode: (value) => Effect.succeed(value as typeof source.Type),
      }) as never,
    ),
  );
};

export const GedRoleModelSelections = makeStageRoleKeyedMap(ModelSelection).pipe(
  Schema.withDecodingDefault(Effect.succeed({})),
);
export type GedRoleModelSelections = typeof GedRoleModelSelections.Type;

export const GedRolePromptPrefixes = makeStageRoleKeyedMap(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(Effect.succeed({})),
);
export type GedRolePromptPrefixes = typeof GedRolePromptPrefixes.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "full-access",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";
export const ProviderInteractionMode = Schema.Literals(["default", "plan"]);
export type ProviderInteractionMode = typeof ProviderInteractionMode.Type;
export const DEFAULT_PROVIDER_INTERACTION_MODE: ProviderInteractionMode = "default";
export const ProviderRequestKind = Schema.Literals(["command", "file-read", "file-change"]);
export type ProviderRequestKind = typeof ProviderRequestKind.Type;
export const AssistantDeliveryMode = Schema.Literals(["buffered", "streaming"]);
export type AssistantDeliveryMode = typeof AssistantDeliveryMode.Type;
export const ProviderApprovalDecision = Schema.Literals([
  "accept",
  "acceptForSession",
  "decline",
  "cancel",
]);
export type ProviderApprovalDecision = typeof ProviderApprovalDecision.Type;
export const ProviderUserInputAnswers = Schema.Record(Schema.String, Schema.Unknown);
export type ProviderUserInputAnswers = typeof ProviderUserInputAnswers.Type;

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;
export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;
const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;
// Correlation id is command id by design in this model.
export const CorrelationId = CommandId;
export type CorrelationId = typeof CorrelationId.Type;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);
export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});
export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});
export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment]);
export type ChatAttachment = typeof ChatAttachment.Type;
const UploadChatAttachment = Schema.Union([UploadChatImageAttachment]);
export type UploadChatAttachment = typeof UploadChatAttachment.Type;

export const ProjectScriptIcon = Schema.Literals([
  "play",
  "test",
  "lint",
  "configure",
  "build",
  "debug",
]);
export type ProjectScriptIcon = typeof ProjectScriptIcon.Type;

export const ProjectScript = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  icon: ProjectScriptIcon,
  runOnWorktreeCreate: Schema.Boolean,
});
export type ProjectScript = typeof ProjectScript.Type;

export const OrchestratorConfigJson = Schema.Record(Schema.String, Schema.Unknown);
export type OrchestratorConfigJson = typeof OrchestratorConfigJson.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  roleModelSelections: Schema.optionalKey(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optionalKey(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optionalKey(OrchestratorConfigJson),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationProject = typeof OrchestrationProject.Type;

export const OrchestrationMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type OrchestrationMessageRole = typeof OrchestrationMessageRole.Type;

export const OrchestrationMessage = Schema.Struct({
  id: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationMessage = typeof OrchestrationMessage.Type;

export const OrchestrationProposedPlanId = TrimmedNonEmptyString;
export type OrchestrationProposedPlanId = typeof OrchestrationProposedPlanId.Type;

export const OrchestrationProposedPlan = Schema.Struct({
  id: OrchestrationProposedPlanId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  implementationThreadId: Schema.NullOr(ThreadId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProposedPlan = typeof OrchestrationProposedPlan.Type;

const SourceProposedPlanReference = Schema.Struct({
  threadId: ThreadId,
  planId: OrchestrationProposedPlanId,
});

export const OrchestrationSessionStatus = Schema.Literals([
  "idle",
  "starting",
  "running",
  "ready",
  "interrupted",
  "stopped",
  "error",
]);
export type OrchestrationSessionStatus = typeof OrchestrationSessionStatus.Type;

export const OrchestrationSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(TrimmedNonEmptyString),
  providerInstanceId: Schema.optional(ProviderInstanceId),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});
export type OrchestrationSession = typeof OrchestrationSession.Type;

export const OrchestrationCheckpointFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: TrimmedNonEmptyString,
  additions: NonNegativeInt,
  deletions: NonNegativeInt,
});
export type OrchestrationCheckpointFile = typeof OrchestrationCheckpointFile.Type;

export const OrchestrationCheckpointStatus = Schema.Literals(["ready", "missing", "error"]);
export type OrchestrationCheckpointStatus = typeof OrchestrationCheckpointStatus.Type;

export const OrchestrationCheckpointSummary = Schema.Struct({
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type OrchestrationCheckpointSummary = typeof OrchestrationCheckpointSummary.Type;

export const OrchestrationThreadActivityTone = Schema.Literals([
  "info",
  "tool",
  "approval",
  "error",
]);
export type OrchestrationThreadActivityTone = typeof OrchestrationThreadActivityTone.Type;

export const OrchestrationThreadActivity = Schema.Struct({
  id: EventId,
  tone: OrchestrationThreadActivityTone,
  kind: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  payload: Schema.Unknown,
  turnId: Schema.NullOr(TurnId),
  sequence: Schema.optional(NonNegativeInt),
  createdAt: IsoDateTime,
});
export type OrchestrationThreadActivity = typeof OrchestrationThreadActivity.Type;

const OrchestrationLatestTurnState = Schema.Literals([
  "running",
  "interrupted",
  "completed",
  "error",
]);
export type OrchestrationLatestTurnState = typeof OrchestrationLatestTurnState.Type;

export const OrchestrationLatestTurn = Schema.Struct({
  turnId: TurnId,
  state: OrchestrationLatestTurnState,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
});
export type OrchestrationLatestTurn = typeof OrchestrationLatestTurn.Type;

export const OrchestrationThread = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime),
  messages: Schema.Array(OrchestrationMessage),
  proposedPlans: Schema.Array(OrchestrationProposedPlan).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  activities: Schema.Array(OrchestrationThreadActivity),
  checkpoints: Schema.Array(OrchestrationCheckpointSummary),
  session: Schema.NullOr(OrchestrationSession),
});
export type OrchestrationThread = typeof OrchestrationThread.Type;

/**
 * Identifier for a configurable task type (taxonomy entry, e.g. `feature`).
 *
 * Brands the task-type slug so it cannot be confused with other entity ids.
 */
export const TaskTypeId = TrimmedNonEmptyString.pipe(Schema.brand("TaskTypeId"));
export type TaskTypeId = typeof TaskTypeId.Type;

/**
 * Closed lifecycle status for a task aggregate.
 *
 * Status is **derived purely from the event log** by the projector — there is
 * intentionally no `task.status.set` command. The literal is closed so every
 * projection/consumer is exhaustiveness-checked by the compiler.
 */
export const OrchestrationTaskStatus = Schema.Literals([
  "draft",
  "classified",
  "planning",
  "plan-review",
  "reviewing",
  "working",
  "review",
  "verifying",
  "landed",
  "abandoned",
  "blocked",
  "blocked-on-quota",
]);
export type OrchestrationTaskStatus = typeof OrchestrationTaskStatus.Type;

/**
 * The task aggregate: one worktree + branch, grouping per-stage worker threads.
 *
 * Schema-only — the projector (WP-D) derives `status` deterministically from the
 * `task.*` event log; nothing here computes it.
 */
export const OrchestrationTask = Schema.Struct({
  id: TaskId,
  projectId: ProjectId,
  type: TaskTypeId,
  title: TrimmedNonEmptyString,
  status: OrchestrationTaskStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  prUrl: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  pmMessageId: Schema.NullOr(MessageId),
  stageThreadIds: Schema.Array(ThreadId),
  currentStageThreadId: Schema.NullOr(ThreadId),
  roleModelSelections: Schema.optionalKey(GedRoleModelSelections),
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationTask = typeof OrchestrationTask.Type;

/**
 * The gates that can guard a task. `plan` and `land` are the slice's gates;
 * `land` is hard-pinned to require approval. Closed so config + the decider's
 * `requireGateSatisfied` invariant are exhaustiveness-checked together.
 */
export const OrchestrationGateKind = Schema.Literals([
  "classify",
  "plan",
  "work",
  "review",
  "land",
]);
export type OrchestrationGateKind = typeof OrchestrationGateKind.Type;

/**
 * Origin actor for a gate resolution. `system` is reserved for internally
 * emitted engine decisions. The decider (WP-E) accepts only `human`/`client`
 * origins from external commands and **rejects `pm-runtime`** so the LLM-driven
 * PM cannot self-approve its own gates.
 */
export const OrchestrationGateResolutionOrigin = Schema.Literals([
  "human",
  "client",
  "pm-runtime",
  "system",
]);
export type OrchestrationGateResolutionOrigin = typeof OrchestrationGateResolutionOrigin.Type;

export const OrchestrationHumanConfigOrigin = Schema.Literals(["human", "client"]);
export type OrchestrationHumanConfigOrigin = typeof OrchestrationHumanConfigOrigin.Type;

export const OrchestrationTaskRoleSelectionOrigin = Schema.Literals([
  "human",
  "client",
  "pm-runtime",
]);
export type OrchestrationTaskRoleSelectionOrigin = typeof OrchestrationTaskRoleSelectionOrigin.Type;

/**
 * Decision recorded when a task gate is resolved. Closed literal so the decider
 * and projections agree on the resolution outcome.
 */
export const OrchestrationGateDecision = Schema.Literals(["approved", "rejected"]);
export type OrchestrationGateDecision = typeof OrchestrationGateDecision.Type;

export const OrchestrationPendingGateStatus = Schema.Literals(["pending", "resolved"]);
export type OrchestrationPendingGateStatus = typeof OrchestrationPendingGateStatus.Type;

export const OrchestrationPendingGate = Schema.Struct({
  gateId: GateId,
  taskId: TaskId,
  gate: OrchestrationGateKind,
  contentHash: TrimmedNonEmptyString,
  stageThreadId: Schema.NullOr(ThreadId),
  status: OrchestrationPendingGateStatus,
  approvedHash: Schema.NullOr(TrimmedNonEmptyString),
  decision: Schema.NullOr(OrchestrationGateDecision),
  origin: Schema.NullOr(OrchestrationGateResolutionOrigin),
  requestedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationPendingGate = typeof OrchestrationPendingGate.Type;

export const OrchestrationQuotaBlockedStageStatus = Schema.Literals(["blocked", "resumed"]);
export type OrchestrationQuotaBlockedStageStatus = typeof OrchestrationQuotaBlockedStageStatus.Type;

export const OrchestrationQuotaBlockedStage = Schema.Struct({
  taskId: TaskId,
  stageThreadId: ThreadId,
  role: OrchestrationStageRole,
  providerInstanceId: ProviderInstanceId,
  resetAt: Schema.NullOr(IsoDateTime),
  status: OrchestrationQuotaBlockedStageStatus,
  retryCount: NonNegativeInt,
  blockedAt: IsoDateTime,
  resumedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationQuotaBlockedStage = typeof OrchestrationQuotaBlockedStage.Type;

export const OrchestrationPmQuotaBlock = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
  status: Schema.Literals(["blocked-until", "blocked-unknown"]),
  resetAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationPmQuotaBlock = typeof OrchestrationPmQuotaBlock.Type;

export const OrchestrationStageHistoryStatus = Schema.Literals(["running", "completed", "blocked"]);
export type OrchestrationStageHistoryStatus = typeof OrchestrationStageHistoryStatus.Type;

export const OrchestrationStageHistoryEntry = Schema.Struct({
  projectId: ProjectId,
  taskId: TaskId,
  stageThreadId: ThreadId,
  role: OrchestrationStageRole,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  status: OrchestrationStageHistoryStatus,
  startedAt: IsoDateTime,
  endedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationStageHistoryEntry = typeof OrchestrationStageHistoryEntry.Type;

export const OrchestrationStageHistory = Schema.Record(
  ThreadId,
  OrchestrationStageHistoryEntry,
).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type OrchestrationStageHistory = typeof OrchestrationStageHistory.Type;

export const OrchestrationReadModel = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProject),
  threads: Schema.Array(OrchestrationThread),
  // Task aggregates (Plan 018 WP-D). `status` is derived purely from the
  // `task.*` event log by the projector — no `task.status.set` command exists.
  // The read model is reconstructed by `ProjectionSnapshotQuery` from the SQL
  // projection tables and then `Schema.decode`d, never persisted as a JSON
  // blob; a decoding default of `[]` mirrors the `proposedPlans` field above so
  // any snapshot produced before this field existed still decodes cleanly.
  tasks: Schema.Array(OrchestrationTask).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  pendingGates: Schema.optionalKey(Schema.Array(OrchestrationPendingGate)),
  quotaBlockedStages: Schema.Array(OrchestrationQuotaBlockedStage).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  stageHistory: OrchestrationStageHistory,
  updatedAt: IsoDateTime,
});
export type OrchestrationReadModel = typeof OrchestrationReadModel.Type;

export const OrchestrationProjectShell = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  roleModelSelections: Schema.optionalKey(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optionalKey(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optionalKey(OrchestratorConfigJson),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectShell = typeof OrchestrationProjectShell.Type;

export const OrchestrationThreadShell = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  session: Schema.NullOr(OrchestrationSession),
  latestUserMessageAt: Schema.NullOr(IsoDateTime),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});
export type OrchestrationThreadShell = typeof OrchestrationThreadShell.Type;

export const OrchestrationShellSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  projects: Schema.Array(OrchestrationProjectShell),
  threads: Schema.Array(OrchestrationThreadShell),
  updatedAt: IsoDateTime,
});
export type OrchestrationShellSnapshot = typeof OrchestrationShellSnapshot.Type;

export const OrchestrationShellStreamEvent = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("project-upserted"),
    sequence: NonNegativeInt,
    project: OrchestrationProjectShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("project-removed"),
    sequence: NonNegativeInt,
    projectId: ProjectId,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-upserted"),
    sequence: NonNegativeInt,
    thread: OrchestrationThreadShell,
  }),
  Schema.Struct({
    kind: Schema.Literal("thread-removed"),
    sequence: NonNegativeInt,
    threadId: ThreadId,
  }),
]);
export type OrchestrationShellStreamEvent = typeof OrchestrationShellStreamEvent.Type;

export const OrchestrationShellStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationShellSnapshot,
  }),
  OrchestrationShellStreamEvent,
]);
export type OrchestrationShellStreamItem = typeof OrchestrationShellStreamItem.Type;

export const OrchestrationSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type OrchestrationSubscribeThreadInput = typeof OrchestrationSubscribeThreadInput.Type;

export const OrchestrationThreadDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  thread: OrchestrationThread,
});
export type OrchestrationThreadDetailSnapshot = typeof OrchestrationThreadDetailSnapshot.Type;

export const ProjectCreateCommand = Schema.Struct({
  type: Schema.Literal("project.create"),
  commandId: CommandId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  createWorkspaceRootIfMissing: Schema.optional(Schema.Boolean),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  roleModelSelections: Schema.optional(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optional(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optional(OrchestratorConfigJson),
  createdAt: IsoDateTime,
});

const ProjectMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("project.meta.update"),
  commandId: CommandId,
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  roleModelSelections: Schema.optional(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optional(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optional(OrchestratorConfigJson),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
});

const ProjectDeleteCommand = Schema.Struct({
  type: Schema.Literal("project.delete"),
  commandId: CommandId,
  projectId: ProjectId,
  force: Schema.optional(Schema.Boolean),
});

const ThreadCreateCommand = Schema.Struct({
  type: Schema.Literal("thread.create"),
  commandId: CommandId,
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadDeleteCommand = Schema.Struct({
  type: Schema.Literal("thread.delete"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadArchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.archive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadUnarchiveCommand = Schema.Struct({
  type: Schema.Literal("thread.unarchive"),
  commandId: CommandId,
  threadId: ThreadId,
});

const ThreadMetaUpdateCommand = Schema.Struct({
  type: Schema.Literal("thread.meta.update"),
  commandId: CommandId,
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const ThreadRuntimeModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.runtime-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  createdAt: IsoDateTime,
});

const ThreadInteractionModeSetCommand = Schema.Struct({
  type: Schema.Literal("thread.interaction-mode.set"),
  commandId: CommandId,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode,
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapCreateThread = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const ThreadTurnStartBootstrapPrepareWorktree = Schema.Struct({
  projectCwd: TrimmedNonEmptyString,
  baseBranch: TrimmedNonEmptyString,
  branch: Schema.optional(TrimmedNonEmptyString),
});

const ThreadTurnStartBootstrap = Schema.Struct({
  createThread: Schema.optional(ThreadTurnStartBootstrapCreateThread),
  prepareWorktree: Schema.optional(ThreadTurnStartBootstrapPrepareWorktree),
  runSetupScript: Schema.optional(Schema.Boolean),
});

export type ThreadTurnStartBootstrap = typeof ThreadTurnStartBootstrap.Type;

export const ThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(ChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ClientThreadTurnStartCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.start"),
  commandId: CommandId,
  threadId: ThreadId,
  message: Schema.Struct({
    messageId: MessageId,
    role: Schema.Literal("user"),
    text: Schema.String,
    attachments: Schema.Array(UploadChatAttachment),
  }),
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  bootstrap: Schema.optional(ThreadTurnStartBootstrap),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

const ThreadTurnInterruptCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.interrupt"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadApprovalRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.approval.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputRespondCommand = Schema.Struct({
  type: Schema.Literal("thread.user-input.respond"),
  commandId: CommandId,
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

const ThreadCheckpointRevertCommand = Schema.Struct({
  type: Schema.Literal("thread.checkpoint.revert"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadSessionStopCommand = Schema.Struct({
  type: Schema.Literal("thread.session.stop"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const TaskCreateCommand = Schema.Struct({
  type: Schema.Literal("task.create"),
  commandId: CommandId,
  taskId: TaskId,
  projectId: ProjectId,
  taskType: TaskTypeId,
  title: TrimmedNonEmptyString,
  pmMessageId: Schema.NullOr(MessageId),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const TaskClassifyCommand = Schema.Struct({
  type: Schema.Literal("task.classify"),
  commandId: CommandId,
  taskId: TaskId,
  taskType: TaskTypeId,
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});

const TaskRoleSelectionsSetCommand = Schema.Struct({
  type: Schema.Literal("task.role-selections.set"),
  commandId: CommandId,
  taskId: TaskId,
  roleModelSelections: GedRoleModelSelections,
  origin: OrchestrationTaskRoleSelectionOrigin,
  createdAt: IsoDateTime,
});

/**
 * The handoff command. Internal/PM-dispatchable. The decider (WP-E) pins
 * `runtimeMode` and the role's model from config — they are intentionally **not**
 * accepted as command params so a hallucinated PM cannot escalate the worker.
 */
const TaskStageStartCommand = Schema.Struct({
  type: Schema.Literal("task.stage.start"),
  commandId: CommandId,
  taskId: TaskId,
  role: OrchestrationStageRole,
  instructions: Schema.String,
  createdAt: IsoDateTime,
});

const TaskStageCompleteCommand = Schema.Struct({
  type: Schema.Literal("task.stage.complete"),
  commandId: CommandId,
  taskId: TaskId,
  role: OrchestrationStageRole,
  stageThreadId: ThreadId,
  awaitedTurnId: Schema.NullOr(TurnId),
  // Whether the stage turn's diff was confirmed captured before completion.
  // Absent = normal completion (a real diff was present when the stage settled).
  // `false` = fail-loud completion via the diff-wait timeout (no confirmed diff).
  // Set by the orchestration runtime (apps/server); contracts stays schema-only.
  diffComplete: Schema.optional(Schema.Boolean),
  createdAt: IsoDateTime,
});

const TaskStageBlockCommand = Schema.Struct({
  type: Schema.Literal("task.stage.block"),
  commandId: CommandId,
  taskId: TaskId,
  stageThreadId: ThreadId,
  role: OrchestrationStageRole,
  reason: Schema.Literal("quota"),
  providerInstanceId: ProviderInstanceId,
  resetAt: Schema.optional(IsoDateTime),
  createdAt: IsoDateTime,
});

const TaskGateRequestCommand = Schema.Struct({
  type: Schema.Literal("task.gate.request"),
  commandId: CommandId,
  taskId: TaskId,
  gateId: GateId,
  gate: OrchestrationGateKind,
  contentHash: TrimmedNonEmptyString,
  stageThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
});

const TaskGateResolveCommand = Schema.Struct({
  type: Schema.Literal("task.gate.resolve"),
  commandId: CommandId,
  taskId: TaskId,
  gateId: GateId,
  gate: OrchestrationGateKind,
  approvedHash: TrimmedNonEmptyString,
  decision: OrchestrationGateDecision,
  origin: OrchestrationGateResolutionOrigin,
  createdAt: IsoDateTime,
});

const TaskLandCommand = Schema.Struct({
  type: Schema.Literal("task.land"),
  commandId: CommandId,
  taskId: TaskId,
  createdAt: IsoDateTime,
});

const TaskPrOpenedCommand = Schema.Struct({
  type: Schema.Literal("task.pr.opened"),
  commandId: CommandId,
  taskId: TaskId,
  prUrl: TrimmedNonEmptyString,
  prNumber: Schema.optional(PositiveInt),
  createdAt: IsoDateTime,
});

const TaskAbandonCommand = Schema.Struct({
  type: Schema.Literal("task.abandon"),
  commandId: CommandId,
  taskId: TaskId,
  createdAt: IsoDateTime,
});

const DispatchableClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
  TaskCreateCommand,
  TaskClassifyCommand,
  TaskRoleSelectionsSetCommand,
  TaskStageStartCommand,
  TaskGateRequestCommand,
  TaskGateResolveCommand,
  TaskLandCommand,
  TaskAbandonCommand,
]);
export type DispatchableClientOrchestrationCommand =
  typeof DispatchableClientOrchestrationCommand.Type;

export const ClientOrchestrationCommand = Schema.Union([
  ProjectCreateCommand,
  ProjectMetaUpdateCommand,
  ProjectDeleteCommand,
  ThreadCreateCommand,
  ThreadDeleteCommand,
  ThreadArchiveCommand,
  ThreadUnarchiveCommand,
  ThreadMetaUpdateCommand,
  ThreadRuntimeModeSetCommand,
  ThreadInteractionModeSetCommand,
  ClientThreadTurnStartCommand,
  ThreadTurnInterruptCommand,
  ThreadApprovalRespondCommand,
  ThreadUserInputRespondCommand,
  ThreadCheckpointRevertCommand,
  ThreadSessionStopCommand,
]);
export type ClientOrchestrationCommand = typeof ClientOrchestrationCommand.Type;

const ThreadSessionSetCommand = Schema.Struct({
  type: Schema.Literal("thread.session.set"),
  commandId: CommandId,
  threadId: ThreadId,
  session: OrchestrationSession,
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantDeltaCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.delta"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  delta: Schema.String,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageAssistantCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.message.assistant.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

const ThreadMessageUserAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.message.user.append"),
  commandId: CommandId,
  threadId: ThreadId,
  messageId: MessageId,
  text: Schema.String,
  createdAt: IsoDateTime,
});

const ThreadProposedPlanUpsertCommand = Schema.Struct({
  type: Schema.Literal("thread.proposed-plan.upsert"),
  commandId: CommandId,
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
  createdAt: IsoDateTime,
});

const ThreadTurnDiffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.turn.diff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnId: TurnId,
  completedAt: IsoDateTime,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.optional(MessageId),
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const ThreadActivityAppendCommand = Schema.Struct({
  type: Schema.Literal("thread.activity.append"),
  commandId: CommandId,
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
  createdAt: IsoDateTime,
});

const ThreadRevertCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.revert.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

const InternalOrchestrationCommand = Schema.Union([
  ThreadSessionSetCommand,
  ThreadMessageUserAppendCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  TaskStageCompleteCommand,
  TaskStageBlockCommand,
  TaskPrOpenedCommand,
]);
export type InternalOrchestrationCommand = typeof InternalOrchestrationCommand.Type;

export const OrchestrationCommand = Schema.Union([
  DispatchableClientOrchestrationCommand,
  InternalOrchestrationCommand,
]);
export type OrchestrationCommand = typeof OrchestrationCommand.Type;

export const OrchestrationEventType = Schema.Literals([
  "project.created",
  "project.meta-updated",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.turn-start-requested",
  "thread.turn-interrupt-requested",
  "thread.approval-response-requested",
  "thread.user-input-response-requested",
  "thread.checkpoint-revert-requested",
  "thread.reverted",
  "thread.session-stop-requested",
  "thread.session-set",
  "thread.proposed-plan-upserted",
  "thread.turn-diff-completed",
  "thread.activity-appended",
  "task.created",
  "task.classified",
  "task.role-selections-updated",
  "task.stage-started",
  "task.stage-completed",
  "task.stage-blocked",
  "task.gate-requested",
  "task.gate-resolved",
  "task.landed",
  "task.pr-opened",
  "task.abandoned",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals(["project", "thread", "task"]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  roleModelSelections: Schema.optionalKey(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optionalKey(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optionalKey(OrchestratorConfigJson),
  scripts: Schema.Array(ProjectScript),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectMetaUpdatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: Schema.optional(TrimmedNonEmptyString),
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.optional(Schema.NullOr(ModelSelection)),
  roleModelSelections: Schema.optional(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optional(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optional(OrchestratorConfigJson),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ThreadCreatedPayload = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadDeletedPayload = Schema.Struct({
  threadId: ThreadId,
  deletedAt: IsoDateTime,
});

export const ThreadArchivedPayload = Schema.Struct({
  threadId: ThreadId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadUnarchivedPayload = Schema.Struct({
  threadId: ThreadId,
  updatedAt: IsoDateTime,
});

export const ThreadMetaUpdatedPayload = Schema.Struct({
  threadId: ThreadId,
  title: Schema.optional(TrimmedNonEmptyString),
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  branch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  worktreePath: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: IsoDateTime,
});

export const ThreadRuntimeModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  runtimeMode: RuntimeMode,
  updatedAt: IsoDateTime,
});

export const ThreadInteractionModeSetPayload = Schema.Struct({
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  updatedAt: IsoDateTime,
});

export const ThreadMessageSentPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  role: OrchestrationMessageRole,
  text: Schema.String,
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ThreadTurnStartRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  messageId: MessageId,
  modelSelection: Schema.optional(ModelSelection),
  gedWorkflowEnabled: Schema.optionalKey(Schema.Boolean),
  titleSeed: Schema.optional(TrimmedNonEmptyString),
  runtimeMode: RuntimeMode.pipe(Schema.withDecodingDefault(Effect.succeed(DEFAULT_RUNTIME_MODE))),
  interactionMode: ProviderInteractionMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PROVIDER_INTERACTION_MODE)),
  ),
  sourceProposedPlan: Schema.optional(SourceProposedPlanReference),
  createdAt: IsoDateTime,
});

export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: Schema.optional(TurnId),
  createdAt: IsoDateTime,
});

export const ThreadApprovalResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
  createdAt: IsoDateTime,
});

const ThreadUserInputResponseRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  requestId: ApprovalRequestId,
  answers: ProviderUserInputAnswers,
  createdAt: IsoDateTime,
});

export const ThreadCheckpointRevertRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export const ThreadRevertedPayload = Schema.Struct({
  threadId: ThreadId,
  turnCount: NonNegativeInt,
});

export const ThreadSessionStopRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ThreadSessionSetPayload = Schema.Struct({
  threadId: ThreadId,
  session: OrchestrationSession,
});

export const ThreadProposedPlanUpsertedPayload = Schema.Struct({
  threadId: ThreadId,
  proposedPlan: OrchestrationProposedPlan,
});

export const ThreadTurnDiffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});

export const ThreadActivityAppendedPayload = Schema.Struct({
  threadId: ThreadId,
  activity: OrchestrationThreadActivity,
});

export const TaskCreatedPayload = Schema.Struct({
  taskId: TaskId,
  projectId: ProjectId,
  taskType: TaskTypeId,
  title: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  pmMessageId: Schema.NullOr(MessageId),
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskClassifiedPayload = Schema.Struct({
  taskId: TaskId,
  taskType: TaskTypeId,
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const TaskRoleSelectionsUpdatedPayload = Schema.Struct({
  taskId: TaskId,
  roleModelSelections: GedRoleModelSelections,
  origin: OrchestrationTaskRoleSelectionOrigin,
  updatedAt: IsoDateTime,
});

export const TaskStageStartedPayload = Schema.Struct({
  taskId: TaskId,
  role: OrchestrationStageRole,
  stageThreadId: ThreadId,
  awaitedTurnId: Schema.NullOr(TurnId),
  // Resolved backend/model for this stage, stamped by the decider at start so the
  // stage-history projection and the web timeline record what actually ran rather
  // than re-resolving config. Optional for append-only compatibility: events
  // appended before these fields existed still decode, and projections fall back
  // to re-deriving the selection from config when they are absent.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  model: Schema.optional(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const TaskStageCompletedPayload = Schema.Struct({
  taskId: TaskId,
  role: OrchestrationStageRole,
  stageThreadId: ThreadId,
  awaitedTurnId: Schema.NullOr(TurnId),
  // Mirrors `TaskStageCompleteCommand.diffComplete`: absent = a real diff was
  // present at completion; `false` = completed via the fail-loud diff-wait
  // timeout. Optional so existing consumers and on-disk events are unaffected.
  diffComplete: Schema.optional(Schema.Boolean),
  updatedAt: IsoDateTime,
});

export const TaskStageBlockedPayload = Schema.Struct({
  taskId: TaskId,
  role: OrchestrationStageRole,
  stageThreadId: ThreadId,
  reason: Schema.Literal("quota"),
  providerInstanceId: ProviderInstanceId,
  resetAt: Schema.optional(IsoDateTime),
  updatedAt: IsoDateTime,
});

export const TaskGateRequestedPayload = Schema.Struct({
  taskId: TaskId,
  gateId: GateId,
  gate: OrchestrationGateKind,
  contentHash: TrimmedNonEmptyString,
  stageThreadId: Schema.NullOr(ThreadId),
  updatedAt: IsoDateTime,
});

export const TaskGateResolvedPayload = Schema.Struct({
  taskId: TaskId,
  gateId: GateId,
  gate: OrchestrationGateKind,
  approvedHash: TrimmedNonEmptyString,
  decision: OrchestrationGateDecision,
  origin: OrchestrationGateResolutionOrigin,
  updatedAt: IsoDateTime,
});

export const TaskLandedPayload = Schema.Struct({
  taskId: TaskId,
  updatedAt: IsoDateTime,
});

export const TaskPrOpenedPayload = Schema.Struct({
  taskId: TaskId,
  prUrl: TrimmedNonEmptyString,
  prNumber: Schema.optional(PositiveInt),
  updatedAt: IsoDateTime,
});

export const TaskAbandonedPayload = Schema.Struct({
  taskId: TaskId,
  updatedAt: IsoDateTime,
});

export const OrchestrationEventMetadata = Schema.Struct({
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
  providerItemId: Schema.optional(ProviderItemId),
  adapterKey: Schema.optional(TrimmedNonEmptyString),
  requestId: Schema.optional(ApprovalRequestId),
  ingestedAt: Schema.optional(IsoDateTime),
});
export type OrchestrationEventMetadata = typeof OrchestrationEventMetadata.Type;

const EventBaseFields = {
  sequence: NonNegativeInt,
  eventId: EventId,
  aggregateKind: OrchestrationAggregateKind,
  aggregateId: Schema.Union([ProjectId, ThreadId, TaskId]),
  occurredAt: IsoDateTime,
  commandId: Schema.NullOr(CommandId),
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  metadata: OrchestrationEventMetadata,
} as const;

export const OrchestrationEvent = Schema.Union([
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.created"),
    payload: ProjectCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.meta-updated"),
    payload: ProjectMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.deleted"),
    payload: ProjectDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.created"),
    payload: ThreadCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.deleted"),
    payload: ThreadDeletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.archived"),
    payload: ThreadArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.unarchived"),
    payload: ThreadUnarchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.meta-updated"),
    payload: ThreadMetaUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.runtime-mode-set"),
    payload: ThreadRuntimeModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.interaction-mode-set"),
    payload: ThreadInteractionModeSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.message-sent"),
    payload: ThreadMessageSentPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-start-requested"),
    payload: ThreadTurnStartRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-interrupt-requested"),
    payload: ThreadTurnInterruptRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.approval-response-requested"),
    payload: ThreadApprovalResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.user-input-response-requested"),
    payload: ThreadUserInputResponseRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.checkpoint-revert-requested"),
    payload: ThreadCheckpointRevertRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.reverted"),
    payload: ThreadRevertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-stop-requested"),
    payload: ThreadSessionStopRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.session-set"),
    payload: ThreadSessionSetPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.proposed-plan-upserted"),
    payload: ThreadProposedPlanUpsertedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.turn-diff-completed"),
    payload: ThreadTurnDiffCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.activity-appended"),
    payload: ThreadActivityAppendedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.created"),
    payload: TaskCreatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.classified"),
    payload: TaskClassifiedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.role-selections-updated"),
    payload: TaskRoleSelectionsUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.stage-started"),
    payload: TaskStageStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.stage-completed"),
    payload: TaskStageCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.stage-blocked"),
    payload: TaskStageBlockedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.gate-requested"),
    payload: TaskGateRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.gate-resolved"),
    payload: TaskGateResolvedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.landed"),
    payload: TaskLandedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.pr-opened"),
    payload: TaskPrOpenedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.abandoned"),
    payload: TaskAbandonedPayload,
  }),
]);
export type OrchestrationEvent = typeof OrchestrationEvent.Type;

export const OrchestrationThreadStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestrationThreadDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestrationThreadStreamItem = typeof OrchestrationThreadStreamItem.Type;

export const OrchestratorSendMessageInput = Schema.Struct({
  projectId: ProjectId,
  message: TrimmedNonEmptyString,
});
export type OrchestratorSendMessageInput = typeof OrchestratorSendMessageInput.Type;

export const OrchestratorSendMessageResult = Schema.Struct({
  accepted: Schema.Literal(true),
});
export type OrchestratorSendMessageResult = typeof OrchestratorSendMessageResult.Type;

export const OrchestratorSubscribeProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestratorSubscribeProjectInput = typeof OrchestratorSubscribeProjectInput.Type;

export const OrchestratorProjectDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  project: OrchestrationProject,
  pmThreadId: ThreadId,
  pmThread: Schema.NullOr(OrchestrationThread),
  // Project-wide PM quota block, when the PM provider instance itself is parked.
  // `null` means the PM is currently available or no PM instance is configured.
  pmQuotaBlock: Schema.NullOr(OrchestrationPmQuotaBlock).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  tasks: Schema.Array(OrchestrationTask),
  pendingGates: Schema.Array(OrchestrationPendingGate),
  // Active quota-blocked stages for this project's tasks, so the web can surface
  // a "resets ~HH:MM" badge on a blocked-on-quota task at subscribe time (it is
  // then kept live by the streamed `task.stage-blocked` / `task.stage.start`
  // events). Decoding default keeps older snapshots without the field valid.
  quotaBlockedStages: Schema.Array(OrchestrationQuotaBlockedStage).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  stageHistory: OrchestrationStageHistory,
});
export type OrchestratorProjectDetailSnapshot = typeof OrchestratorProjectDetailSnapshot.Type;

export const OrchestratorProjectStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestratorProjectDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestratorProjectStreamItem = typeof OrchestratorProjectStreamItem.Type;

export const OrchestratorSubscribeTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorSubscribeTaskInput = typeof OrchestratorSubscribeTaskInput.Type;

export const OrchestratorTaskDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  task: OrchestrationTask,
  pendingGates: Schema.Array(OrchestrationPendingGate),
  stageHistory: OrchestrationStageHistory,
});
export type OrchestratorTaskDetailSnapshot = typeof OrchestratorTaskDetailSnapshot.Type;

export const OrchestratorTaskStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: OrchestratorTaskDetailSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("event"),
    event: OrchestrationEvent,
  }),
]);
export type OrchestratorTaskStreamItem = typeof OrchestratorTaskStreamItem.Type;

export const OrchestratorResolveGateInput = Schema.Struct({
  taskId: TaskId,
  gateId: GateId,
  gate: OrchestrationGateKind,
  approvedHash: TrimmedNonEmptyString,
  decision: OrchestrationGateDecision,
});
export type OrchestratorResolveGateInput = typeof OrchestratorResolveGateInput.Type;

export const OrchestratorSetTaskRoleSelectionsInput = Schema.Struct({
  taskId: TaskId,
  roleModelSelections: GedRoleModelSelections,
});
export type OrchestratorSetTaskRoleSelectionsInput =
  typeof OrchestratorSetTaskRoleSelectionsInput.Type;

export const OrchestrationCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type OrchestrationCommandReceiptStatus = typeof OrchestrationCommandReceiptStatus.Type;

export const TurnCountRange = Schema.Struct({
  fromTurnCount: NonNegativeInt,
  toTurnCount: NonNegativeInt,
}).check(
  Schema.makeFilter(
    (input) =>
      input.fromTurnCount <= input.toTurnCount ||
      new SchemaIssue.InvalidValue(Option.some(input.fromTurnCount), {
        message: "fromTurnCount must be less than or equal to toTurnCount",
      }),
    { identifier: "OrchestrationTurnDiffRange" },
  ),
);

export const ThreadTurnDiff = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    diff: Schema.String,
  }),
  { unsafePreserveChecks: true },
);

export const ProviderSessionRuntimeStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "error",
]);
export type ProviderSessionRuntimeStatus = typeof ProviderSessionRuntimeStatus.Type;

const ProjectionThreadTurnStatus = Schema.Literals([
  "running",
  "completed",
  "interrupted",
  "error",
]);
export type ProjectionThreadTurnStatus = typeof ProjectionThreadTurnStatus.Type;

const ProjectionCheckpointRow = Schema.Struct({
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: OrchestrationCheckpointStatus,
  files: Schema.Array(OrchestrationCheckpointFile),
  assistantMessageId: Schema.NullOr(MessageId),
  completedAt: IsoDateTime,
});
export type ProjectionCheckpointRow = typeof ProjectionCheckpointRow.Type;

export const ProjectionPendingApprovalStatus = Schema.Literals(["pending", "resolved"]);
export type ProjectionPendingApprovalStatus = typeof ProjectionPendingApprovalStatus.Type;

export const ProjectionPendingApprovalDecision = Schema.NullOr(ProviderApprovalDecision);
export type ProjectionPendingApprovalDecision = typeof ProjectionPendingApprovalDecision.Type;

export const DispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type DispatchResult = typeof DispatchResult.Type;

export const OrchestrationGetTurnDiffInput = TurnCountRange.mapFields(
  Struct.assign({
    threadId: ThreadId,
    ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
  }),
  { unsafePreserveChecks: true },
);
export type OrchestrationGetTurnDiffInput = typeof OrchestrationGetTurnDiffInput.Type;

export const OrchestrationGetTurnDiffResult = ThreadTurnDiff;
export type OrchestrationGetTurnDiffResult = typeof OrchestrationGetTurnDiffResult.Type;

export const OrchestrationGetFullThreadDiffInput = Schema.Struct({
  threadId: ThreadId,
  toTurnCount: NonNegativeInt,
  ignoreWhitespace: Schema.optionalKey(Schema.Boolean),
});
export type OrchestrationGetFullThreadDiffInput = typeof OrchestrationGetFullThreadDiffInput.Type;

export const OrchestrationGetFullThreadDiffResult = ThreadTurnDiff;
export type OrchestrationGetFullThreadDiffResult = typeof OrchestrationGetFullThreadDiffResult.Type;

export const OrchestrationReplayEventsInput = Schema.Struct({
  fromSequenceExclusive: NonNegativeInt,
});
export type OrchestrationReplayEventsInput = typeof OrchestrationReplayEventsInput.Type;

const OrchestrationReplayEventsResult = Schema.Array(OrchestrationEvent);
export type OrchestrationReplayEventsResult = typeof OrchestrationReplayEventsResult.Type;

export const OrchestrationRpcSchemas = {
  dispatchCommand: {
    input: ClientOrchestrationCommand,
    output: DispatchResult,
  },
  getTurnDiff: {
    input: OrchestrationGetTurnDiffInput,
    output: OrchestrationGetTurnDiffResult,
  },
  getFullThreadDiff: {
    input: OrchestrationGetFullThreadDiffInput,
    output: OrchestrationGetFullThreadDiffResult,
  },
  replayEvents: {
    input: OrchestrationReplayEventsInput,
    output: OrchestrationReplayEventsResult,
  },
  getArchivedShellSnapshot: {
    input: Schema.Struct({}),
    output: OrchestrationShellSnapshot,
  },
  subscribeThread: {
    input: OrchestrationSubscribeThreadInput,
    output: OrchestrationThreadStreamItem,
  },
  subscribeShell: {
    input: Schema.Struct({}),
    output: OrchestrationShellStreamItem,
  },
} as const;

export const OrchestratorRpcSchemas = {
  sendMessage: {
    input: OrchestratorSendMessageInput,
    output: OrchestratorSendMessageResult,
  },
  subscribeProject: {
    input: OrchestratorSubscribeProjectInput,
    output: OrchestratorProjectStreamItem,
  },
  subscribeTask: {
    input: OrchestratorSubscribeTaskInput,
    output: OrchestratorTaskStreamItem,
  },
  resolveGate: {
    input: OrchestratorResolveGateInput,
    output: DispatchResult,
  },
  setTaskRoleSelections: {
    input: OrchestratorSetTaskRoleSelectionsInput,
    output: DispatchResult,
  },
} as const;

export class OrchestrationGetSnapshotError extends Schema.TaggedErrorClass<OrchestrationGetSnapshotError>()(
  "OrchestrationGetSnapshotError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationDispatchCommandError extends Schema.TaggedErrorClass<OrchestrationDispatchCommandError>()(
  "OrchestrationDispatchCommandError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetTurnDiffError extends Schema.TaggedErrorClass<OrchestrationGetTurnDiffError>()(
  "OrchestrationGetTurnDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationGetFullThreadDiffError extends Schema.TaggedErrorClass<OrchestrationGetFullThreadDiffError>()(
  "OrchestrationGetFullThreadDiffError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationReplayEventsError extends Schema.TaggedErrorClass<OrchestrationReplayEventsError>()(
  "OrchestrationReplayEventsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
