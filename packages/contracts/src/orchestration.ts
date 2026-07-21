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
  HelperRunId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  PositiveInt,
  ProjectContextRunId,
  ProjectId,
  ProviderItemId,
  TaskId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import {
  OrchestratorLaunchCapabilities,
  OrchestratorLaunchInput,
  OrchestratorLaunchResult,
} from "./editor.ts";

export const ORCHESTRATION_WS_METHODS = {
  dispatchCommand: "orchestration.dispatchCommand",
  forkThread: "orchestration.forkThread",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  replayEvents: "orchestration.replayEvents",
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  subscribeShell: "orchestration.subscribeShell",
  subscribeThread: "orchestration.subscribeThread",
} as const;

export const ORCHESTRATOR_WS_METHODS = {
  getPresetMigration: "orchestrator.getPresetMigration",
  completePresetMigration: "orchestrator.completePresetMigration",
  sendMessage: "orchestrator.sendMessage",
  subscribeProject: "orchestrator.subscribeProject",
  subscribeTask: "orchestrator.subscribeTask",
  resolveGate: "orchestrator.resolveGate",
  setTaskCapabilityTiers: "orchestrator.setTaskCapabilityTiers",
  cancelTask: "orchestrator.cancelTask",
  interruptStage: "orchestrator.interruptStage",
  inspectTaskChanges: "orchestrator.inspectTaskChanges",
  commitTaskChanges: "orchestrator.commitTaskChanges",
  discardTaskChanges: "orchestrator.discardTaskChanges",
  returnTaskChanges: "orchestrator.returnTaskChanges",
  completeTaskWithoutChanges: "orchestrator.completeTaskWithoutChanges",
  landTask: "orchestrator.landTask",
  listArchivedTasks: "orchestrator.listArchivedTasks",
  archiveTask: "orchestrator.archiveTask",
  restoreTask: "orchestrator.restoreTask",
  deleteTask: "orchestrator.deleteTask",
  clearPmChat: "orchestrator.clearPmChat",
  requestPmHandoff: "orchestrator.requestPmHandoff",
  requestProjectContextRun: "orchestrator.requestProjectContextRun",
  resolveProjectContextRunStart: "orchestrator.resolveProjectContextRunStart",
  cancelProjectContextRunStart: "orchestrator.cancelProjectContextRunStart",
  getProjectContextRunReview: "orchestrator.getProjectContextRunReview",
  getLaunchCapabilities: "orchestrator.getLaunchCapabilities",
  launch: "orchestrator.launch",
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
export const ProviderApprovalReviewer = Schema.Literals(["user", "auto-review"]);
export type ProviderApprovalReviewer = typeof ProviderApprovalReviewer.Type;
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

export const ORCHESTRATION_STAGE_ROLES = ["plan", "work", "verify"] as const;

/**
 * Stage role within a task pipeline. Closed so every runtime mapping and UI
 * projection is exhaustiveness-checked when roles are added.
 */
export const OrchestrationStageRole = Schema.Literals(ORCHESTRATION_STAGE_ROLES);
export type OrchestrationStageRole = typeof OrchestrationStageRole.Type;

export const ORCHESTRATION_CAPABILITY_TIERS = ["cheap", "smart", "genius"] as const;
export const OrchestrationCapabilityTier = Schema.Literals(ORCHESTRATION_CAPABILITY_TIERS);
export type OrchestrationCapabilityTier = typeof OrchestrationCapabilityTier.Type;

const ORCHESTRATION_CAPABILITY_TIER_SET = new Set<string>(ORCHESTRATION_CAPABILITY_TIERS);
const CapabilityPresetSource = Schema.Record(Schema.String, ModelSelection);
const CompleteCapabilityPresetMap = Schema.Struct({
  cheap: ModelSelection,
  smart: ModelSelection,
  genius: ModelSelection,
});
const CapabilityPresetOverrideMap = Schema.Struct({
  cheap: Schema.optionalKey(ModelSelection),
  smart: Schema.optionalKey(ModelSelection),
  genius: Schema.optionalKey(ModelSelection),
});

const makeCapabilityPresetMap = <Target extends Schema.Top>(target: Target) =>
  CapabilityPresetSource.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformOrFail({
        decode: (value: Record<string, unknown>) => {
          const unknownKeys = Object.keys(value).filter(
            (key) => !ORCHESTRATION_CAPABILITY_TIER_SET.has(key),
          );
          if (unknownKeys.length > 0) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(Option.some(unknownKeys.join(", ")), {
                message: `Unknown capability preset key(s): ${unknownKeys.join(", ")}`,
              }),
            );
          }
          return Effect.succeed(value as typeof target.Encoded);
        },
        encode: (value) => Effect.succeed(value as typeof CapabilityPresetSource.Type),
      }) as never,
    ),
  );

export const OrchestrationCapabilityPresets = makeCapabilityPresetMap(CompleteCapabilityPresetMap);
export type OrchestrationCapabilityPresets = typeof OrchestrationCapabilityPresets.Type;
export const OrchestrationCapabilityPresetOverrides = makeCapabilityPresetMap(
  CapabilityPresetOverrideMap,
).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type OrchestrationCapabilityPresetOverrides =
  typeof OrchestrationCapabilityPresetOverrides.Type;

const ORCHESTRATION_STAGE_ROLE_SET = new Set<string>(ORCHESTRATION_STAGE_ROLES);

const makeStageRoleKeyedMap = <Value extends Schema.Top>(
  valueSchema: Value,
  ignoredDecodeKeys: ReadonlySet<string> = new Set(),
) => {
  const source = Schema.Record(Schema.String, valueSchema);
  const target = Schema.Struct({
    plan: Schema.optionalKey(valueSchema),
    work: Schema.optionalKey(valueSchema),
    verify: Schema.optionalKey(valueSchema),
  });
  return source.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformOrFail({
        decode: (value: Record<string, unknown>) => {
          const unknownKeys = Object.keys(value).filter(
            (key) => !ORCHESTRATION_STAGE_ROLE_SET.has(key) && !ignoredDecodeKeys.has(key),
          );
          if (unknownKeys.length > 0) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(Option.some(unknownKeys.join(", ")), {
                message: `Unknown orchestration stage role key(s): ${unknownKeys.join(", ")}`,
              }),
            );
          }
          return Effect.succeed(
            Object.fromEntries(
              Object.entries(value).filter(([key]) => ORCHESTRATION_STAGE_ROLE_SET.has(key)),
            ) as typeof target.Type,
          );
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

export const GedRoleCapabilityTiers = makeStageRoleKeyedMap(OrchestrationCapabilityTier).pipe(
  Schema.withDecodingDefault(Effect.succeed({})),
);
export type GedRoleCapabilityTiers = typeof GedRoleCapabilityTiers.Type;

export const GedRolePromptPrefixes = makeStageRoleKeyedMap(TrimmedNonEmptyString).pipe(
  Schema.withDecodingDefault(Effect.succeed({})),
);
export type GedRolePromptPrefixes = typeof GedRolePromptPrefixes.Type;

// Historical events are immutable. Their retired role keys are discarded only
// while decoding persisted event payloads; current command/read-model schemas
// above remain strict and reject every unknown role.
const LEGACY_ORCHESTRATION_STAGE_ROLE_KEYS = new Set(["classify", "review"]);
const PersistedGedRoleModelSelections = makeStageRoleKeyedMap(
  ModelSelection,
  LEGACY_ORCHESTRATION_STAGE_ROLE_KEYS,
);
const PersistedGedRolePromptPrefixes = makeStageRoleKeyedMap(
  TrimmedNonEmptyString,
  LEGACY_ORCHESTRATION_STAGE_ROLE_KEYS,
);

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
export const ProviderRequestKind = Schema.Literals([
  "command",
  "file-read",
  "file-change",
  "permissions",
  "auto-review",
]);
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

export const ProjectContextFingerprint = TrimmedNonEmptyString.check(
  Schema.isPattern(/^sha256:[a-f0-9]{64}$/),
).pipe(Schema.brand("ProjectContextFingerprint"));
export type ProjectContextFingerprint = typeof ProjectContextFingerprint.Type;

export const ProjectContextSchemaVersion = PositiveInt.pipe(
  Schema.brand("ProjectContextSchemaVersion"),
);
export type ProjectContextSchemaVersion = typeof ProjectContextSchemaVersion.Type;

export const ProjectContextResolutionOutcome = Schema.Literals(["dismissed", "completed"]);
export type ProjectContextResolutionOutcome = typeof ProjectContextResolutionOutcome.Type;

/** A content-free classification emitted by the server-side context scanner. */
export const ProjectContextFileClassification = Schema.Literals([
  "missing",
  "empty",
  "whitespace",
  "template",
  "substantive",
]);
export type ProjectContextFileClassification = typeof ProjectContextFileClassification.Type;

export const ProjectContextPromptKind = Schema.Literals(["populate", "review"]);
export type ProjectContextPromptKind = typeof ProjectContextPromptKind.Type;

/**
 * The latest user resolution of project-context onboarding for one exact
 * scanner schema and content fingerprint. Earlier resolutions remain in the
 * append-only project event stream.
 */
export const ProjectContextResolution = Schema.Struct({
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  outcome: ProjectContextResolutionOutcome,
  resolvedAt: IsoDateTime,
});
export type ProjectContextResolution = typeof ProjectContextResolution.Type;

export const OrchestrationProject = Schema.Struct({
  id: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  roleModelSelections: Schema.optionalKey(GedRoleModelSelections),
  rolePromptPrefixes: Schema.optionalKey(GedRolePromptPrefixes),
  orchestratorConfig: Schema.optionalKey(OrchestratorConfigJson),
  projectContextResolution: Schema.optionalKey(
    Schema.NullOr(ProjectContextResolution).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  ),
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

export const PmHandoffMode = Schema.Literals(["transcript", "summary"]);
export type PmHandoffMode = typeof PmHandoffMode.Type;

export const PendingPmHandoff = Schema.Struct({
  mode: PmHandoffMode,
  brief: Schema.optional(Schema.String),
  requestedAt: IsoDateTime,
});
export type PendingPmHandoff = typeof PendingPmHandoff.Type;

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
  lastClearedSequence: Schema.optional(NonNegativeInt),
  pendingPmHandoff: Schema.NullOr(PendingPmHandoff).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
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
  "change-review",
  "verifying",
  "landed",
  "no-changes-needed",
  "abandoned",
  "blocked",
  "blocked-on-quota",
]);
export type OrchestrationTaskStatus = typeof OrchestrationTaskStatus.Type;

export const OrchestrationTaskChangeReviewResolution = Schema.Literals([
  "committed",
  "discarded",
  "returned",
]);
export type OrchestrationTaskChangeReviewResolution =
  typeof OrchestrationTaskChangeReviewResolution.Type;

export const OrchestrationTaskChangeReview = Schema.Struct({
  status: Schema.Literals(["pending", "resolved"]),
  workStageThreadId: ThreadId,
  detectedHead: TrimmedNonEmptyString,
  resolution: Schema.NullOr(OrchestrationTaskChangeReviewResolution),
  requestedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationTaskChangeReview = typeof OrchestrationTaskChangeReview.Type;

export const OrchestrationTaskVerification = Schema.Struct({
  stageThreadId: ThreadId,
  head: TrimmedNonEmptyString,
  verifiedAt: IsoDateTime,
});
export type OrchestrationTaskVerification = typeof OrchestrationTaskVerification.Type;

export const OrchestrationTaskNoChangesNeeded = Schema.Struct({
  baseHead: TrimmedNonEmptyString,
  head: TrimmedNonEmptyString,
  completedAt: IsoDateTime,
});
export type OrchestrationTaskNoChangesNeeded = typeof OrchestrationTaskNoChangesNeeded.Type;

export const OrchestrationTaskWorktreeCompletion = Schema.Struct({
  head: TrimmedNonEmptyString,
  dirty: Schema.Boolean,
});
export type OrchestrationTaskWorktreeCompletion = typeof OrchestrationTaskWorktreeCompletion.Type;

export const OrchestrationTaskCancellationShutdownPhase = Schema.Literals([
  "interrupt-turn",
  "stop-session",
  "close-terminals",
]);
export type OrchestrationTaskCancellationShutdownPhase =
  typeof OrchestrationTaskCancellationShutdownPhase.Type;

export const OrchestrationTaskCancellationPhase = Schema.Literals([
  ...OrchestrationTaskCancellationShutdownPhase.literals,
  "abandon",
]);
export type OrchestrationTaskCancellationPhase = typeof OrchestrationTaskCancellationPhase.Type;

export const OrchestrationTaskCancellation = Schema.Struct({
  requestedAt: IsoDateTime,
  completedPhases: Schema.optionalKey(Schema.Array(OrchestrationTaskCancellationShutdownPhase)),
  failurePhase: Schema.NullOr(OrchestrationTaskCancellationPhase),
  failureMessage: Schema.NullOr(TrimmedNonEmptyString),
  failedAt: Schema.NullOr(IsoDateTime),
});
export type OrchestrationTaskCancellation = typeof OrchestrationTaskCancellation.Type;

export const OrchestrationTaskLandingStatus = Schema.Literals([
  "opening-pr",
  "failed",
  "completed",
]);
export type OrchestrationTaskLandingStatus = typeof OrchestrationTaskLandingStatus.Type;

export const OrchestrationTaskLanding = Schema.Struct({
  status: OrchestrationTaskLandingStatus,
  failureMessage: Schema.NullOr(TrimmedNonEmptyString),
  branchPushed: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type OrchestrationTaskLanding = typeof OrchestrationTaskLanding.Type;

export const OrchestrationReleaseDispatchStatus = Schema.Literals([
  "dispatching",
  "dispatched",
  "failed",
]);
export type OrchestrationReleaseDispatchStatus = typeof OrchestrationReleaseDispatchStatus.Type;

export const OrchestrationReleaseDispatch = Schema.Struct({
  status: OrchestrationReleaseDispatchStatus,
  workflow: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  inputs: Schema.Record(TrimmedNonEmptyString, Schema.String),
  contentHash: TrimmedNonEmptyString,
  workflowUrl: Schema.NullOr(TrimmedNonEmptyString),
  failureMessage: Schema.NullOr(TrimmedNonEmptyString),
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrchestrationReleaseDispatch = typeof OrchestrationReleaseDispatch.Type;

export const OrchestrationTaskAggregateProgress = Schema.Struct({
  total: NonNegativeInt,
  terminal: NonNegativeInt,
  landed: NonNegativeInt,
  abandoned: NonNegativeInt,
});
export type OrchestrationTaskAggregateProgress = typeof OrchestrationTaskAggregateProgress.Type;

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
  parentTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  childOrder: Schema.optionalKey(Schema.NullOr(NonNegativeInt)),
  aggregateProgress: Schema.optionalKey(Schema.NullOr(OrchestrationTaskAggregateProgress)),
  acceptanceCriteria: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  dependsOnTaskIds: Schema.optionalKey(Schema.Array(TaskId)),
  supersedesTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  supersededByTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  cancellation: Schema.optionalKey(Schema.NullOr(OrchestrationTaskCancellation)),
  changeReview: Schema.NullOr(OrchestrationTaskChangeReview).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  verification: Schema.NullOr(OrchestrationTaskVerification).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  noChangesNeeded: Schema.NullOr(OrchestrationTaskNoChangesNeeded).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  landing: Schema.NullOr(OrchestrationTaskLanding).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  releaseDispatch: Schema.optionalKey(Schema.NullOr(OrchestrationReleaseDispatch)),
  roleCapabilityTiers: Schema.optionalKey(GedRoleCapabilityTiers),
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  archivedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type OrchestrationTask = typeof OrchestrationTask.Type;

/**
 * The gates that can guard a task. Publishing gates (`land` and `release`) are
 * hard-pinned to require approval. Closed so config + the decider's
 * `requireGateSatisfied` invariant are exhaustiveness-checked together.
 */
export const OrchestrationGateKind = Schema.Literals(["plan", "land", "release"]);
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

export const OrchestrationTaskTierSelectionOrigin = Schema.Literals([
  "human",
  "client",
  "pm-runtime",
]);
export type OrchestrationTaskTierSelectionOrigin = typeof OrchestrationTaskTierSelectionOrigin.Type;

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

export const OrchestrationStageHistoryStatus = Schema.Literals([
  "running",
  "completed",
  "blocked",
  "interrupted",
]);
export type OrchestrationStageHistoryStatus = typeof OrchestrationStageHistoryStatus.Type;

export const OrchestrationStageHistoryEntry = Schema.Struct({
  projectId: ProjectId,
  taskId: TaskId,
  stageThreadId: ThreadId,
  role: OrchestrationStageRole,
  capabilityTier: Schema.NullOr(OrchestrationCapabilityTier).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  modelOptions: Schema.NullOr(ProviderOptionSelections).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  runtimeMode: Schema.optionalKey(Schema.NullOr(RuntimeMode)),
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

export const HELPER_RUN_PROMPT_MAX_CHARS = 16_000;
export const HELPER_RUN_RESULT_MAX_CHARS = 32_000;
export const HELPER_RUN_FAILURE_MAX_CHARS = 4_000;

export const OrchestrationHelperRunAttachment = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("pm"),
    threadId: ThreadId,
  }),
  Schema.Struct({
    kind: Schema.Literal("task"),
    taskId: TaskId,
  }),
]);
export type OrchestrationHelperRunAttachment = typeof OrchestrationHelperRunAttachment.Type;

export const OrchestrationHelperRunStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
]);
export type OrchestrationHelperRunStatus = typeof OrchestrationHelperRunStatus.Type;

export const OrchestrationHelperRun = Schema.Struct({
  id: HelperRunId,
  projectId: ProjectId,
  attachment: OrchestrationHelperRunAttachment,
  accessMode: Schema.Literal("read-only"),
  tier: OrchestrationCapabilityTier,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(HELPER_RUN_PROMPT_MAX_CHARS)),
  status: OrchestrationHelperRunStatus,
  providerThreadId: Schema.NullOr(ThreadId),
  result: Schema.NullOr(Schema.String.check(Schema.isMaxLength(HELPER_RUN_RESULT_MAX_CHARS))),
  failureMessage: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(HELPER_RUN_FAILURE_MAX_CHARS)),
  ),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type OrchestrationHelperRun = typeof OrchestrationHelperRun.Type;

export const PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS = 16_000;
export const PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS = 32_000;
export const PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS = 4_000;
export const PROJECT_CONTEXT_RUN_FILE_CONTENT_MAX_CHARS = 256 * 1024;
export const PROJECT_CONTEXT_RUN_MAX_FILES = 256;
export const PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES = 4_096;
export const PROJECT_CONTEXT_RUN_MAX_GIT_AUDIT_OUTPUT_BYTES = 256 * 1024;

export const ProjectContextRunMode = Schema.Literals(["populate", "review"]);
export type ProjectContextRunMode = typeof ProjectContextRunMode.Type;

export const ProjectContextRunStatus = Schema.Literals([
  "pending",
  "running",
  "pending-review",
  "completed",
  "discarded",
  "failed",
  "interrupted",
]);
export type ProjectContextRunStatus = typeof ProjectContextRunStatus.Type;

export const ProjectContextRunPmStartState = Schema.Literals([
  "ready",
  "awaiting-user",
  "waiting-for-idle",
  "interrupting",
]);
export type ProjectContextRunPmStartState = typeof ProjectContextRunPmStartState.Type;

export const ProjectContextRunPmStartAction = Schema.Literals(["wait", "interrupt"]);
export type ProjectContextRunPmStartAction = typeof ProjectContextRunPmStartAction.Type;

export const ProjectContextRunResolution = Schema.Literals(["applied", "committed", "discarded"]);
export type ProjectContextRunResolution = typeof ProjectContextRunResolution.Type;

export const ProjectContextRunPath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(1_024),
  Schema.isPattern(
    /^(?:AGENTS\.md|CONTEXT\.md|\.ged\/(?:PROJECT|ARCHITECTURE)\.md|\.ged\/MANIFEST\.json|docs\/adr\/[^/]+\.md)$/,
  ),
);
export type ProjectContextRunPath = typeof ProjectContextRunPath.Type;

const ProjectContextRunRawContent = Schema.String.check(
  Schema.isMaxLength(PROJECT_CONTEXT_RUN_FILE_CONTENT_MAX_CHARS),
);

export const ProjectContextRunBaselineEntry = Schema.Struct({
  path: ProjectContextRunPath,
  rawContent: Schema.NullOr(ProjectContextRunRawContent),
});
export type ProjectContextRunBaselineEntry = typeof ProjectContextRunBaselineEntry.Type;

export const ProjectContextRunBaselineManifest = Schema.Array(ProjectContextRunBaselineEntry).check(
  Schema.isMaxLength(PROJECT_CONTEXT_RUN_MAX_FILES),
);
export type ProjectContextRunBaselineManifest = typeof ProjectContextRunBaselineManifest.Type;

export const ProjectContextRunChange = Schema.Struct({
  path: ProjectContextRunPath,
  beforeRawContent: Schema.NullOr(ProjectContextRunRawContent),
  afterRawContent: Schema.NullOr(ProjectContextRunRawContent),
});
export type ProjectContextRunChange = typeof ProjectContextRunChange.Type;

export const ProjectContextRunChanges = Schema.Array(ProjectContextRunChange).check(
  Schema.isMaxLength(PROJECT_CONTEXT_RUN_MAX_FILES),
);
export type ProjectContextRunChanges = typeof ProjectContextRunChanges.Type;

export const ProjectContextRunScopeViolationPaths = Schema.Array(
  TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
).check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES));
export type ProjectContextRunScopeViolationPaths = typeof ProjectContextRunScopeViolationPaths.Type;

export const ProjectContextRunContentDigest = TrimmedNonEmptyString.check(
  Schema.isPattern(/^sha256:[a-f0-9]{64}$/),
).pipe(Schema.brand("ProjectContextRunContentDigest"));
export type ProjectContextRunContentDigest = typeof ProjectContextRunContentDigest.Type;

export const ProjectContextRunWorkspaceStatusEntry = Schema.Struct({
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(4_096)),
  porcelainStatus: Schema.String.check(Schema.isPattern(/^[ MADRCUT?!]{2}$/)),
  contentDigest: Schema.NullOr(ProjectContextRunContentDigest),
});
export type ProjectContextRunWorkspaceStatusEntry =
  typeof ProjectContextRunWorkspaceStatusEntry.Type;

export const ProjectContextRunWorkspaceStatusManifest = Schema.Array(
  ProjectContextRunWorkspaceStatusEntry,
).check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_MAX_WORKSPACE_STATUS_ENTRIES));
export type ProjectContextRunWorkspaceStatusManifest =
  typeof ProjectContextRunWorkspaceStatusManifest.Type;

export const ProjectContextRunGitObjectId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
).pipe(Schema.brand("ProjectContextRunGitObjectId"));
export type ProjectContextRunGitObjectId = typeof ProjectContextRunGitObjectId.Type;

const ProjectContextRunGitHeadIdentity = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("branch"),
    ref: TrimmedNonEmptyString.check(
      Schema.isMaxLength(4_096),
      Schema.isPattern(/^refs\/heads\/[^\s~^:?*\\[\\]+$/),
      Schema.makeFilter(
        (value) =>
          !value.includes("\u0000") ||
          new SchemaIssue.InvalidValue(Option.some(value), {
            message: "Git branch references cannot contain NUL bytes",
          }),
        { identifier: "ProjectContextRunGitBranchRef" },
      ),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal("detached") }),
]);
export type ProjectContextRunGitHeadIdentity = typeof ProjectContextRunGitHeadIdentity.Type;

/**
 * Git state whose semantic mutation is forbidden while a project-context
 * provider runs. Every field is server-captured and bounded before it reaches
 * the append-only run record.
 */
export const ProjectContextRunGitState = Schema.Struct({
  /** Null only when the symbolic branch is unborn. */
  head: Schema.NullOr(ProjectContextRunGitObjectId),
  headIdentity: ProjectContextRunGitHeadIdentity,
  stagedIndexDigest: ProjectContextRunContentDigest,
  refsDigest: ProjectContextRunContentDigest,
  configDigest: ProjectContextRunContentDigest,
  hooksDigest: ProjectContextRunContentDigest,
  infoExcludeDigest: ProjectContextRunContentDigest,
  infoAttributesDigest: ProjectContextRunContentDigest,
  infoGraftsDigest: ProjectContextRunContentDigest,
});
export type ProjectContextRunGitState = typeof ProjectContextRunGitState.Type;

export const OrchestrationProjectContextRun = Schema.Struct({
  id: ProjectContextRunId,
  projectId: ProjectId,
  mode: ProjectContextRunMode,
  tier: OrchestrationCapabilityTier,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  primaryCheckoutPath: TrimmedNonEmptyString,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS)),
  baselineManifest: ProjectContextRunBaselineManifest,
  workspaceStatusManifest: ProjectContextRunWorkspaceStatusManifest,
  gitState: ProjectContextRunGitState,
  status: ProjectContextRunStatus,
  pmStartState: ProjectContextRunPmStartState.pipe(
    Schema.withDecodingDefault(Effect.succeed("ready" as const)),
  ),
  providerThreadId: Schema.NullOr(ThreadId),
  result: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS)),
  ),
  failureMessage: Schema.NullOr(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS)),
  ),
  changes: ProjectContextRunChanges,
  scopeViolationPaths: ProjectContextRunScopeViolationPaths,
  resolution: Schema.NullOr(ProjectContextRunResolution),
  commitHash: Schema.NullOr(ProjectContextRunGitObjectId),
  resultSchemaVersion: Schema.NullOr(ProjectContextSchemaVersion),
  resultFingerprint: Schema.NullOr(ProjectContextFingerprint),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  pendingReviewAt: Schema.NullOr(IsoDateTime),
  failedAt: Schema.NullOr(IsoDateTime),
  interruptedAt: Schema.NullOr(IsoDateTime),
  resolvedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type OrchestrationProjectContextRun = typeof OrchestrationProjectContextRun.Type;

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
  helperRuns: Schema.optionalKey(Schema.Array(OrchestrationHelperRun)),
  projectContextRuns: Schema.Array(OrchestrationProjectContextRun),
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
  projectContextResolution: Schema.optionalKey(
    Schema.NullOr(ProjectContextResolution).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  ),
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
  lastClearedSequence: Schema.optional(NonNegativeInt),
  pendingPmHandoff: Schema.NullOr(PendingPmHandoff).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
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

const ProjectContextResolveCommand = Schema.Struct({
  type: Schema.Literal("project.context.resolve"),
  commandId: CommandId,
  projectId: ProjectId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  outcome: ProjectContextResolutionOutcome,
  resolvedAt: IsoDateTime,
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
  parentTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  childOrder: Schema.optionalKey(Schema.NullOr(NonNegativeInt)),
  dependsOnTaskIds: Schema.optionalKey(Schema.Array(TaskId)),
  supersedesTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  createdAt: IsoDateTime,
});

const HelperRunRequestCommand = Schema.Struct({
  type: Schema.Literal("helper.run.request"),
  commandId: CommandId,
  helperRunId: HelperRunId,
  projectId: ProjectId,
  attachment: OrchestrationHelperRunAttachment,
  tier: OrchestrationCapabilityTier,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(HELPER_RUN_PROMPT_MAX_CHARS)),
  createdAt: IsoDateTime,
});

export const ProjectContextRunRequestCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.request"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  projectId: ProjectId,
  /**
   * Server-captured primary checkout identity. This is intentionally absent
   * from the public request RPC: it binds the captured baseline to the exact
   * project root the decider must still observe when it serializes the event.
   */
  expectedPrimaryCheckoutPath: TrimmedNonEmptyString,
  mode: ProjectContextRunMode,
  tier: Schema.optionalKey(OrchestrationCapabilityTier),
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  baselineManifest: ProjectContextRunBaselineManifest,
  workspaceStatusManifest: ProjectContextRunWorkspaceStatusManifest,
  gitState: ProjectContextRunGitState,
  createdAt: IsoDateTime,
});

export const ProjectContextRunPrepareStartCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.prepare-start"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  action: ProjectContextRunPmStartAction,
  createdAt: IsoDateTime,
});

export const ProjectContextRunRefreshBaselineCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.refresh-baseline"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  baselineManifest: ProjectContextRunBaselineManifest,
  workspaceStatusManifest: ProjectContextRunWorkspaceStatusManifest,
  gitState: ProjectContextRunGitState,
  createdAt: IsoDateTime,
});

export const ProjectContextRunStartCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.start"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  providerThreadId: ThreadId,
  createdAt: IsoDateTime,
});

export const ProjectContextRunPendingReviewCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.pending-review"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  result: Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS)),
  changes: ProjectContextRunChanges,
  scopeViolationPaths: ProjectContextRunScopeViolationPaths,
  createdAt: IsoDateTime,
});

export const ProjectContextRunApplyCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.apply"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  result: Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS)),
  changes: ProjectContextRunChanges,
  resultSchemaVersion: ProjectContextSchemaVersion,
  resultFingerprint: ProjectContextFingerprint,
  createdAt: IsoDateTime,
});

/**
 * Reopens a reviewed context run with a server-authored, durable revision
 * prompt. The immutable baseline remains unchanged so a later review covers
 * the whole context-run delta rather than just its final turn.
 */
export const ProjectContextRunReviseCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.revise"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS)),
  createdAt: IsoDateTime,
});

export const ProjectContextRunCommitCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.commit"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  commitHash: ProjectContextRunGitObjectId,
  resultSchemaVersion: ProjectContextSchemaVersion,
  resultFingerprint: ProjectContextFingerprint,
  createdAt: IsoDateTime,
});

export const ProjectContextRunDiscardCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.discard"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  resultSchemaVersion: ProjectContextSchemaVersion,
  resultFingerprint: ProjectContextFingerprint,
  createdAt: IsoDateTime,
});

export const ProjectContextRunFailCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.fail"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS)),
  createdAt: IsoDateTime,
});

export const ProjectContextRunInterruptCommand = Schema.Struct({
  type: Schema.Literal("project.context.run.interrupt"),
  commandId: CommandId,
  projectContextRunId: ProjectContextRunId,
  createdAt: IsoDateTime,
});

export const OrchestrationTaskSplitChild = Schema.Struct({
  taskId: TaskId,
  taskType: TaskTypeId,
  title: TrimmedNonEmptyString,
  branch: Schema.optionalKey(TrimmedNonEmptyString),
  acceptanceCriteria: Schema.Array(TrimmedNonEmptyString),
  dependsOnTaskIds: Schema.Array(TaskId),
});
export type OrchestrationTaskSplitChild = typeof OrchestrationTaskSplitChild.Type;

const TaskSplitCommand = Schema.Struct({
  type: Schema.Literal("task.split"),
  commandId: CommandId,
  taskId: TaskId,
  children: Schema.Array(OrchestrationTaskSplitChild),
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

const TaskCapabilityTiersSetCommand = Schema.Struct({
  type: Schema.Literal("task.capability-tiers.set"),
  commandId: CommandId,
  taskId: TaskId,
  roleCapabilityTiers: GedRoleCapabilityTiers,
  origin: OrchestrationTaskTierSelectionOrigin,
  createdAt: IsoDateTime,
});

const TaskArchiveCommand = Schema.Struct({
  type: Schema.Literal("task.archive"),
  commandId: CommandId,
  taskId: TaskId,
});

const TaskRestoreCommand = Schema.Struct({
  type: Schema.Literal("task.restore"),
  commandId: CommandId,
  taskId: TaskId,
});

const TaskDeleteCommand = Schema.Struct({
  type: Schema.Literal("task.delete"),
  commandId: CommandId,
  taskId: TaskId,
});

/**
 * The handoff command. Internal/PM-dispatchable. The decider (WP-E) pins
 * `runtimeMode` and resolves the requested semantic tier through trusted config. Raw provider/model
 * selections are intentionally not accepted, so the PM cannot bypass configured presets.
 */
const TaskStageStartCommand = Schema.Struct({
  type: Schema.Literal("task.stage.start"),
  commandId: CommandId,
  taskId: TaskId,
  role: OrchestrationStageRole,
  capabilityTier: Schema.optionalKey(OrchestrationCapabilityTier),
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
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
  createdAt: IsoDateTime,
});

const TaskChangeReviewRequestCommand = Schema.Struct({
  type: Schema.Literal("task.change-review.request"),
  commandId: CommandId,
  taskId: TaskId,
  workStageThreadId: ThreadId,
  detectedHead: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const TaskChangeReviewResolveCommand = Schema.Struct({
  type: Schema.Literal("task.change-review.resolve"),
  commandId: CommandId,
  taskId: TaskId,
  resolution: OrchestrationTaskChangeReviewResolution,
  createdAt: IsoDateTime,
});

const TaskVerificationRecordCommand = Schema.Struct({
  type: Schema.Literal("task.verification.record"),
  commandId: CommandId,
  taskId: TaskId,
  stageThreadId: ThreadId,
  head: TrimmedNonEmptyString,
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
  createdAt: IsoDateTime,
});

const TaskNoChangesNeededCommand = Schema.Struct({
  type: Schema.Literal("task.no-changes-needed"),
  commandId: CommandId,
  taskId: TaskId,
  baseHead: TrimmedNonEmptyString,
  head: TrimmedNonEmptyString,
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
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

const TaskStageInterruptCommand = Schema.Struct({
  type: Schema.Literal("task.stage.interrupt"),
  commandId: CommandId,
  taskId: TaskId,
  stageThreadId: ThreadId,
  role: OrchestrationStageRole,
  reason: Schema.Literals(["orphaned", "operator"]),
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
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
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
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
  createdAt: IsoDateTime,
});

const TaskLandCommand = Schema.Struct({
  type: Schema.Literal("task.land"),
  commandId: CommandId,
  taskId: TaskId,
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
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

const TaskLandingRetryCommand = Schema.Struct({
  type: Schema.Literal("task.landing.retry"),
  commandId: CommandId,
  taskId: TaskId,
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
  createdAt: IsoDateTime,
});

const TaskReleaseDispatchRequestCommand = Schema.Struct({
  type: Schema.Literal("task.release.dispatch.request"),
  commandId: CommandId,
  taskId: TaskId,
  workflow: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  inputs: Schema.Record(TrimmedNonEmptyString, Schema.String),
  contentHash: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const TaskReleaseDispatchCompleteCommand = Schema.Struct({
  type: Schema.Literal("task.release.dispatch.complete"),
  commandId: CommandId,
  taskId: TaskId,
  workflowUrl: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const TaskReleaseDispatchFailCommand = Schema.Struct({
  type: Schema.Literal("task.release.dispatch.fail"),
  commandId: CommandId,
  taskId: TaskId,
  message: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const TaskPrOpenFailedCommand = Schema.Struct({
  type: Schema.Literal("task.pr.open.failed"),
  commandId: CommandId,
  taskId: TaskId,
  message: TrimmedNonEmptyString,
  branchPushed: Schema.Boolean,
  createdAt: IsoDateTime,
});

const TaskAbandonCommand = Schema.Struct({
  type: Schema.Literal("task.abandon"),
  commandId: CommandId,
  taskId: TaskId,
  createdAt: IsoDateTime,
});

const TaskCancellationRequestCommand = Schema.Struct({
  type: Schema.Literal("task.cancellation.request"),
  commandId: CommandId,
  taskId: TaskId,
  createdAt: IsoDateTime,
});

const TaskCancellationFailCommand = Schema.Struct({
  type: Schema.Literal("task.cancellation.fail"),
  commandId: CommandId,
  taskId: TaskId,
  phase: OrchestrationTaskCancellationPhase,
  message: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});

const TaskCancellationPhaseCompleteCommand = Schema.Struct({
  type: Schema.Literal("task.cancellation.phase.complete"),
  commandId: CommandId,
  taskId: TaskId,
  phase: OrchestrationTaskCancellationShutdownPhase,
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
  TaskCapabilityTiersSetCommand,
  TaskArchiveCommand,
  TaskRestoreCommand,
  TaskDeleteCommand,
  TaskStageStartCommand,
  TaskGateRequestCommand,
  TaskGateResolveCommand,
  TaskLandCommand,
  HelperRunRequestCommand,
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

const ThreadForkCommand = Schema.Struct({
  type: Schema.Literal("thread.fork"),
  commandId: CommandId,
  sourceThreadId: ThreadId,
  sourceMessageId: MessageId,
  targetThreadId: ThreadId,
  targetMessageIds: Schema.Array(MessageId),
  session: Schema.optionalKey(OrchestrationSession),
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

const ThreadClearCommand = Schema.Struct({
  type: Schema.Literal("thread.clear"),
  commandId: CommandId,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});

const ThreadPmHandoffRequestCommand = Schema.Struct({
  type: Schema.Literal("thread.pm-handoff.request"),
  commandId: CommandId,
  threadId: ThreadId,
  mode: PmHandoffMode,
  brief: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});

const ThreadPmHandoffCompleteCommand = Schema.Struct({
  type: Schema.Literal("thread.pm-handoff.complete"),
  commandId: CommandId,
  threadId: ThreadId,
  mode: PmHandoffMode,
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
  ProjectContextResolveCommand,
  ProjectContextRunRequestCommand,
  ProjectContextRunPrepareStartCommand,
  ProjectContextRunRefreshBaselineCommand,
  ProjectContextRunStartCommand,
  ProjectContextRunPendingReviewCommand,
  ProjectContextRunApplyCommand,
  ProjectContextRunReviseCommand,
  ProjectContextRunCommitCommand,
  ProjectContextRunDiscardCommand,
  ProjectContextRunFailCommand,
  ProjectContextRunInterruptCommand,
  ThreadForkCommand,
  ThreadSessionSetCommand,
  ThreadMessageUserAppendCommand,
  ThreadMessageAssistantDeltaCommand,
  ThreadMessageAssistantCompleteCommand,
  ThreadClearCommand,
  ThreadPmHandoffRequestCommand,
  ThreadPmHandoffCompleteCommand,
  ThreadProposedPlanUpsertCommand,
  ThreadTurnDiffCompleteCommand,
  ThreadActivityAppendCommand,
  ThreadRevertCompleteCommand,
  TaskStageCompleteCommand,
  TaskChangeReviewRequestCommand,
  TaskChangeReviewResolveCommand,
  TaskVerificationRecordCommand,
  TaskNoChangesNeededCommand,
  TaskStageBlockCommand,
  TaskStageInterruptCommand,
  TaskLandingRetryCommand,
  TaskReleaseDispatchRequestCommand,
  TaskReleaseDispatchCompleteCommand,
  TaskReleaseDispatchFailCommand,
  TaskPrOpenedCommand,
  TaskPrOpenFailedCommand,
  TaskAbandonCommand,
  TaskCancellationRequestCommand,
  TaskCancellationFailCommand,
  TaskCancellationPhaseCompleteCommand,
  TaskSplitCommand,
  Schema.Struct({
    type: Schema.Literal("helper.run.start"),
    commandId: CommandId,
    helperRunId: HelperRunId,
    providerThreadId: ThreadId,
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("helper.run.complete"),
    commandId: CommandId,
    helperRunId: HelperRunId,
    result: Schema.String.check(Schema.isMaxLength(HELPER_RUN_RESULT_MAX_CHARS)),
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("helper.run.fail"),
    commandId: CommandId,
    helperRunId: HelperRunId,
    message: TrimmedNonEmptyString.check(Schema.isMaxLength(HELPER_RUN_FAILURE_MAX_CHARS)),
    createdAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("helper.run.interrupt"),
    commandId: CommandId,
    helperRunId: HelperRunId,
    createdAt: IsoDateTime,
  }),
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
  "project.context-dismissed",
  "project.context-completed",
  "project.deleted",
  "thread.created",
  "thread.deleted",
  "thread.archived",
  "thread.unarchived",
  "thread.meta-updated",
  "thread.runtime-mode-set",
  "thread.interaction-mode-set",
  "thread.message-sent",
  "thread.cleared",
  "thread.pm-handoff-requested",
  "thread.pm-handoff-completed",
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
  "task.split",
  "task.classified",
  "task.capability-tiers-updated",
  "task.archived",
  "task.restored",
  "task.deleted",
  "task.stage-started",
  "task.stage-completed",
  "task.change-review-requested",
  "task.change-review-resolved",
  "task.verification-recorded",
  "task.no-changes-needed",
  "task.stage-blocked",
  "task.stage-interrupted",
  "task.gate-requested",
  "task.gate-resolved",
  "task.cancellation-requested",
  "task.cancellation-failed",
  "task.cancellation-phase-completed",
  "task.landed",
  "task.landing-retry-requested",
  "task.release-dispatch-requested",
  "task.release-dispatched",
  "task.release-dispatch-failed",
  "task.pr-opened",
  "task.pr-open-failed",
  "task.abandoned",
  "helper.run-requested",
  "helper.run-started",
  "helper.run-completed",
  "helper.run-failed",
  "helper.run-interrupted",
  "project.context-run-requested",
  "project.context-run-start-prepared",
  "project.context-run-baseline-refreshed",
  "project.context-run-started",
  "project.context-run-pending-review",
  "project.context-run-applied",
  "project.context-run-revised",
  "project.context-run-committed",
  "project.context-run-discarded",
  "project.context-run-failed",
  "project.context-run-interrupted",
]);
export type OrchestrationEventType = typeof OrchestrationEventType.Type;

export const OrchestrationAggregateKind = Schema.Literals([
  "project",
  "thread",
  "task",
  "helper-run",
  "project-context-run",
]);
export type OrchestrationAggregateKind = typeof OrchestrationAggregateKind.Type;
export const OrchestrationActorKind = Schema.Literals(["client", "server", "provider"]);

export const ProjectCreatedPayload = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  workspaceRoot: TrimmedNonEmptyString,
  repositoryIdentity: Schema.optional(Schema.NullOr(RepositoryIdentity)),
  defaultModelSelection: Schema.NullOr(ModelSelection),
  roleModelSelections: Schema.optionalKey(PersistedGedRoleModelSelections),
  rolePromptPrefixes: Schema.optionalKey(PersistedGedRolePromptPrefixes),
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
  roleModelSelections: Schema.optional(PersistedGedRoleModelSelections),
  rolePromptPrefixes: Schema.optional(PersistedGedRolePromptPrefixes),
  orchestratorConfig: Schema.optional(OrchestratorConfigJson),
  scripts: Schema.optional(Schema.Array(ProjectScript)),
  updatedAt: IsoDateTime,
});

export const ProjectDeletedPayload = Schema.Struct({
  projectId: ProjectId,
  deletedAt: IsoDateTime,
});

export const ProjectContextDismissedPayload = Schema.Struct({
  projectId: ProjectId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  dismissedAt: IsoDateTime,
});

export const ProjectContextCompletedPayload = Schema.Struct({
  projectId: ProjectId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  completedAt: IsoDateTime,
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

export const ThreadClearedPayload = Schema.Struct({
  threadId: ThreadId,
  clearedAt: IsoDateTime,
});

export const ThreadPmHandoffRequestedPayload = Schema.Struct({
  threadId: ThreadId,
  mode: PmHandoffMode,
  brief: Schema.optional(Schema.String),
  createdAt: IsoDateTime,
});

export const ThreadPmHandoffCompletedPayload = Schema.Struct({
  threadId: ThreadId,
  mode: PmHandoffMode,
  createdAt: IsoDateTime,
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
  parentTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  childOrder: Schema.optionalKey(Schema.NullOr(NonNegativeInt)),
  acceptanceCriteria: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  dependsOnTaskIds: Schema.optionalKey(Schema.Array(TaskId)),
  supersedesTaskId: Schema.optionalKey(Schema.NullOr(TaskId)),
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskSplitPayload = Schema.Struct({
  taskId: TaskId,
  updatedAt: IsoDateTime,
});

export const TaskArchivedPayload = Schema.Struct({
  taskId: TaskId,
  archivedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskRestoredPayload = Schema.Struct({
  taskId: TaskId,
  task: OrchestrationTask,
  updatedAt: IsoDateTime,
});

export const TaskDeletedPayload = Schema.Struct({
  taskId: TaskId,
  deletedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskClassifiedPayload = Schema.Struct({
  taskId: TaskId,
  taskType: TaskTypeId,
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export const TaskCapabilityTiersUpdatedPayload = Schema.Struct({
  taskId: TaskId,
  roleCapabilityTiers: GedRoleCapabilityTiers,
  origin: OrchestrationTaskTierSelectionOrigin,
  updatedAt: IsoDateTime,
});

export const HelperRunRequestedPayload = Schema.Struct({
  helperRunId: HelperRunId,
  projectId: ProjectId,
  attachment: OrchestrationHelperRunAttachment,
  accessMode: Schema.Literal("read-only"),
  tier: OrchestrationCapabilityTier,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(HELPER_RUN_PROMPT_MAX_CHARS)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const HelperRunStartedPayload = Schema.Struct({
  helperRunId: HelperRunId,
  providerThreadId: ThreadId,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const HelperRunCompletedPayload = Schema.Struct({
  helperRunId: HelperRunId,
  result: Schema.String.check(Schema.isMaxLength(HELPER_RUN_RESULT_MAX_CHARS)),
  completedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const HelperRunFailedPayload = Schema.Struct({
  helperRunId: HelperRunId,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(HELPER_RUN_FAILURE_MAX_CHARS)),
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const HelperRunInterruptedPayload = Schema.Struct({
  helperRunId: HelperRunId,
  interruptedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunRequestedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  projectId: ProjectId,
  mode: ProjectContextRunMode,
  tier: OrchestrationCapabilityTier,
  providerInstanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  modelOptions: Schema.NullOr(ProviderOptionSelections),
  primaryCheckoutPath: TrimmedNonEmptyString,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS)),
  baselineManifest: ProjectContextRunBaselineManifest,
  workspaceStatusManifest: ProjectContextRunWorkspaceStatusManifest,
  gitState: ProjectContextRunGitState,
  pmStartState: ProjectContextRunPmStartState.pipe(
    Schema.withDecodingDefault(Effect.succeed("ready" as const)),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunStartPreparedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  pmStartState: Schema.Literals(["waiting-for-idle", "interrupting"]),
  updatedAt: IsoDateTime,
});

export const ProjectContextRunBaselineRefreshedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  baselineManifest: ProjectContextRunBaselineManifest,
  workspaceStatusManifest: ProjectContextRunWorkspaceStatusManifest,
  gitState: ProjectContextRunGitState,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunStartedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  providerThreadId: ThreadId,
  startedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunPendingReviewPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  result: Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS)),
  changes: ProjectContextRunChanges,
  scopeViolationPaths: ProjectContextRunScopeViolationPaths,
  pendingReviewAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunAppliedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  result: Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS)),
  changes: ProjectContextRunChanges,
  resultSchemaVersion: ProjectContextSchemaVersion,
  resultFingerprint: ProjectContextFingerprint,
  resolvedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunRevisedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS)),
  updatedAt: IsoDateTime,
});

export const ProjectContextRunCommittedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  commitHash: ProjectContextRunGitObjectId,
  resultSchemaVersion: ProjectContextSchemaVersion,
  resultFingerprint: ProjectContextFingerprint,
  resolvedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunDiscardedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  resultSchemaVersion: ProjectContextSchemaVersion,
  resultFingerprint: ProjectContextFingerprint,
  resolvedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunFailedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_FAILURE_MAX_CHARS)),
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const ProjectContextRunInterruptedPayload = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
  interruptedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskStageStartedPayload = Schema.Struct({
  taskId: TaskId,
  role: OrchestrationStageRole,
  capabilityTier: Schema.optionalKey(OrchestrationCapabilityTier),
  stageThreadId: ThreadId,
  awaitedTurnId: Schema.NullOr(TurnId),
  // Resolved backend/model for this stage, stamped by the decider at start so the
  // stage-history projection and the web timeline record what actually ran rather
  // than re-resolving config. Optional for append-only compatibility: events
  // appended before these fields existed still decode, and projections fall back
  // to re-deriving the selection from config when they are absent.
  providerInstanceId: Schema.optional(ProviderInstanceId),
  model: Schema.optional(TrimmedNonEmptyString),
  modelOptions: Schema.optionalKey(ProviderOptionSelections),
  runtimeMode: Schema.optional(RuntimeMode),
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
  worktreeCompletion: Schema.optional(OrchestrationTaskWorktreeCompletion),
  updatedAt: IsoDateTime,
});

export const TaskChangeReviewRequestedPayload = Schema.Struct({
  taskId: TaskId,
  workStageThreadId: ThreadId,
  detectedHead: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskChangeReviewResolvedPayload = Schema.Struct({
  taskId: TaskId,
  resolution: OrchestrationTaskChangeReviewResolution,
  resolvedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskVerificationRecordedPayload = Schema.Struct({
  taskId: TaskId,
  stageThreadId: ThreadId,
  head: TrimmedNonEmptyString,
  verifiedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskNoChangesNeededPayload = Schema.Struct({
  taskId: TaskId,
  baseHead: TrimmedNonEmptyString,
  head: TrimmedNonEmptyString,
  completedAt: IsoDateTime,
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

export const TaskStageInterruptedPayload = Schema.Struct({
  taskId: TaskId,
  role: OrchestrationStageRole,
  stageThreadId: ThreadId,
  reason: Schema.Literals(["orphaned", "operator"]),
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

export const TaskCancellationRequestedPayload = Schema.Struct({
  taskId: TaskId,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskCancellationFailedPayload = Schema.Struct({
  taskId: TaskId,
  phase: OrchestrationTaskCancellationPhase,
  message: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskCancellationPhaseCompletedPayload = Schema.Struct({
  taskId: TaskId,
  phase: OrchestrationTaskCancellationShutdownPhase,
  updatedAt: IsoDateTime,
});

export const TaskPrOpenedPayload = Schema.Struct({
  taskId: TaskId,
  prUrl: TrimmedNonEmptyString,
  prNumber: Schema.optional(PositiveInt),
  updatedAt: IsoDateTime,
});

export const TaskLandingRetryRequestedPayload = Schema.Struct({
  taskId: TaskId,
  updatedAt: IsoDateTime,
});

export const TaskReleaseDispatchRequestedPayload = Schema.Struct({
  taskId: TaskId,
  workflow: TrimmedNonEmptyString,
  ref: TrimmedNonEmptyString,
  inputs: Schema.Record(TrimmedNonEmptyString, Schema.String),
  contentHash: TrimmedNonEmptyString,
  requestedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const TaskReleaseDispatchedPayload = Schema.Struct({
  taskId: TaskId,
  workflowUrl: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});

export const TaskReleaseDispatchFailedPayload = Schema.Struct({
  taskId: TaskId,
  message: TrimmedNonEmptyString,
  updatedAt: IsoDateTime,
});

export const TaskPrOpenFailedPayload = Schema.Struct({
  taskId: TaskId,
  message: TrimmedNonEmptyString,
  branchPushed: Schema.Boolean,
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
  aggregateId: Schema.Union([ProjectId, ThreadId, TaskId, HelperRunId, ProjectContextRunId]),
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
    type: Schema.Literal("project.context-dismissed"),
    payload: ProjectContextDismissedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-completed"),
    payload: ProjectContextCompletedPayload,
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
    type: Schema.Literal("thread.cleared"),
    payload: ThreadClearedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pm-handoff-requested"),
    payload: ThreadPmHandoffRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("thread.pm-handoff-completed"),
    payload: ThreadPmHandoffCompletedPayload,
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
    type: Schema.Literal("task.split"),
    payload: TaskSplitPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.classified"),
    payload: TaskClassifiedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.capability-tiers-updated"),
    payload: TaskCapabilityTiersUpdatedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.archived"),
    payload: TaskArchivedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.restored"),
    payload: TaskRestoredPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.deleted"),
    payload: TaskDeletedPayload,
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
    type: Schema.Literal("task.change-review-requested"),
    payload: TaskChangeReviewRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.change-review-resolved"),
    payload: TaskChangeReviewResolvedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.verification-recorded"),
    payload: TaskVerificationRecordedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.no-changes-needed"),
    payload: TaskNoChangesNeededPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.stage-blocked"),
    payload: TaskStageBlockedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.stage-interrupted"),
    payload: TaskStageInterruptedPayload,
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
    type: Schema.Literal("task.cancellation-requested"),
    payload: TaskCancellationRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.cancellation-failed"),
    payload: TaskCancellationFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.cancellation-phase-completed"),
    payload: TaskCancellationPhaseCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.landed"),
    payload: TaskLandedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.landing-retry-requested"),
    payload: TaskLandingRetryRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.release-dispatch-requested"),
    payload: TaskReleaseDispatchRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.release-dispatched"),
    payload: TaskReleaseDispatchedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.release-dispatch-failed"),
    payload: TaskReleaseDispatchFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.pr-opened"),
    payload: TaskPrOpenedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.pr-open-failed"),
    payload: TaskPrOpenFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("task.abandoned"),
    payload: TaskAbandonedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("helper.run-requested"),
    payload: HelperRunRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("helper.run-started"),
    payload: HelperRunStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("helper.run-completed"),
    payload: HelperRunCompletedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("helper.run-failed"),
    payload: HelperRunFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("helper.run-interrupted"),
    payload: HelperRunInterruptedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-requested"),
    payload: ProjectContextRunRequestedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-start-prepared"),
    payload: ProjectContextRunStartPreparedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-baseline-refreshed"),
    payload: ProjectContextRunBaselineRefreshedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-started"),
    payload: ProjectContextRunStartedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-pending-review"),
    payload: ProjectContextRunPendingReviewPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-applied"),
    payload: ProjectContextRunAppliedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-revised"),
    payload: ProjectContextRunRevisedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-committed"),
    payload: ProjectContextRunCommittedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-discarded"),
    payload: ProjectContextRunDiscardedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-failed"),
    payload: ProjectContextRunFailedPayload,
  }),
  Schema.Struct({
    ...EventBaseFields,
    type: Schema.Literal("project.context-run-interrupted"),
    payload: ProjectContextRunInterruptedPayload,
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

export const OrchestratorPresetMigrationProject = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  roleModelSelections: GedRoleModelSelections,
});
export type OrchestratorPresetMigrationProject = typeof OrchestratorPresetMigrationProject.Type;

export const OrchestratorPresetMigrationState = Schema.Struct({
  status: Schema.Literals(["required", "completed"]),
  legacyGlobalSelection: Schema.NullOr(ModelSelection),
  projects: Schema.Array(OrchestratorPresetMigrationProject),
});
export type OrchestratorPresetMigrationState = typeof OrchestratorPresetMigrationState.Type;

export const OrchestratorCompletePresetMigrationInput = Schema.Struct({
  globalPresets: OrchestrationCapabilityPresets,
  projects: Schema.Array(
    Schema.Struct({
      projectId: ProjectId,
      capabilityPresets: OrchestrationCapabilityPresetOverrides,
    }),
  ),
});
export type OrchestratorCompletePresetMigrationInput =
  typeof OrchestratorCompletePresetMigrationInput.Type;

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
  helperRuns: Schema.optionalKey(Schema.Array(OrchestrationHelperRun)),
  projectContextRuns: Schema.Array(OrchestrationProjectContextRun),
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
  helperRuns: Schema.optionalKey(Schema.Array(OrchestrationHelperRun)),
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

export const OrchestratorSetTaskCapabilityTiersInput = Schema.Struct({
  taskId: TaskId,
  roleCapabilityTiers: GedRoleCapabilityTiers,
});
export type OrchestratorSetTaskCapabilityTiersInput =
  typeof OrchestratorSetTaskCapabilityTiersInput.Type;

export const OrchestratorCancelTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorCancelTaskInput = typeof OrchestratorCancelTaskInput.Type;

export const OrchestratorInterruptStageInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorInterruptStageInput = typeof OrchestratorInterruptStageInput.Type;

export const OrchestratorInterruptStageResult = Schema.Struct({
  taskId: TaskId,
  stageThreadId: ThreadId,
  sequence: NonNegativeInt,
  status: Schema.Literal("requested"),
});
export type OrchestratorInterruptStageResult = typeof OrchestratorInterruptStageResult.Type;

export const OrchestratorTaskChanges = Schema.Struct({
  head: TrimmedNonEmptyString,
  dirty: Schema.Boolean,
  paths: Schema.Array(Schema.String),
  staged: Schema.Boolean,
  diff: Schema.String,
  diffTruncated: Schema.Boolean,
});
export type OrchestratorTaskChanges = typeof OrchestratorTaskChanges.Type;

export const OrchestratorInspectTaskChangesInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorInspectTaskChangesInput = typeof OrchestratorInspectTaskChangesInput.Type;

export const OrchestratorInspectTaskChangesResult = Schema.Struct({
  taskId: TaskId,
  changes: OrchestratorTaskChanges,
});
export type OrchestratorInspectTaskChangesResult = typeof OrchestratorInspectTaskChangesResult.Type;

export const OrchestratorCommitTaskChangesInput = Schema.Struct({
  taskId: TaskId,
  paths: Schema.Array(Schema.String),
  message: TrimmedNonEmptyString,
});
export type OrchestratorCommitTaskChangesInput = typeof OrchestratorCommitTaskChangesInput.Type;

export const OrchestratorCommitTaskChangesResult = Schema.Struct({
  taskId: TaskId,
  commit: Schema.String,
  changes: OrchestratorTaskChanges,
  sequence: NonNegativeInt,
});
export type OrchestratorCommitTaskChangesResult = typeof OrchestratorCommitTaskChangesResult.Type;

export const OrchestratorDiscardTaskChangesInput = Schema.Struct({
  taskId: TaskId,
  paths: Schema.Array(Schema.String),
});
export type OrchestratorDiscardTaskChangesInput = typeof OrchestratorDiscardTaskChangesInput.Type;

export const OrchestratorDiscardTaskChangesResult = Schema.Struct({
  taskId: TaskId,
  changes: OrchestratorTaskChanges,
  sequence: NonNegativeInt,
});
export type OrchestratorDiscardTaskChangesResult = typeof OrchestratorDiscardTaskChangesResult.Type;

export const OrchestratorReturnTaskChangesInput = Schema.Struct({
  taskId: TaskId,
  instructions: TrimmedNonEmptyString,
});
export type OrchestratorReturnTaskChangesInput = typeof OrchestratorReturnTaskChangesInput.Type;

export const OrchestratorReturnTaskChangesResult = Schema.Struct({
  taskId: TaskId,
  stageThreadId: Schema.NullOr(ThreadId),
  sequence: NonNegativeInt,
});
export type OrchestratorReturnTaskChangesResult = typeof OrchestratorReturnTaskChangesResult.Type;

export const OrchestratorCompleteTaskWithoutChangesInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorCompleteTaskWithoutChangesInput =
  typeof OrchestratorCompleteTaskWithoutChangesInput.Type;

export const OrchestratorCompleteTaskWithoutChangesResult = Schema.Struct({
  taskId: TaskId,
  baseHead: TrimmedNonEmptyString,
  head: TrimmedNonEmptyString,
  sequence: NonNegativeInt,
});
export type OrchestratorCompleteTaskWithoutChangesResult =
  typeof OrchestratorCompleteTaskWithoutChangesResult.Type;

export const OrchestratorLandTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorLandTaskInput = typeof OrchestratorLandTaskInput.Type;

export const OrchestratorLandTaskResult = Schema.Struct({
  sequence: NonNegativeInt,
  alreadyLanded: Schema.Boolean,
});
export type OrchestratorLandTaskResult = typeof OrchestratorLandTaskResult.Type;

export const OrchestratorListArchivedTasksInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestratorListArchivedTasksInput = typeof OrchestratorListArchivedTasksInput.Type;

export const OrchestratorTaskRetentionInput = Schema.Struct({
  taskId: TaskId,
});
export type OrchestratorTaskRetentionInput = typeof OrchestratorTaskRetentionInput.Type;

export const OrchestratorClearPmChatInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestratorClearPmChatInput = typeof OrchestratorClearPmChatInput.Type;

export const OrchestratorRequestPmHandoffInput = Schema.Struct({
  projectId: ProjectId,
  mode: PmHandoffMode,
});
export type OrchestratorRequestPmHandoffInput = typeof OrchestratorRequestPmHandoffInput.Type;

export const OrchestratorRequestPmHandoffResult = Schema.Struct({
  accepted: Schema.Literal(true),
  mode: PmHandoffMode,
  fallback: Schema.optional(Schema.String),
});
export type OrchestratorRequestPmHandoffResult = typeof OrchestratorRequestPmHandoffResult.Type;

/**
 * A safe presentation of a freshly scanned project-context manifest. Raw
 * context content deliberately never crosses this boundary.
 */
export const OrchestratorGetProjectContextOnboardingInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestratorGetProjectContextOnboardingInput =
  typeof OrchestratorGetProjectContextOnboardingInput.Type;

export const OrchestratorProjectContextOnboardingFile = Schema.Struct({
  path: TrimmedNonEmptyString,
  classification: ProjectContextFileClassification,
});
export type OrchestratorProjectContextOnboardingFile =
  typeof OrchestratorProjectContextOnboardingFile.Type;

export const OrchestratorGetProjectContextOnboardingResult = Schema.Struct({
  projectId: ProjectId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
  promptKind: ProjectContextPromptKind,
  files: Schema.Array(OrchestratorProjectContextOnboardingFile),
  shouldPrompt: Schema.Boolean,
});
export type OrchestratorGetProjectContextOnboardingResult =
  typeof OrchestratorGetProjectContextOnboardingResult.Type;

/**
 * A dismissal is bound to one scanner schema and fingerprint. The server
 * rescans before dispatching so a delayed client cannot dismiss newer context.
 */
export const OrchestratorDismissProjectContextOnboardingInput = Schema.Struct({
  projectId: ProjectId,
  schemaVersion: ProjectContextSchemaVersion,
  fingerprint: ProjectContextFingerprint,
});
export type OrchestratorDismissProjectContextOnboardingInput =
  typeof OrchestratorDismissProjectContextOnboardingInput.Type;

export const OrchestratorDismissProjectContextOnboardingResult = Schema.Struct({
  sequence: NonNegativeInt,
});
export type OrchestratorDismissProjectContextOnboardingResult =
  typeof OrchestratorDismissProjectContextOnboardingResult.Type;

/**
 * The project-context baseline is captured by the server. Clients can select
 * a project and an optional capability tier, but cannot supply paths,
 * contents, Git state, or a command identifier.
 */
export const OrchestratorRequestProjectContextRunInput = Schema.Struct({
  projectId: ProjectId,
  tier: Schema.optionalKey(OrchestrationCapabilityTier),
});
export type OrchestratorRequestProjectContextRunInput =
  typeof OrchestratorRequestProjectContextRunInput.Type;

export const OrchestratorRequestProjectContextRunResult = Schema.Struct({
  runId: ProjectContextRunId,
  sequence: NonNegativeInt,
});
export type OrchestratorRequestProjectContextRunResult =
  typeof OrchestratorRequestProjectContextRunResult.Type;

export const OrchestratorResolveProjectContextRunStartInput = Schema.Struct({
  runId: ProjectContextRunId,
  action: ProjectContextRunPmStartAction,
});
export type OrchestratorResolveProjectContextRunStartInput =
  typeof OrchestratorResolveProjectContextRunStartInput.Type;

export const OrchestratorResolveProjectContextRunStartResult = Schema.Struct({
  runId: ProjectContextRunId,
  sequence: NonNegativeInt,
});
export type OrchestratorResolveProjectContextRunStartResult =
  typeof OrchestratorResolveProjectContextRunStartResult.Type;

export const OrchestratorCancelProjectContextRunStartInput = Schema.Struct({
  runId: ProjectContextRunId,
});
export type OrchestratorCancelProjectContextRunStartInput =
  typeof OrchestratorCancelProjectContextRunStartInput.Type;

export const OrchestratorCancelProjectContextRunStartResult = Schema.Struct({
  runId: ProjectContextRunId,
  sequence: NonNegativeInt,
});
export type OrchestratorCancelProjectContextRunStartResult =
  typeof OrchestratorCancelProjectContextRunStartResult.Type;

export const OrchestratorProjectContextRunReviewChangeKind = Schema.Literals([
  "added",
  "modified",
  "deleted",
]);
export type OrchestratorProjectContextRunReviewChangeKind =
  typeof OrchestratorProjectContextRunReviewChangeKind.Type;

/** A path-only change summary accompanies the bounded, deterministic diff. */
export const OrchestratorProjectContextRunReviewChange = Schema.Struct({
  path: ProjectContextRunPath,
  kind: OrchestratorProjectContextRunReviewChangeKind,
});
export type OrchestratorProjectContextRunReviewChange =
  typeof OrchestratorProjectContextRunReviewChange.Type;

export const ProjectContextRunReviewConflictKind = Schema.Literals([
  "provider-scope-violation",
  "context-drift",
  "workspace-drift",
  "head-drift",
  "protected-git-drift",
  "unknown",
]);
export type ProjectContextRunReviewConflictKind = typeof ProjectContextRunReviewConflictKind.Type;

export const ProjectContextRunReviewRecoveryAction = Schema.Literals([
  "retry",
  "reconcile",
  "hand-to-pm",
  "discard",
]);
export type ProjectContextRunReviewRecoveryAction =
  typeof ProjectContextRunReviewRecoveryAction.Type;

export const ProjectContextRunReviewConflict = Schema.Struct({
  kind: ProjectContextRunReviewConflictKind,
  detail: TrimmedNonEmptyString,
  paths: Schema.Array(TrimmedNonEmptyString),
  autoReconcile: Schema.Boolean,
  actions: Schema.Array(ProjectContextRunReviewRecoveryAction),
});
export type ProjectContextRunReviewConflict = typeof ProjectContextRunReviewConflict.Type;

export const OrchestratorProjectContextRunReview = Schema.Struct({
  runId: ProjectContextRunId,
  result: Schema.String.check(Schema.isMaxLength(PROJECT_CONTEXT_RUN_RESULT_MAX_CHARS)),
  changes: Schema.Array(OrchestratorProjectContextRunReviewChange),
  diff: Schema.String,
  diffTruncated: Schema.Boolean,
  scopeViolationPaths: ProjectContextRunScopeViolationPaths,
  conflict: Schema.NullOr(ProjectContextRunReviewConflict),
});
export type OrchestratorProjectContextRunReview = typeof OrchestratorProjectContextRunReview.Type;

export const OrchestratorGetProjectContextRunReviewInput = Schema.Struct({
  projectId: ProjectId,
});
export type OrchestratorGetProjectContextRunReviewInput =
  typeof OrchestratorGetProjectContextRunReviewInput.Type;

export const OrchestratorGetProjectContextRunReviewResult = Schema.Struct({
  review: Schema.NullOr(OrchestratorProjectContextRunReview),
});
export type OrchestratorGetProjectContextRunReviewResult =
  typeof OrchestratorGetProjectContextRunReviewResult.Type;

export const OrchestratorReviseProjectContextRunInput = Schema.Struct({
  runId: ProjectContextRunId,
  instructions: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS),
  ),
});
export type OrchestratorReviseProjectContextRunInput =
  typeof OrchestratorReviseProjectContextRunInput.Type;

export const OrchestratorReviseProjectContextRunResult = Schema.Struct({
  runId: ProjectContextRunId,
  sequence: NonNegativeInt,
});
export type OrchestratorReviseProjectContextRunResult =
  typeof OrchestratorReviseProjectContextRunResult.Type;

export const OrchestratorCommitProjectContextRunInput = Schema.Struct({
  runId: ProjectContextRunId,
  message: TrimmedNonEmptyString,
});
export type OrchestratorCommitProjectContextRunInput =
  typeof OrchestratorCommitProjectContextRunInput.Type;

export const OrchestratorCommitProjectContextRunResult = Schema.Struct({
  runId: ProjectContextRunId,
  commitHash: ProjectContextRunGitObjectId,
  sequence: NonNegativeInt,
});
export type OrchestratorCommitProjectContextRunResult =
  typeof OrchestratorCommitProjectContextRunResult.Type;

export const OrchestratorDiscardProjectContextRunInput = Schema.Struct({
  runId: ProjectContextRunId,
});
export type OrchestratorDiscardProjectContextRunInput =
  typeof OrchestratorDiscardProjectContextRunInput.Type;

export const OrchestratorDiscardProjectContextRunResult = Schema.Struct({
  runId: ProjectContextRunId,
  sequence: NonNegativeInt,
});
export type OrchestratorDiscardProjectContextRunResult =
  typeof OrchestratorDiscardProjectContextRunResult.Type;

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

export const OrchestrationForkThreadInput = Schema.Struct({
  sourceThreadId: ThreadId,
  sourceMessageId: MessageId,
});
export type OrchestrationForkThreadInput = typeof OrchestrationForkThreadInput.Type;

export const OrchestrationForkThreadResult = Schema.Struct({
  threadId: ThreadId,
  strategy: Schema.Literals(["provider-native", "copied-history"]),
  filesystem: Schema.Literal("current-state"),
  sequence: NonNegativeInt,
});
export type OrchestrationForkThreadResult = typeof OrchestrationForkThreadResult.Type;

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
  forkThread: {
    input: OrchestrationForkThreadInput,
    output: OrchestrationForkThreadResult,
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
  getPresetMigration: {
    input: Schema.Struct({}),
    output: OrchestratorPresetMigrationState,
  },
  completePresetMigration: {
    input: OrchestratorCompletePresetMigrationInput,
    output: OrchestratorPresetMigrationState,
  },
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
  setTaskCapabilityTiers: {
    input: OrchestratorSetTaskCapabilityTiersInput,
    output: DispatchResult,
  },
  cancelTask: {
    input: OrchestratorCancelTaskInput,
    output: DispatchResult,
  },
  interruptStage: {
    input: OrchestratorInterruptStageInput,
    output: OrchestratorInterruptStageResult,
  },
  inspectTaskChanges: {
    input: OrchestratorInspectTaskChangesInput,
    output: OrchestratorInspectTaskChangesResult,
  },
  commitTaskChanges: {
    input: OrchestratorCommitTaskChangesInput,
    output: OrchestratorCommitTaskChangesResult,
  },
  discardTaskChanges: {
    input: OrchestratorDiscardTaskChangesInput,
    output: OrchestratorDiscardTaskChangesResult,
  },
  returnTaskChanges: {
    input: OrchestratorReturnTaskChangesInput,
    output: OrchestratorReturnTaskChangesResult,
  },
  completeTaskWithoutChanges: {
    input: OrchestratorCompleteTaskWithoutChangesInput,
    output: OrchestratorCompleteTaskWithoutChangesResult,
  },
  landTask: {
    input: OrchestratorLandTaskInput,
    output: OrchestratorLandTaskResult,
  },
  listArchivedTasks: {
    input: OrchestratorListArchivedTasksInput,
    output: Schema.Array(OrchestrationTask),
  },
  archiveTask: {
    input: OrchestratorTaskRetentionInput,
    output: DispatchResult,
  },
  restoreTask: {
    input: OrchestratorTaskRetentionInput,
    output: DispatchResult,
  },
  deleteTask: {
    input: OrchestratorTaskRetentionInput,
    output: DispatchResult,
  },
  clearPmChat: {
    input: OrchestratorClearPmChatInput,
    output: DispatchResult,
  },
  requestPmHandoff: {
    input: OrchestratorRequestPmHandoffInput,
    output: OrchestratorRequestPmHandoffResult,
  },
  requestProjectContextRun: {
    input: OrchestratorRequestProjectContextRunInput,
    output: OrchestratorRequestProjectContextRunResult,
  },
  resolveProjectContextRunStart: {
    input: OrchestratorResolveProjectContextRunStartInput,
    output: OrchestratorResolveProjectContextRunStartResult,
  },
  cancelProjectContextRunStart: {
    input: OrchestratorCancelProjectContextRunStartInput,
    output: OrchestratorCancelProjectContextRunStartResult,
  },
  getProjectContextRunReview: {
    input: OrchestratorGetProjectContextRunReviewInput,
    output: OrchestratorGetProjectContextRunReviewResult,
  },
  getLaunchCapabilities: {
    input: Schema.Struct({}),
    output: OrchestratorLaunchCapabilities,
  },
  launch: {
    input: OrchestratorLaunchInput,
    output: OrchestratorLaunchResult,
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

export class OrchestrationForkThreadError extends Schema.TaggedErrorClass<OrchestrationForkThreadError>()(
  "OrchestrationForkThreadError",
  {
    sourceThreadId: ThreadId,
    sourceMessageId: MessageId,
    reason: Schema.Literals([
      "thread-not-found",
      "message-not-found",
      "invalid-boundary",
      "thread-busy",
      "provider-fork-failed",
      "dispatch-failed",
    ]),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationCancelTaskError extends Schema.TaggedErrorClass<OrchestrationCancelTaskError>()(
  "OrchestrationCancelTaskError",
  {
    taskId: TaskId,
    phase: Schema.Literals([
      "read-task",
      "interrupt-turn",
      "stop-session",
      "close-terminals",
      "abandon",
    ]),
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class OrchestrationInterruptStageError extends Schema.TaggedErrorClass<OrchestrationInterruptStageError>()(
  "OrchestrationInterruptStageError",
  {
    taskId: TaskId,
    reason: Schema.Literals([
      "task-not-found",
      "no-active-stage",
      "stage-thread-not-found",
      "not-running",
    ]),
    message: TrimmedNonEmptyString,
  },
) {}

export class OrchestrationLandTaskError extends Schema.TaggedErrorClass<OrchestrationLandTaskError>()(
  "OrchestrationLandTaskError",
  {
    taskId: TaskId,
    reason: Schema.Literals(["task-not-found", "worktree-unavailable"]),
    message: TrimmedNonEmptyString,
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
