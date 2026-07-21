import {
  ApprovalRequestId,
  EventId,
  CommandId,
  OrchestratorProjectConfig,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery.ts";
import {
  increment,
  orchestrationPmReEntryDuration,
  orchestrationQuotaBlockedDuration,
  orchestrationQuotaBlockedInstances,
  orchestrationQuotaBlockedStages,
  orchestrationQuotaResetClearedTotal,
  orchestrationQuotaStageResumedTotal,
  orchestrationReconciliationSettlementsRedrivenTotal,
  orchestrationReconciliationSweepDuration,
  orchestrationReconciliationSweepsTotal,
  recordDuration,
  setGauge,
  withMetrics,
} from "../../observability/Metrics.ts";
import { ProjectionAwaitedStageRepository } from "../../persistence/Services/ProjectionAwaitedStages.ts";
import { ProjectionQuotaBlockedStageRepository } from "../../persistence/Services/ProjectionQuotaBlockedStages.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import {
  defaultOkQuotaState,
  ProviderQuotaStatusRepository,
} from "../../persistence/Services/ProviderQuotaStatus.ts";
import {
  makeGateSettlementKey,
  makeStageSettlementKey,
  PmRuntimeStateRepository,
  type PmConsumedSettlement,
  type PmConsumedSettlementKind,
} from "../../persistence/Services/PmRuntimeState.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../../provider/Services/ProviderAdapterRegistry.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderSessionDirectoryShape,
} from "../../provider/Services/ProviderSessionDirectory.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PmProjectRuntimeFactory,
  PmRuntime,
  type PmProjectRuntime,
  type PmProjectRuntimeFactoryShape,
  type PmRuntimeShape,
} from "../Services/PmRuntime.ts";
import { ProjectContextRunCoordinator } from "../Services/ProjectContextRunCoordinator.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { defaultTaskTypeRegistry } from "../TaskTypeRegistry.ts";
import { PmRuntimeError, toPmRuntimeError } from "../pm/Errors.ts";
import { classifyRuntimeErrorClass } from "../../provider/rateLimits.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "../pm/PmEventProjection.ts";
import { resolveOrchestratorPmRuntimePolicy } from "../orchestratorRuntimeModes.ts";
import { pmQuotaPausedActivityCommandId, pmQuotaPausedActivityId } from "../stageResolution.ts";
import { makePmReEntryQueue } from "../pm/PmReEntryQueue.ts";
import {
  buildPmHandoffTranscript,
  DEFAULT_PM_HANDOFF_TRANSCRIPT_BUDGET_CHARS,
} from "../pm/pmHandoff.ts";
import { clearSqliteSessionStorage } from "../pm/LegacySessionStorage.ts";
import {
  makeDriverPmAdapter,
  type DriverPmAdapterOptions,
  type DriverPmProviderAdapter,
} from "../claude/DriverPmAdapter.ts";
import { CLAUDE_PM_DRIVER, CODEX_PM_DRIVER } from "../claude/constants.ts";
import { makeOrchestrationMcpServer } from "../claude/pmMcpServer.ts";
import { OrchestrationMcpServerProvider } from "../claude/OrchestrationMcpServerProvider.ts";
import type {
  AgentHarnessResources,
  AssistantMessage,
  ModelDescriptor,
  PmAdapterShape,
  TextContent,
} from "../claude/pmHarness.ts";
import { resumeQuotaBlockedStageWithServices } from "../quotaStageResumption.ts";
import { recoverElapsedProviderQuotaBlocks } from "../quotaResetRecovery.ts";
import {
  buildStageResult,
  serializeStageResultToMessage,
  type StageResult,
} from "../StageResultBuilder.ts";
import { boundUntrustedContent, scrubSecrets } from "../untrustedContent.ts";

type SettlementEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "task.stage-completed"
      | "task.change-review-requested"
      | "task.stage-blocked"
      | "task.stage-interrupted"
      | "task.gate-resolved"
      | "thread.activity-appended"
      | "helper.run-completed"
      | "helper.run-failed"
      | "helper.run-interrupted";
  }
>;

type SettlementEnvelope = {
  readonly event: SettlementEvent;
  readonly project: OrchestrationProject;
  readonly task: OrchestrationTask | null;
  readonly kind: "stage" | "gate" | "approval";
  readonly settlementKey: string;
  readonly message: string;
};

const withLastActionCursor = (message: string, event: SettlementEvent): string =>
  boundUntrustedContent(`${message}\n\nLast-action cursor: ${event.sequence}`);

type RuntimeCacheEntry = {
  readonly runtime: PmProjectRuntime;
  readonly waitForIdle: Effect.Effect<void, PmRuntimeError>;
  readonly interruptActive: Effect.Effect<void, PmRuntimeError>;
  readonly invalidateRuntime: (reason: string) => Effect.Effect<void, PmRuntimeError>;
};

export interface PmRuntimeLiveOptions {
  readonly reconciliationIntervalMsOverride?: number;
}

export interface PmProjectRuntimeFactoryOptions {
  readonly makeDriverPmAdapterOverride?: (
    options: DriverPmAdapterOptions,
  ) => Effect.Effect<PmAdapterShape, never, never>;
}

const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);
const defaultOrchestratorConfig = Option.getOrThrow(decodeOrchestratorConfig({}));
const pmDecisionPromptLine = (driverKind: ProviderDriverKind): string =>
  driverKind === CODEX_PM_DRIVER
    ? "For decisions, ask in plain text and end your turn."
    : "Use the interactive question tool for concrete decisions with a small set of options; for open-ended discussion, just end the turn with the question in plain text.";

const pmSystemPrompt = (driverKind: ProviderDriverKind): string =>
  [
    "You are the orchestrator project manager (PM). You have orchestration, skill-loading, read/search, shell, and workspace-editing tools for this project. Your primary job is feature design, task classification, skill checks, research, planning, coordinating substantial implementation, and verifying results.",
    "Use your own workspace tools for exploration and bounded low-risk maintenance when that is faster and clearer than creating a task. Delegate proper implementation tasks through the orchestration workflow; do not create worker handoffs merely to perform a tiny mechanical edit.",
    "Before task creation, the task tooling requires a clean primary checkout with a configured GitHub upstream, fetches that upstream, and fast-forwards a safely behind branch. Never bypass dirty, ahead, diverged, detached, non-Git, or non-GitHub preparation failures; explain the required setup to the human.",
    "Classify work as a direct PM change only when it is one bounded, low-risk edit with no design decision, migration, public contract change, security-sensitive logic, broad verification, or uncertain scope. State the concrete reason it qualifies. Anything outside those limits becomes a task.",
    "For direct work, inspect the primary checkout first, preserve existing user changes, make the smallest edit, and run proportional checks. Then call inspectDirectChanges and review the combined diff. Commit only an exact intended patch with commitDirectChanges, including a descriptive message, the low-risk rationale, and the commands plus observed outcomes. Never use path-wide staging for direct work: other user hunks may exist in the same file. Report the returned commit and any remaining dirty paths. Direct work creates no task, gate, worktree, PR, or landing action.",
    "You run with full project access and own authenticated host operations that sandboxed workers cannot perform, such as authenticated GitHub CLI calls. Treat meaningful external, destructive, or publishing actions as human-gated; never delegate them merely to escape that approval boundary.",
    "Keep simple, well-understood planning in your own PM turn and give the resulting bounded plan directly to the worker. Delegate planning only when complexity, risk, or uncertainty merits a separate attempt; delegated plans default to the Genius tier. When a plan is doubtful, dispatch another Genius `plan` attempt with explicit critique instructions.",
    "Operate by driving the stage roles through your tools: classify assigns type/playbook, plan designs or critiques complex implementation, work implements, and verify validates completed work before landing.",
    "Planner stages own design documentation only. Verifier stages own verification evidence and context documentation only. Only work stages may modify substantive implementation code; if verification finds a code defect, return it to a work stage instead of asking the verifier to repair it.",
    "Worker stages run in a sandboxed auto-approve environment. Include relevant sandbox constraints in each handoff. When a task needs credentials or authenticated host access, have the worker stop at the boundary and report the exact operation; perform that operation yourself only when it is within the user's granted authority, otherwise ask the human.",
    "Steer running workers with steerStage for course corrections, added context, or answers when a worker has drifted; use interruptStage when the active turn must stop immediately, and prefer steering over interruption when the same stage can continue.",
    "Never poll inspectStage or schedule recurring status checks. Worker settlements, gate resolutions, worker permission requests, quota changes, and interrupt outcomes re-enter you automatically. Use inspectStage only for an explicit operator status request or one bounded diagnostic immediately before a concrete steer/cancel decision.",
    "For bounded read-only context gathering, use startHelperRun instead of creating an exploration task. Attach it to the PM for project-wide context or to an existing task when later stages should receive the result. Cheap is the default; choose Smart or Genius only when the investigation itself requires more judgment. Helper completion, failure, and interruption re-enter you automatically, so never poll inspectHelperRun. Helpers create no task, stage, gate, worktree, commit, PR, landing action, or task-board card.",
    "When work settles in change review, call inspectTaskChanges once. Commit only intended paths or an exact intended patch with commitTaskChanges, use discardTaskChanges only for explicitly selected changes that are outside task intent, or use returnTaskChanges with precise revision instructions. Never bypass change review or start verification while changes remain pending.",
    "A Verify handoff refreshes the clean primary GitHub upstream and rebases the clean task worktree before the verifier starts. If target movement conflicts, return the task to Work for resolution. Never verify or land against the pre-movement HEAD.",
    "When settled work is clean and you accept that the task correctly requires no repository changes, call completeTaskWithoutChanges. It verifies the task branch against its creation baseline and archives the no-change result; never request land approval for empty work.",
    "Landing remains Ready to land while the approved branch is pushed and its pull request is opened. A GitHub or authentication failure retains the worktree, verification, and retryable review state. Treat a task as terminally landed only after a real pull-request URL is recorded.",
    "When a worker permission request re-enters you, use listPendingStageApprovals for the task and resolve it with respondToStageApproval. Approve only access that is necessary for the delegated task and consistent with its instructions. Prefer accept for a single action; use acceptForSession only for a stable, repeated, narrowly scoped need. Decline unrelated, destructive, secret-bearing, or scope-expanding access. Ask the human only when the requested authority is genuinely ambiguous or exceeds the task they assigned.",
    "Use your tools to create tasks, hand off stages, inspect ledgers, and request human approval gates; do not claim a stage is done until the relevant worker settlement is present.",
    "Reuse an existing task whenever possible. When replacement is intentional, settle the old task first and pass its id as createTask.supersedesTaskId so the ledger records one explicit successor instead of unrelated duplicates.",
    "Create a release task only for one fully landed feature task, using taskType `release` and createTask.releaseSourceTaskId. After release preparation itself lands, call requestReleaseApproval with the exact GitHub Actions workflow/ref/inputs, wait for human approval, then call dispatchRelease once with unchanged parameters. Treat the returned releaseDispatch status and workflow URL as authoritative; never retry a recorded attempt automatically or publish outside this actuator.",
    "During planning, split a task only when its implementation cannot be completed and verified as one focused work stage—for example, when it spans independently shippable subsystems, requires ordered migrations, or has acceptance criteria that should be verified separately. Do not split merely to parallelize small edits.",
    "For an oversized task, make the proposed plan describe 2-8 ordered child slices, each with a narrow title, explicit acceptance criteria, and dependencies only on earlier child keys. Request the ordinary plan gate against that complete proposed plan; the one plan approval covers the child structure, so do not invent or request a separate split gate.",
    "After that plan gate is approved and the parent has no active stage, call splitTask exactly once with a stable idempotency key and the approved child structure. Then start only children whose blockedByTaskIds ledger field is empty; independent unblocked children may run in parallel within resource limits.",
    "Re-entry messages and task ledgers carry last-action cursors. Treat them as authoritative progress markers; do not reload full worker histories. getTaskLedger returns bounded summaries and only the three most recent attempts per task.",
    pmDecisionPromptLine(driverKind),
    "You may run multiple agents of each kind in parallel when the ledger's resource limits allow.",
    "Choose a capability tier for every handoff. Use Cheap for narrow mechanical work and routine checks, Smart for ordinary implementation or verification that needs judgment, and Genius for delegated planning or unusually difficult reasoning. Honor a task's saved role tier unless you have a concrete reason to override it for this attempt; setTaskTier changes the visible task default while handoffWorker.tier overrides only that attempt.",
    "Escalation is explicit and evidence-based. Never move to a higher tier because of quota exhaustion, permissions, unavailable tools, environment failures, network failures, or provider errors; diagnose or surface those blockers at the same tier. Retry at a higher tier only when the completed result demonstrates a reasoning or capability shortfall, and state that diagnosis in the new attempt instructions.",
    "When the human asks for substantial implementation, turn it into a task and drive it through the appropriate stages. Keep direct PM changes bounded, review them carefully, and report exactly what changed.",
  ].join("\n");

const PM_HANDOFF_BRIEF_PROMPT =
  "Write a concise handoff brief for your successor PM: project state, active tasks and their stages, open questions, decisions in flight.";
const PM_HANDOFF_BRIEF_TIMEOUT = Duration.seconds(90);

const textContent = (message: AssistantMessage): string =>
  message.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("")
    .trim();

const wrapSummaryHandoffContext = (brief: string): string =>
  [
    "--- BEGIN PM HANDOFF CONTEXT ---",
    "You are taking over as the project PM mid-conversation; the prior PM prepared this handoff brief.",
    brief.trim(),
    "--- END PM HANDOFF CONTEXT ---",
  ].join("\n");

const appendPmHandoffContext = (systemPrompt: string, context: string): string =>
  [systemPrompt, context].filter((part) => part.trim().length > 0).join("\n\n");

const pmHandoffCompletedCommandId = (threadId: ThreadId, createdAt: string): CommandId =>
  CommandId.make(`pm-handoff-completed:${threadId}:${createdAt}`);

const pmHandoffActivityCommandId = (threadId: ThreadId, createdAt: string): CommandId =>
  CommandId.make(`pm-handoff-activity:${threadId}:${createdAt}`);

const pmHandoffActivityId = (threadId: ThreadId, createdAt: string): EventId =>
  EventId.make(`pm-handoff:${threadId}:${createdAt}`);

const PM_TURN_FAILURE_REASON_MAX_CHARS = 480;
const PM_TURN_FAILURE_SUMMARY_MAX_CHARS = 640;

const AUTH_ERROR_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\bauth(?:entication|orization)?\b/i,
  /\bunauth(?:enticated|orized)\b/i,
  /\blogin required\b/i,
  /\bnot logged in\b/i,
  /\binvalid api[_ -]?key\b/i,
  /\bapi[_ -]?key\b/i,
  /\boauth\b/i,
  /\bcredentials?\b/i,
  /\btoken\b/i,
  /\b401\b/,
];

const ABORT_ERROR_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\babort(?:ed)?\b/i,
  /\binterrupted\b/i,
  /\bcancel(?:led|ed)\b/i,
];

function compactOneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateOneLine(value: string, maxChars: number): string {
  const compacted = compactOneLine(value);
  if (compacted.length <= maxChars) {
    return compacted;
  }
  return `${compacted.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  if (
    cause !== null &&
    typeof cause === "object" &&
    "message" in cause &&
    typeof (cause as { readonly message?: unknown }).message === "string"
  ) {
    return (cause as { readonly message: string }).message;
  }
  return "";
}

function pmRuntimeErrorText(error: PmRuntimeError): string {
  const detail = compactOneLine(error.detail);
  const causeText = compactOneLine(causeMessage(error.cause));
  if (causeText.length === 0 || causeText === detail) {
    return detail;
  }
  return `${detail} ${causeText}`.trim();
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function pmTurnFailedActivityId(projectId: OrchestrationProject["id"], message: string): EventId {
  return EventId.make(`server:pm-turn-failed:${projectId}:${stableHash(message)}`);
}

type PmTurnFailureCategory = "rate_limit" | "auth" | "aborted" | "provider_error";

function classifyPmTurnFailure(message: string): PmTurnFailureCategory {
  if (classifyRuntimeErrorClass({ message, fallback: "provider_error" }) === "rate_limit") {
    return "rate_limit";
  }
  if (AUTH_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "auth";
  }
  if (ABORT_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "aborted";
  }
  return "provider_error";
}

function formatPmTurnFailure(error: PmRuntimeError): {
  readonly category: PmTurnFailureCategory;
  readonly reason: string;
  readonly summary: string;
} {
  const rawMessage = pmRuntimeErrorText(error);
  const reason = truncateOneLine(
    scrubSecrets(rawMessage.length > 0 ? rawMessage : "Unknown error."),
    PM_TURN_FAILURE_REASON_MAX_CHARS,
  );
  const category = classifyPmTurnFailure(rawMessage);
  const prefix =
    category === "rate_limit"
      ? "PM turn failed: PM provider quota or rate limit reached."
      : category === "auth"
        ? "PM turn failed: PM provider authentication failed."
        : category === "aborted"
          ? "PM turn failed: PM turn was aborted."
          : "PM turn failed:";
  return {
    category,
    reason,
    summary: truncateOneLine(`${prefix} ${reason}`, PM_TURN_FAILURE_SUMMARY_MAX_CHARS),
  };
}

/**
 * The PM system prompt scoped to a specific project: prepends the project
 * identity + "operate on this project, never ask for ids" framing to the static
 * role guidance, so the PM acts on the project it is attached to instead of
 * asking the human for a project/repo id.
 */
export const buildPmSystemPrompt = (
  project: {
    readonly id: string;
    readonly title: string;
    readonly workspaceRoot: string;
  },
  driverKind: ProviderDriverKind = CLAUDE_PM_DRIVER,
): string =>
  [
    `You are scoped to project "${project.title}" (project id: ${project.id}), workspace root ${project.workspaceRoot}.`,
    `Operate on THIS project only — never ask the human for a project id or repo id; when a tool needs a projectId, use ${project.id}. Create tasks and hand off stages for this project directly.`,
    pmSystemPrompt(driverKind),
  ].join("\n");

const isApprovalRequestEvent = (
  event: OrchestrationEvent,
): event is Extract<SettlementEvent, { type: "thread.activity-appended" }> =>
  event.type === "thread.activity-appended" && event.payload.activity.kind === "approval.requested";

const isSettlementEvent = (event: OrchestrationEvent): event is SettlementEvent =>
  (event.type === "task.stage-completed" &&
    !(event.payload.role === "work" && event.payload.worktreeCompletion?.dirty === true)) ||
  event.type === "task.change-review-requested" ||
  event.type === "task.stage-blocked" ||
  event.type === "task.stage-interrupted" ||
  event.type === "task.gate-resolved" ||
  event.type === "helper.run-completed" ||
  event.type === "helper.run-failed" ||
  event.type === "helper.run-interrupted" ||
  isApprovalRequestEvent(event);

const settlementEventKind = (event: SettlementEvent): PmConsumedSettlementKind =>
  event.type === "task.gate-resolved"
    ? "gate"
    : event.type === "thread.activity-appended"
      ? "approval"
      : "stage";

const quotaBlockedStageSettlementKey = (stageThreadId: ThreadId): string =>
  `${stageThreadId}::quota-blocked`;

const interruptedStageSettlementKey = (stageThreadId: ThreadId): string =>
  `${stageThreadId}::interrupted`;

const changeReviewSettlementKey = (stageThreadId: ThreadId): string =>
  `${stageThreadId}::change-review`;

const helperSettlementKey = (helperRunId: string): string => `helper:${helperRunId}`;

const settlementEventKey = (event: SettlementEvent): string =>
  event.type === "task.stage-completed"
    ? makeStageSettlementKey({
        stageThreadId: event.payload.stageThreadId,
        awaitedTurnId: event.payload.awaitedTurnId,
      })
    : event.type === "task.change-review-requested"
      ? changeReviewSettlementKey(event.payload.workStageThreadId)
      : event.type === "task.stage-blocked"
        ? quotaBlockedStageSettlementKey(event.payload.stageThreadId)
        : event.type === "task.stage-interrupted"
          ? interruptedStageSettlementKey(event.payload.stageThreadId)
          : event.type === "helper.run-completed" ||
              event.type === "helper.run-failed" ||
              event.type === "helper.run-interrupted"
            ? helperSettlementKey(event.payload.helperRunId)
            : event.type === "task.gate-resolved"
              ? makeGateSettlementKey(event.payload.gateId)
              : (approvalRequestIdFromEvent(event) ?? String(event.payload.activity.id));

const approvalRequestIdFromEvent = (
  event: Extract<SettlementEvent, { type: "thread.activity-appended" }>,
): string | null => {
  const payload = event.payload.activity.payload;
  if (typeof payload !== "object" || payload === null || !("requestId" in payload)) {
    return null;
  }
  return typeof payload.requestId === "string" && payload.requestId.length > 0
    ? payload.requestId
    : null;
};

const findSettlementEvent = (
  events: ReadonlyArray<SettlementEvent>,
  input: { readonly kind: PmConsumedSettlementKind; readonly settlementKey: string },
): SettlementEvent | undefined =>
  events.find(
    (event) =>
      settlementEventKind(event) === input.kind &&
      settlementEventKey(event) === input.settlementKey,
  );

const resolveProjectConfig = (project: OrchestrationProject) =>
  Option.getOrElse(
    decodeOrchestratorConfig(project.orchestratorConfig ?? {}),
    () => defaultOrchestratorConfig,
  );

export const resolvePmHarnessResources = (
  taskTypeIds: ReadonlyArray<string>,
): AgentHarnessResources | undefined => {
  const skills = taskTypeIds
    .map((taskTypeId) => defaultPlaybookLoader.resolve(taskTypeId)?.skill)
    .filter((skill) => skill !== undefined);

  return skills.length > 0 ? { skills } : undefined;
};

const gateResultMessage = (input: {
  readonly event: Extract<SettlementEvent, { type: "task.gate-resolved" }>;
  readonly task: OrchestrationTask;
}): string => {
  const payload = input.event.payload;
  // Bound and scrub like the stage result envelope. Every interpolated field is
  // human/client origin (never PM-injectable), but several are unbounded
  // free-form strings — `task.title`, `approvedHash`, and `gateId` (only
  // `gate`/`decision`/`origin` are closed literals) — so the whole envelope
  // rides the same `boundUntrustedContent` path (secret scrub + length cap) as
  // the worker stage message rather than reaching the PM prompt raw.
  return boundUntrustedContent(`A human gate was resolved.

Task: ${input.task.title}
Task ID: ${input.task.id}
Gate: ${payload.gate}
Decision: ${payload.decision}
Origin: ${payload.origin}
Approved hash: ${payload.approvedHash}
Gate ID: ${payload.gateId}`);
};

const quotaBlockedStageMessage = (input: {
  readonly event: Extract<SettlementEvent, { type: "task.stage-blocked" }>;
  readonly task: OrchestrationTask;
}): string => {
  const payload = input.event.payload;
  return boundUntrustedContent(`A worker stage paused on subscription quota.

Task: ${input.task.title}
Task ID: ${input.task.id}
Stage role: ${payload.role}
Stage thread ID: ${payload.stageThreadId}
Provider instance: ${payload.providerInstanceId}
Reset time: ${payload.resetAt ?? "unknown"}

The task is now blocked-on-quota and should be resumed when the provider instance recovers or after an operator switches the role backend.`);
};

const makeNoPmRuntimeError = (detail: string, cause?: unknown): PmRuntimeError =>
  new PmRuntimeError({
    operation: "PmProjectRuntimeFactory.getOrCreate",
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });

const interruptedStageMessage = (input: {
  readonly event: Extract<SettlementEvent, { type: "task.stage-interrupted" }>;
  readonly task: OrchestrationTask;
}): string => {
  const payload = input.event.payload;
  const operatorInterrupted = payload.reason === "operator";
  return boundUntrustedContent(`A worker stage was interrupted${operatorInterrupted ? " by an operator" : " during server restart recovery"}.

Task: ${input.task.title}
Task ID: ${input.task.id}
Stage role: ${payload.role}
Stage thread ID: ${payload.stageThreadId}
Reason: ${operatorInterrupted ? "the provider confirmed the requested turn interruption" : "the projected active stage had no live provider session"}.

The stage ownership was cleared and the task is blocked. Retry the same role with a fresh worker handoff after checking whether the prior attempt left useful work in the task worktree.`);
};

type ResolvedPmHarnessConfig = {
  readonly selection: ModelSelection;
  readonly providerInstanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
};

const resetDriverPmSession = (input: {
  readonly project: OrchestrationProject;
  readonly driverKind: ProviderDriverKind;
  readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  readonly providerSessionDirectory: ProviderSessionDirectoryShape;
}): Effect.Effect<void, PmRuntimeError> =>
  Effect.gen(function* () {
    const runtimePolicy = resolveOrchestratorPmRuntimePolicy(input.driverKind);
    const pmThreadId = pmThreadIdForProject(input.project);
    const binding = yield* input.providerSessionDirectory
      .getBinding(pmThreadId)
      .pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(
          toPmRuntimeError(
            "PmProjectRuntimeFactory.resetDriverPmSession",
            "Failed to read PM provider session binding.",
          ),
        ),
      );

    if (binding?.provider !== input.driverKind || binding.providerInstanceId === undefined) {
      return;
    }

    const providerAdapter = yield* input.providerAdapterRegistry
      .getByInstance(binding.providerInstanceId)
      .pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.map((adapter) =>
          adapter !== undefined && adapter.provider === input.driverKind ? adapter : undefined,
        ),
      );

    if (providerAdapter !== undefined) {
      yield* providerAdapter.stopSession(pmThreadId).pipe(Effect.catchCause(() => Effect.void));
    }

    yield* input.providerSessionDirectory
      .upsert({
        threadId: pmThreadId,
        provider: input.driverKind,
        providerInstanceId: binding.providerInstanceId,
        status: "stopped",
        runtimeMode: runtimePolicy.runtimeMode,
        resumeCursor: null,
      })
      .pipe(
        Effect.mapError(
          toPmRuntimeError(
            "PmProjectRuntimeFactory.resetDriverPmSession",
            "Failed to reset PM driver resume cursor.",
          ),
        ),
      );
  });
const DEFAULT_CLAUDE_PM_CONTEXT_WINDOW = 200_000;
const EXTENDED_CLAUDE_PM_CONTEXT_WINDOW = 1_000_000;
// Codex model metadata does not expose a stable PM context-window field here.
// Match the current GPT-5 Codex app-server context size used by the provider catalog.
const DEFAULT_CODEX_PM_CONTEXT_WINDOW = 272_000;

const samePmModelSelection = (left: ModelSelection, right: ModelSelection): boolean =>
  Equal.equals(left, right);

const canApplyPmModelInPlace = (
  current: ResolvedPmHarnessConfig,
  next: ResolvedPmHarnessConfig,
): boolean =>
  current.providerInstanceId === next.providerInstanceId && current.provider === next.provider;

const resolveClaudePmContextWindow = (selection: ModelSelection): number =>
  getModelSelectionStringOptionValue(selection, "contextWindow") === "1m"
    ? EXTENDED_CLAUDE_PM_CONTEXT_WINDOW
    : DEFAULT_CLAUDE_PM_CONTEXT_WINDOW;

const pmAdapterModelDescriptor = (
  selection: ModelSelection,
  driverKind: ProviderDriverKind,
): ModelDescriptor => {
  const isCodex = driverKind === CODEX_PM_DRIVER;
  return {
    id: selection.model,
    name: selection.model,
    api: isCodex ? "codex-app-server" : "anthropic-messages",
    provider: isCodex ? "openai" : "anthropic",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: isCodex
      ? DEFAULT_CODEX_PM_CONTEXT_WINDOW
      : resolveClaudePmContextWindow(selection),
    maxTokens: 0,
  } satisfies ModelDescriptor;
};

const resolvePmHarnessConfig = (
  project: OrchestrationProject,
  services: {
    readonly serverSettings: ServerSettingsShape;
    readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  },
): Effect.Effect<ResolvedPmHarnessConfig, PmRuntimeError> =>
  Effect.gen(function* () {
    const config = resolveProjectConfig(project);
    const settings = yield* services.serverSettings.getSettings.pipe(
      Effect.mapError((cause) =>
        makeNoPmRuntimeError("Failed to read server settings for PM model selection.", cause),
      ),
    );
    const pmModelSelection =
      config.pmModelSelection ?? settings.orchestratorDefaults.pmModelSelection ?? null;
    if (pmModelSelection === null) {
      return yield* makeNoPmRuntimeError(
        `Project '${project.id}' has no PM model selection configured.`,
      );
    }

    const providerInfo = yield* services.providerAdapterRegistry
      .getInstanceInfo(pmModelSelection.instanceId)
      .pipe(
        Effect.mapError((cause) =>
          makeNoPmRuntimeError(
            `PM provider instance '${pmModelSelection.instanceId}' is not configured.`,
            cause,
          ),
        ),
      );
    if (!providerInfo.enabled) {
      return yield* makeNoPmRuntimeError(
        `PM provider instance '${pmModelSelection.instanceId}' is disabled.`,
      );
    }

    return {
      selection: pmModelSelection,
      providerInstanceId: pmModelSelection.instanceId,
      provider: providerInfo.driverKind,
    };
  });

const isSupportedPmDriver = (driverKind: ProviderDriverKind): boolean =>
  driverKind === CLAUDE_PM_DRIVER || driverKind === CODEX_PM_DRIVER;

const resolveDriverPmAdapter = (
  config: ResolvedPmHarnessConfig,
  providerAdapterRegistry: ProviderAdapterRegistryShape,
): Effect.Effect<DriverPmProviderAdapter, PmRuntimeError> =>
  Effect.gen(function* () {
    if (!isSupportedPmDriver(config.provider)) {
      return yield* makeNoPmRuntimeError(
        `The orchestrator PM requires a Claude or Codex provider instance. Provider instance '${config.providerInstanceId}' uses '${config.provider}'.`,
      );
    }

    const adapter = yield* providerAdapterRegistry
      .getByInstance(config.providerInstanceId)
      .pipe(
        Effect.mapError((cause) =>
          makeNoPmRuntimeError(
            `Failed to resolve provider adapter for PM provider instance '${config.providerInstanceId}'.`,
            cause,
          ),
        ),
      );
    if (adapter.provider !== config.provider) {
      return yield* makeNoPmRuntimeError(
        `The orchestrator PM provider instance '${config.providerInstanceId}' is configured as '${config.provider}' but resolved adapter '${adapter.provider}'.`,
      );
    }
    return adapter;
  });

export const makePmRuntime = (options?: PmRuntimeLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationMcpServerProvider = yield* OrchestrationMcpServerProvider;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const projectionAwaitedStageRepository = yield* ProjectionAwaitedStageRepository;
    const projectionQuotaBlockedStageRepository = yield* ProjectionQuotaBlockedStageRepository;
    const projectionPendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
    const providerQuotaStatusRepository = yield* ProviderQuotaStatusRepository;
    const pmRuntimeStateRepository = yield* PmRuntimeStateRepository;
    const projectRuntimeFactory = yield* PmProjectRuntimeFactory;
    const projectContextRuns = yield* ProjectContextRunCoordinator;
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const reconciliationIntervalMs = Math.max(
      1,
      options?.reconciliationIntervalMsOverride ??
        settings.orchestratorDefaults.pmReconciliationIntervalMs,
    );
    const reconciliationSemaphore = yield* Semaphore.make(1);
    const orchestrationMcpServer = yield* makeOrchestrationMcpServer;
    yield* orchestrationMcpServerProvider.register(() => Promise.resolve(orchestrationMcpServer));

    const resolveTaskProject = Effect.fn("PmRuntime.resolveTaskProject")(function* (
      taskId: OrchestrationTask["id"],
    ) {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      const task = readModel.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        return null;
      }
      const project = readModel.projects.find((entry) => entry.id === task.projectId);
      if (!project) {
        return null;
      }
      return { task, project };
    });

    const resolveStageThreadTaskProject = Effect.fn("PmRuntime.resolveStageThreadTaskProject")(
      function* (stageThreadId: ThreadId) {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        const task = readModel.tasks.find((entry) => entry.stageThreadIds.includes(stageThreadId));
        if (!task) {
          return null;
        }
        const project = readModel.projects.find((entry) => entry.id === task.projectId);
        return project ? { task, project } : null;
      },
    );

    const latestAssistantTextForStage = Effect.fn("PmRuntime.latestAssistantTextForStage")(
      function* (event: Extract<SettlementEvent, { type: "task.stage-completed" }>) {
        const thread = yield* projectionSnapshotQuery
          .getThreadDetailById(event.payload.stageThreadId)
          .pipe(Effect.map(Option.getOrNull));
        const assistantMessages =
          thread?.messages.filter(
            (message) =>
              message.role === "assistant" &&
              (event.payload.awaitedTurnId === null ||
                message.turnId === event.payload.awaitedTurnId),
          ) ?? [];
        return assistantMessages.at(-1)?.text ?? null;
      },
    );

    // Resolve the worker's captured diff for a completed stage.
    //
    // The settlement payload carries `awaitedTurnId` (an opaque TurnId), not a
    // checkpoint turn COUNT, and `getFullThreadDiff` needs a count. There is no
    // clean per-turn → count mapping, so we bind the diff to the FULL thread up
    // to `getFullThreadDiffContext.latestCheckpointTurnCount` (documented
    // choice). `getFullThreadDiffContext`'s `latestCheckpointTurnCount` is a
    // MAX over all of the thread's checkpoints and is independent of the
    // `toTurnCount` argument, so we pass 0 purely to discover it.
    //
    // This helper only READS projection/checkpoint state and NEVER fails the
    // settlement: missing context or a CheckpointServiceError both degrade to
    // `undefined` (diff-unavailable). WP-2 gates completion on a real captured
    // diff, so the unavailable path is belt-and-suspenders.
    const resolveStageDiff = Effect.fn("PmRuntime.resolveStageDiff")(function* (
      event: Extract<SettlementEvent, { type: "task.stage-completed" }>,
    ) {
      const stageThreadId = event.payload.stageThreadId;
      const context = yield* projectionSnapshotQuery
        .getFullThreadDiffContext(stageThreadId, 0)
        .pipe(
          Effect.map(Option.getOrNull),
          // A projection read error must degrade to diff-unavailable, never fail
          // the settlement (same contract as the getFullThreadDiff catch below).
          Effect.catch((cause) =>
            Effect.logWarning(
              "PM runtime could not resolve worker diff context for stage settlement",
              {
                stageThreadId: String(stageThreadId),
                taskId: String(event.payload.taskId),
                cause: cause.message,
              },
            ).pipe(Effect.as(null)),
          ),
        );
      if (context === null || context.latestCheckpointTurnCount <= 0) {
        return undefined;
      }
      return yield* checkpointDiffQuery
        .getFullThreadDiff({
          threadId: stageThreadId,
          toTurnCount: context.latestCheckpointTurnCount,
        })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("PM runtime could not capture worker diff for stage settlement", {
              stageThreadId: String(stageThreadId),
              taskId: String(event.payload.taskId),
              toTurnCount: context.latestCheckpointTurnCount,
              cause: cause.message,
            }).pipe(Effect.as(undefined)),
          ),
        );
    });

    const makeSettlementEnvelope = Effect.fn("PmRuntime.makeSettlementEnvelope")(function* (
      event: SettlementEvent,
    ) {
      if (
        event.type === "helper.run-completed" ||
        event.type === "helper.run-failed" ||
        event.type === "helper.run-interrupted"
      ) {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        const helperRun = (readModel.helperRuns ?? []).find(
          (candidate) => candidate.id === event.payload.helperRunId,
        );
        if (helperRun === undefined) return null;
        const project = readModel.projects.find(
          (candidate) => candidate.id === helperRun.projectId,
        );
        if (project === undefined) return null;
        const attachedTaskId =
          helperRun.attachment.kind === "task" ? helperRun.attachment.taskId : null;
        const task =
          attachedTaskId === null
            ? null
            : (readModel.tasks.find((candidate) => candidate.id === attachedTaskId) ?? null);
        const target = task === null ? "the project manager" : `task "${task.title}" (${task.id})`;
        const message =
          event.type === "helper.run-completed"
            ? [
                `Read-only helper ${helperRun.id} completed for ${target}.`,
                `Tier/backend: ${helperRun.tier} · ${helperRun.providerInstanceId} · ${helperRun.model}.`,
                "Bounded result:",
                boundUntrustedContent(scrubSecrets(event.payload.result)),
                task === null
                  ? "Use this result as context for the current PM request."
                  : "This result is also available automatically to the task's subsequent stage prompt.",
              ].join("\n")
            : event.type === "helper.run-failed"
              ? [
                  `Read-only helper ${helperRun.id} failed for ${target}.`,
                  `Failure: ${boundUntrustedContent(scrubSecrets(event.payload.message))}`,
                  "Diagnose the failure at the same capability tier; do not escalate merely because the provider or environment failed.",
                ].join("\n")
              : `Read-only helper ${helperRun.id} was interrupted for ${target}. Continue without polling it.`;
        return {
          event,
          project,
          task,
          kind: "stage" as const,
          settlementKey: helperSettlementKey(helperRun.id),
          message: withLastActionCursor(message, event),
        } satisfies SettlementEnvelope;
      }
      const resolved =
        event.type === "thread.activity-appended"
          ? yield* resolveStageThreadTaskProject(event.payload.threadId)
          : yield* resolveTaskProject(event.payload.taskId);
      if (resolved === null) {
        return null;
      }

      if (event.type === "thread.activity-appended") {
        const requestId = approvalRequestIdFromEvent(event);
        if (requestId === null) {
          return null;
        }
        const projected = yield* projectionPendingApprovalRepository.getByRequestId({
          requestId: ApprovalRequestId.make(requestId),
        });
        if (Option.isSome(projected) && projected.value.status !== "pending") {
          return null;
        }
        const payload = event.payload.activity.payload as Record<string, unknown>;
        const requestKind =
          typeof payload.requestKind === "string" ? payload.requestKind : "unknown";
        const detail = typeof payload.detail === "string" ? payload.detail : "No detail supplied.";
        const stageRole =
          (yield* projectionSnapshotQuery.getCommandReadModel()).stageHistory[
            event.payload.threadId
          ]?.role ?? "worker";
        const message = [
          `Worker permission request for task "${resolved.task.title}" (${resolved.task.id}).`,
          `Stage: ${stageRole} (${event.payload.threadId}).`,
          `Request: ${requestKind} (${requestId}).`,
          `Detail: ${boundUntrustedContent(scrubSecrets(detail))}`,
          "Inspect the task's pending approvals, decide using least privilege, and respond. Do not wait for the human unless this request exceeds or is ambiguous under the task's delegated authority.",
        ].join("\n");
        return {
          event,
          ...resolved,
          task: resolved.task,
          kind: "approval" as const,
          settlementKey: requestId,
          message: withLastActionCursor(message, event),
        } satisfies SettlementEnvelope;
      }

      if (event.type === "task.stage-completed") {
        const assistantText = yield* latestAssistantTextForStage(event);
        const diff = yield* resolveStageDiff(event);
        const stageResult: StageResult = buildStageResult({
          taskId: event.payload.taskId,
          taskTitle: resolved.task.title,
          role: event.payload.role,
          stageThreadId: event.payload.stageThreadId,
          awaitedTurnId: event.payload.awaitedTurnId,
          assistantText,
          diff,
        });
        const ownershipViolation =
          event.payload.ownershipViolationPaths === undefined ||
          event.payload.ownershipViolationPaths.length === 0
            ? ""
            : [
                "",
                "Stage ownership violation: this documentation-only stage changed substantive implementation paths, so its result was not accepted and verification was not recorded.",
                `Paths: ${event.payload.ownershipViolationPaths.join(", ")}`,
                "Return the implementation changes to a work stage. Do not land this task until a clean verifier has completed.",
              ].join("\n");
        return {
          event,
          ...resolved,
          task: resolved.task,
          kind: "stage" as const,
          settlementKey: makeStageSettlementKey({
            stageThreadId: event.payload.stageThreadId,
            awaitedTurnId: event.payload.awaitedTurnId,
          }),
          message: withLastActionCursor(
            `${serializeStageResultToMessage(stageResult)}${ownershipViolation}`,
            event,
          ),
        } satisfies SettlementEnvelope;
      }

      if (event.type === "task.change-review-requested") {
        const message = [
          `Work for task "${resolved.task.title}" (${resolved.task.id}) settled with tracked or untracked changes still present.`,
          `Work stage: ${event.payload.workStageThreadId}. Detected HEAD: ${event.payload.detectedHead}.`,
          "Review the task worktree changes before verification. Commit the intended changes, return the work to the worker, or discard only changes that are not part of the task. Verification is blocked until this review is resolved.",
        ].join("\n");
        return {
          event,
          ...resolved,
          task: resolved.task,
          kind: "stage" as const,
          settlementKey: changeReviewSettlementKey(event.payload.workStageThreadId),
          message: withLastActionCursor(message, event),
        } satisfies SettlementEnvelope;
      }

      if (event.type === "task.stage-blocked") {
        return {
          event,
          ...resolved,
          task: resolved.task,
          kind: "stage" as const,
          settlementKey: quotaBlockedStageSettlementKey(event.payload.stageThreadId),
          message: withLastActionCursor(
            quotaBlockedStageMessage({ event, task: resolved.task }),
            event,
          ),
        } satisfies SettlementEnvelope;
      }

      if (event.type === "task.stage-interrupted") {
        return {
          event,
          ...resolved,
          task: resolved.task,
          kind: "stage" as const,
          settlementKey: interruptedStageSettlementKey(event.payload.stageThreadId),
          message: withLastActionCursor(
            interruptedStageMessage({ event, task: resolved.task }),
            event,
          ),
        } satisfies SettlementEnvelope;
      }

      return {
        event,
        ...resolved,
        task: resolved.task,
        kind: "gate" as const,
        settlementKey: makeGateSettlementKey(event.payload.gateId),
        message: withLastActionCursor(gateResultMessage({ event, task: resolved.task }), event),
      } satisfies SettlementEnvelope;
    });

    const readSettlementEvents = Effect.fn("PmRuntime.readSettlementEvents")(function* () {
      const events: SettlementEvent[] = [];
      yield* Stream.runForEach(orchestrationEngine.readEvents(0), (event) =>
        Effect.sync(() => {
          if (isSettlementEvent(event)) {
            events.push(event);
          }
        }),
      );
      return events;
    });

    // Stop hammering a quota-blocked PM. When the project's PM provider instance
    // is quota-blocked we hold re-entry rather than prompting a dry PM: the
    // settlement is left un-consumed (live) or un-acted (redrive), so the
    // reconciliation sweep re-drives it through this same gate once the instance
    // recovers. A projection read error fails open (treat the PM as available) so
    // a transient DB hiccup can never wedge the project.
    const pmInstanceQuotaBlocked = Effect.fn("PmRuntime.pmInstanceQuotaBlocked")(function* (
      project: OrchestrationProject,
    ) {
      const config = resolveProjectConfig(project);
      if (config.pmModelSelection === null) {
        return false;
      }
      const providerInstanceId = config.pmModelSelection.instanceId;
      // Deliberately fail open on BOTH a typed read error and an unexpected
      // defect: a quota read must never wedge PM re-entry. Approved as the
      // explicit fallback for the PM quota gate; interrupts still propagate.
      const state = yield* providerQuotaStatusRepository
        .isInstanceQuotaBlocked({ providerInstanceId })
        .pipe(
          Effect.catch(() => Effect.succeed(defaultOkQuotaState(providerInstanceId))),
          Effect.catchDefect(() => Effect.succeed(defaultOkQuotaState(providerInstanceId))),
        );
      return state.blocked;
    });

    const projectContextHeld = Effect.fn("PmRuntime.projectContextHeld")(function* (
      projectId: OrchestrationProject["id"],
    ) {
      const lifecycle = yield* projectContextRuns.ensureBeforePmTurn(projectId).pipe(
        Effect.catch((error) =>
          Effect.logWarning("PM re-entry held because GED manifest inspection failed", {
            projectId: String(projectId),
            detail: error.message,
          }).pipe(Effect.as({ status: "maintenance-active" as const })),
        ),
      );
      if (lifecycle.status !== "ready") return true;
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      return readModel.projectContextRuns.some(
        (run) =>
          run.projectId === projectId &&
          (run.status === "pending" || run.status === "running" || run.status === "pending-review"),
      );
    });

    const redriveSettlementBypassingCursor = Effect.fn(
      "PmRuntime.redriveSettlementBypassingCursor",
    )(function* (input: {
      readonly marker: PmConsumedSettlement;
      readonly event: SettlementEvent;
    }) {
      const envelope = yield* makeSettlementEnvelope(input.event);
      if (envelope === null) {
        yield* Effect.logWarning(
          "PM runtime reconciliation skipped settlement without task/project",
          {
            projectId: String(input.marker.projectId),
            kind: input.marker.kind,
            settlementKey: input.marker.settlementKey,
          },
        );
        return false;
      }

      if (
        (yield* projectContextHeld(envelope.project.id)) ||
        (yield* pmInstanceQuotaBlocked(envelope.project))
      ) {
        yield* Effect.logInfo("PM re-entry redrive held: provider instance quota-blocked", {
          projectId: String(input.marker.projectId),
          kind: input.marker.kind,
          settlementKey: input.marker.settlementKey,
        });
        return false;
      }

      const projectRuntime = yield* projectRuntimeFactory.getOrCreate(envelope.project);
      yield* projectRuntime.enqueue(envelope.message).pipe(
        Effect.andThen(projectRuntime.drain),
        withMetrics({
          timer: orchestrationPmReEntryDuration,
          attributes: { kind: input.marker.kind, path: "pending" },
        }),
      );
      yield* pmRuntimeStateRepository.markActed({
        projectId: input.marker.projectId,
        kind: input.marker.kind,
        settlementKey: input.marker.settlementKey,
        actedAt: input.event.occurredAt,
      });
      return true;
    });

    const processSettlementEvent = Effect.fn("PmRuntime.processSettlementEvent")(function* (
      event: SettlementEvent,
    ) {
      const envelope = yield* makeSettlementEnvelope(event);
      if (envelope === null) {
        return;
      }

      const cursor = yield* pmRuntimeStateRepository.getCursor({
        projectId: envelope.project.id,
      });
      if (Option.isSome(cursor) && event.sequence <= cursor.value.lastConsumedSequence) {
        return;
      }

      // Hold re-entry while the PM provider instance is quota-blocked. Returning
      // before consuming leaves the settlement un-consumed, so the reconciliation
      // sweep (reconcileNeverConsumedSettlements) re-drives it once quota recovers
      // — exactly-once is preserved because nothing was consumed or acted here.
      if (
        (yield* projectContextHeld(envelope.project.id)) ||
        (yield* pmInstanceQuotaBlocked(envelope.project))
      ) {
        yield* Effect.logInfo("PM re-entry held: provider instance quota-blocked", {
          projectId: String(envelope.project.id),
          kind: envelope.kind,
          settlementKey: envelope.settlementKey,
        });
        return;
      }

      const projectRuntime = yield* projectRuntimeFactory.getOrCreate(envelope.project);

      // Durability ordering with two-phase settlement consumption (review M3).
      //
      // We commit the settlement marker + cursor (durable, status='pending')
      // BEFORE prompting the PM. Prompting is side-effecting: the PM turn
      // dispatches orchestrator commands through its tools. Consuming first
      // guarantees replay cannot double-dispatch a settlement after restart.
      // After the single-writer PmReEntryQueue drains successfully, `markActed`
      // flips the marker to status='acted'. A crash in the consume→prompt window
      // leaves a durable pending row; the reconciliation sweep below re-reads the
      // real SettlementEvent from the append-only log and re-drives it through
      // the same projectRuntime.enqueue/drain path, bypassing only the cursor
      // check that caused the original liveness gap.
      const firstConsumption = yield* pmRuntimeStateRepository.consumeSettlementAndAdvanceCursor({
        projectId: envelope.project.id,
        kind: envelope.kind,
        settlementKey: envelope.settlementKey,
        sequence: event.sequence,
        consumedAt: event.occurredAt,
      });
      if (!firstConsumption) {
        return;
      }

      yield* projectRuntime.enqueue(envelope.message).pipe(
        Effect.andThen(projectRuntime.drain),
        withMetrics({
          timer: orchestrationPmReEntryDuration,
          attributes: { kind: envelope.kind, path: "live" },
        }),
      );
      yield* pmRuntimeStateRepository.markActed({
        projectId: envelope.project.id,
        kind: envelope.kind,
        settlementKey: envelope.settlementKey,
        actedAt: event.occurredAt,
      });
    });

    const processSettlementEventSafely = (event: SettlementEvent) =>
      processSettlementEvent(event).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("PM runtime failed to process settlement event", {
            eventType: event.type,
            taskId:
              event.type === "thread.activity-appended" ||
              event.type === "helper.run-completed" ||
              event.type === "helper.run-failed" ||
              event.type === "helper.run-interrupted"
                ? undefined
                : String(event.payload.taskId),
            threadId:
              event.type === "thread.activity-appended"
                ? String(event.payload.threadId)
                : undefined,
            sequence: event.sequence,
            cause: Cause.pretty(cause),
          });
        }),
      );

    const worker = yield* makeDrainableWorker(processSettlementEventSafely);

    const collectUnsettledSettlementKeys = Effect.fn("PmRuntime.collectUnsettledSettlementKeys")(
      function* (input: {
        readonly readModel: OrchestrationReadModel;
        readonly project: OrchestrationProject;
      }) {
        const tasks = input.readModel.tasks.filter((task) => task.projectId === input.project.id);
        const taskIds = new Set(tasks.map((task) => String(task.id)));
        const stageRows = yield* Effect.forEach(
          tasks,
          (task) => projectionAwaitedStageRepository.listByTaskId({ taskId: task.id }),
          { concurrency: 1 },
        );
        const stageKeys = stageRows
          .flat()
          .filter((stage) => stage.status === "awaited")
          .map((stage) =>
            makeStageSettlementKey({
              stageThreadId: stage.stageThreadId,
              awaitedTurnId: stage.awaitedTurnId,
            }),
          );
        const gateKeys = (input.readModel.pendingGates ?? [])
          .filter((gate) => gate.status === "pending" && taskIds.has(String(gate.taskId)))
          .map((gate) => makeGateSettlementKey(gate.gateId));
        const quotaBlockedStageKeys = (input.readModel.quotaBlockedStages ?? [])
          .filter((stage) => stage.status === "blocked" && taskIds.has(String(stage.taskId)))
          .map((stage) => quotaBlockedStageSettlementKey(stage.stageThreadId));
        const interruptedStageKeys = Object.values(input.readModel.stageHistory)
          .filter((stage) => stage.status === "interrupted" && taskIds.has(String(stage.taskId)))
          .map((stage) => interruptedStageSettlementKey(stage.stageThreadId));
        const helperRunKeys = (input.readModel.helperRuns ?? [])
          .filter(
            (helperRun) =>
              helperRun.projectId === input.project.id &&
              (helperRun.status === "completed" ||
                helperRun.status === "failed" ||
                helperRun.status === "interrupted"),
          )
          .map((helperRun) => helperSettlementKey(helperRun.id));
        const approvalRows = yield* Effect.forEach(
          tasks.flatMap((task) => task.stageThreadIds),
          (threadId) => projectionPendingApprovalRepository.listByThreadId({ threadId }),
          { concurrency: 1 },
        );
        const approvalKeys = approvalRows
          .flat()
          .filter((approval) => approval.status === "pending")
          .map((approval) => String(approval.requestId));

        return {
          stageKeys: [
            ...stageKeys,
            ...quotaBlockedStageKeys,
            ...interruptedStageKeys,
            ...helperRunKeys,
          ],
          gateKeys,
          approvalKeys,
        };
      },
    );

    const reconcileNeverConsumedSettlements = Effect.fn(
      "PmRuntime.reconcileNeverConsumedSettlements",
    )(function* (input: {
      readonly readModel: OrchestrationReadModel;
      readonly project: OrchestrationProject;
      readonly events: ReadonlyArray<SettlementEvent>;
    }) {
      const keys = yield* collectUnsettledSettlementKeys({
        readModel: input.readModel,
        project: input.project,
      });
      const [consumedStages, consumedGates, consumedApprovals] = yield* Effect.all(
        [
          pmRuntimeStateRepository.listConsumedSettlements({
            projectId: input.project.id,
            kind: "stage",
          }),
          pmRuntimeStateRepository.listConsumedSettlements({
            projectId: input.project.id,
            kind: "gate",
          }),
          pmRuntimeStateRepository.listConsumedSettlements({
            projectId: input.project.id,
            kind: "approval",
          }),
        ],
        { concurrency: 1 },
      );
      const consumedStageKeys = new Set(
        consumedStages.map((settlement) => settlement.settlementKey),
      );
      const consumedGateKeys = new Set(consumedGates.map((settlement) => settlement.settlementKey));
      const consumedApprovalKeys = new Set(
        consumedApprovals.map((settlement) => settlement.settlementKey),
      );
      let reprocessedCount = 0;

      const processKey = (
        kind: PmConsumedSettlementKind,
        consumedKeys: ReadonlySet<string>,
        settlementKey: string,
      ) => {
        if (consumedKeys.has(settlementKey)) {
          return Effect.void;
        }
        const event = findSettlementEvent(input.events, { kind, settlementKey });
        if (event === undefined) {
          return Effect.logWarning("PM runtime reconciliation missing backing settlement event", {
            projectId: String(input.project.id),
            kind,
            settlementKey,
            path: "never-consumed",
          });
        }
        reprocessedCount += 1;
        return processSettlementEventSafely(event);
      };

      yield* Effect.forEach(keys.stageKeys, (key) => processKey("stage", consumedStageKeys, key), {
        concurrency: 1,
        discard: true,
      });
      yield* Effect.forEach(keys.gateKeys, (key) => processKey("gate", consumedGateKeys, key), {
        concurrency: 1,
        discard: true,
      });
      yield* Effect.forEach(
        keys.approvalKeys,
        (key) => processKey("approval", consumedApprovalKeys, key),
        { concurrency: 1, discard: true },
      );

      return reprocessedCount;
    });

    const reconcilePendingSettlements = Effect.fn("PmRuntime.reconcilePendingSettlements")(
      function* (input: {
        readonly project: OrchestrationProject;
        readonly events: ReadonlyArray<SettlementEvent>;
      }) {
        const pending = yield* pmRuntimeStateRepository.listPending({
          projectId: input.project.id,
        });
        let actedCount = 0;
        yield* Effect.forEach(
          pending,
          (marker) => {
            const event = findSettlementEvent(input.events, {
              kind: marker.kind,
              settlementKey: marker.settlementKey,
            });
            if (event === undefined) {
              return Effect.logWarning(
                "PM runtime reconciliation missing backing settlement event",
                {
                  projectId: String(input.project.id),
                  kind: marker.kind,
                  settlementKey: marker.settlementKey,
                  path: "pending",
                },
              );
            }
            return redriveSettlementBypassingCursor({ marker, event }).pipe(
              Effect.tap((redriven) =>
                Effect.sync(() => {
                  if (redriven) {
                    actedCount += 1;
                  }
                }),
              ),
              Effect.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) {
                  return Effect.failCause(cause);
                }
                return Effect.logWarning("PM runtime pending settlement recovery failed", {
                  projectId: String(input.project.id),
                  kind: marker.kind,
                  settlementKey: marker.settlementKey,
                  cause: Cause.pretty(cause),
                });
              }),
            );
          },
          { concurrency: 1, discard: true },
        );
        return actedCount;
      },
    );

    // WP-Q6 (auto-resume-at-reset): optimistically clear a `blocked-until`
    // instance once its parsed reset time has elapsed, so the existing resume +
    // worker-start admission paths re-drive its blocked stages instead of waiting
    // for fresh telemetry or an operator. Only `blocked-until` (a trustworthy
    // reset time) qualifies — `blocked-unknown` (e.g. a PM self-detected block
    // with no reset) is left for telemetry/operator. Optimistic and
    // self-correcting: if the quota is not actually replenished, the next turn
    // re-marks the instance blocked, bounded by `maxRetriesPerStage`.
    const reconcileResetElapsedInstances = Effect.fn("PmRuntime.reconcileResetElapsedInstances")(
      function* () {
        const elapsed = yield* recoverElapsedProviderQuotaBlocks({
          quota: providerQuotaStatusRepository,
        });
        if (elapsed.length === 0) {
          return 0;
        }
        yield* increment(orchestrationQuotaResetClearedTotal, {}, elapsed.length);
        yield* Effect.logInfo("quota reset elapsed; instances optimistically cleared to ok", {
          count: elapsed.length,
          providerInstanceIds: elapsed.map((row) => String(row.providerInstanceId)),
        });
        return elapsed.length;
      },
    );

    const reconcileQuotaBlockedStages = Effect.fn("PmRuntime.reconcileQuotaBlockedStages")(
      function* () {
        const blockedStages = yield* projectionQuotaBlockedStageRepository.listBlocked();
        // Sample the "currently parked" gauge every sweep (including 0) so it
        // tracks recovery back to zero, not just the blocked peaks.
        yield* setGauge(orchestrationQuotaBlockedStages, blockedStages.length);
        if (blockedStages.length === 0) {
          return 0;
        }

        const resumedAt = DateTime.formatIso(yield* DateTime.now);
        let resumedCount = 0;
        yield* Effect.forEach(
          blockedStages,
          (stage) =>
            Effect.gen(function* () {
              const quotaRow = yield* providerQuotaStatusRepository.getByProviderInstanceId({
                providerInstanceId: stage.providerInstanceId,
              });
              if (Option.isNone(quotaRow) || quotaRow.value.status !== "ok") {
                return;
              }
              const resumed = yield* resumeQuotaBlockedStageWithServices({
                stage,
                createdAt: resumedAt,
                orchestrationEngine,
                projectionSnapshotQuery,
              }).pipe(
                Effect.catchCause((cause) => {
                  if (Cause.hasInterruptsOnly(cause)) {
                    return Effect.failCause(cause);
                  }
                  return Effect.logWarning("quota blocked stage resume skipped during sweep", {
                    taskId: String(stage.taskId),
                    stageThreadId: String(stage.stageThreadId),
                    providerInstanceId: String(stage.providerInstanceId),
                    cause: Cause.pretty(cause),
                  }).pipe(Effect.as(false));
                }),
              );
              if (resumed) {
                resumedCount += 1;
                const blockedMs = Date.parse(resumedAt) - Date.parse(stage.blockedAt);
                if (Number.isFinite(blockedMs) && blockedMs >= 0) {
                  // A metric tap must never break the resume/sweep; swallow any
                  // recording error.
                  yield* recordDuration(
                    orchestrationQuotaBlockedDuration,
                    Duration.millis(blockedMs),
                  ).pipe(Effect.ignore);
                }
              }
            }),
          { concurrency: 1, discard: true },
        );
        return resumedCount;
      },
    );

    const runReconciliationSweep = reconciliationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        const events = yield* readSettlementEvents();
        let neverConsumedCount = 0;
        let pendingActedCount = 0;
        let quotaResumedCount = 0;
        let resetClearedCount = 0;

        yield* Effect.forEach(
          readModel.projects,
          (project) =>
            Effect.gen(function* () {
              neverConsumedCount += yield* reconcileNeverConsumedSettlements({
                readModel,
                project,
                events,
              });
              pendingActedCount += yield* reconcilePendingSettlements({
                project,
                events,
              });
            }),
          { concurrency: 1, discard: true },
        );

        // Clear instances whose reset elapsed first, so their stages resume in
        // this same sweep.
        resetClearedCount = yield* reconcileResetElapsedInstances();
        quotaResumedCount = yield* reconcileQuotaBlockedStages();

        // Sample the per-instance quota gauge every sweep and roll the resumed
        // stages into the WP-Q7 counter.
        const blockedInstances = yield* providerQuotaStatusRepository.listBlocked();
        yield* setGauge(orchestrationQuotaBlockedInstances, blockedInstances.length);
        if (quotaResumedCount > 0) {
          yield* increment(orchestrationQuotaStageResumedTotal, {}, quotaResumedCount);
        }

        const redrivenCount = neverConsumedCount + pendingActedCount + quotaResumedCount;
        if (redrivenCount > 0 || resetClearedCount > 0) {
          if (redrivenCount > 0) {
            yield* increment(
              orchestrationReconciliationSettlementsRedrivenTotal,
              {},
              redrivenCount,
            );
          }
          yield* Effect.logInfo("PM runtime reconciliation sweep completed", {
            neverConsumedCount,
            pendingActedCount,
            quotaResumedCount,
            resetClearedCount,
            projectCount: readModel.projects.length,
          });
        }
      }).pipe(
        withMetrics({
          counter: orchestrationReconciliationSweepsTotal,
          timer: orchestrationReconciliationSweepDuration,
        }),
      ),
    );

    const getReplayStartSequence = Effect.fn("PmRuntime.getReplayStartSequence")(function* () {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      if (readModel.projects.length === 0) {
        return 0;
      }

      const cursors = yield* Effect.forEach(
        readModel.projects,
        (project) => pmRuntimeStateRepository.getCursor({ projectId: project.id }),
        { concurrency: 1 },
      );
      const startSequences = cursors.map((cursor) =>
        Option.isSome(cursor) ? cursor.value.lastConsumedSequence : 0,
      );
      return Math.min(...startSequences);
    });

    const replayHistoricalSettlements = Effect.gen(function* () {
      const fromSequenceExclusive = yield* getReplayStartSequence();
      yield* Stream.runForEach(orchestrationEngine.readEvents(fromSequenceExclusive), (event) =>
        isSettlementEvent(event) ? processSettlementEventSafely(event) : Effect.void,
      );
    }).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.void;
        }
        return Effect.logWarning("PM runtime historical replay failed", {
          cause: Cause.pretty(cause),
        });
      }),
    );

    const start: PmRuntimeShape["start"] = Effect.fn("start")(function* () {
      const liveSettlementQueue = yield* Queue.unbounded<SettlementEvent>();
      yield* Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        isSettlementEvent(event)
          ? Queue.offer(liveSettlementQueue, event).pipe(Effect.asVoid)
          : Effect.void,
      ).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("PM runtime live subscription failed", {
            cause: Cause.pretty(cause),
          });
        }),
        Effect.forkScoped,
      );

      yield* replayHistoricalSettlements;
      const bufferedLiveSettlements: SettlementEvent[] = [];
      let nextBufferedSettlement = yield* Queue.poll(liveSettlementQueue);
      while (Option.isSome(nextBufferedSettlement)) {
        bufferedLiveSettlements.push(nextBufferedSettlement.value);
        nextBufferedSettlement = yield* Queue.poll(liveSettlementQueue);
      }
      yield* Effect.forEach(bufferedLiveSettlements, worker.enqueue, { concurrency: 1 });
      yield* worker.drain;
      yield* Effect.forkScoped(
        runReconciliationSweep.pipe(
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.void;
            }
            return Effect.logWarning("PM runtime reconciliation sweep failed", {
              cause: Cause.pretty(cause),
            });
          }),
          Effect.catchDefect((defect) =>
            Effect.logWarning("PM runtime reconciliation sweep defect", { defect }),
          ),
          Effect.repeat(Schedule.spaced(Duration.millis(reconciliationIntervalMs))),
        ),
      );
      yield* Queue.take(liveSettlementQueue).pipe(
        Effect.flatMap(worker.enqueue),
        Effect.forever,
        Effect.forkScoped,
      );
    });

    return {
      start,
      drain: worker.drain,
    } satisfies PmRuntimeShape;
  });

export const makePmRuntimeLive = (options?: PmRuntimeLiveOptions) =>
  Layer.effect(PmRuntime, makePmRuntime(options));

export const PmRuntimeLive = makePmRuntimeLive();

export const makePmProjectRuntimeFactoryWithOptions = (options?: PmProjectRuntimeFactoryOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const providerQuotaStatusRepository = yield* ProviderQuotaStatusRepository;
    const serverSettings = yield* ServerSettingsService;
    const providerAdapterRegistry = yield* ProviderAdapterRegistry;
    const providerService = yield* ProviderService;
    const providerSessionDirectory = yield* ProviderSessionDirectory;
    const runtimeScope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.void));
    const runtimes = new Map<string, RuntimeCacheEntry>();

    const getOrCreate: PmProjectRuntimeFactoryShape["getOrCreate"] = (project) =>
      Effect.gen(function* () {
        const key = String(project.id);
        const existing = runtimes.get(key);
        if (existing !== undefined) {
          return existing.runtime;
        }

        const harnessConfig = yield* resolvePmHarnessConfig(project, {
          serverSettings,
          providerAdapterRegistry,
        });
        const pmModelSelection = harnessConfig.selection;
        const providerAdapter = yield* resolveDriverPmAdapter(
          harnessConfig,
          providerAdapterRegistry,
        );
        const resources = resolvePmHarnessResources(defaultTaskTypeRegistry.ids());
        const pmThreadId = pmThreadIdForProject(project);
        const pendingPmThread = yield* projectionSnapshotQuery
          .getThreadDetailById(pmThreadId)
          .pipe(
            Effect.map(Option.getOrNull),
            Effect.mapError(
              toPmRuntimeError(
                "PmProjectRuntimeFactory.getOrCreate.pendingPmHandoff",
                "Failed to load pending PM handoff state.",
              ),
            ),
          );
        const pendingPmHandoff = pendingPmThread?.pendingPmHandoff ?? null;
        const handoffContext =
          pendingPmThread !== null && pendingPmHandoff !== null
            ? pendingPmHandoff.mode === "summary"
              ? wrapSummaryHandoffContext(pendingPmHandoff.brief ?? "")
              : buildPmHandoffTranscript(
                  pendingPmThread,
                  DEFAULT_PM_HANDOFF_TRANSCRIPT_BUDGET_CHARS,
                )
            : null;
        const systemPrompt =
          handoffContext === null
            ? buildPmSystemPrompt(project, harnessConfig.provider)
            : appendPmHandoffContext(
                buildPmSystemPrompt(project, harnessConfig.provider),
                handoffContext,
              );
        const driverPmAdapterOptions = {
          project,
          driverKind: harnessConfig.provider,
          providerAdapter,
          runtimeEvents: providerService.streamEvents,
          modelSelection: pmModelSelection,
          systemPrompt,
        } satisfies DriverPmAdapterOptions;
        const adapter =
          options?.makeDriverPmAdapterOverride !== undefined
            ? yield* options.makeDriverPmAdapterOverride(driverPmAdapterOptions)
            : yield* makeDriverPmAdapter(driverPmAdapterOptions).pipe(
                Effect.provideService(ProviderSessionDirectory, providerSessionDirectory),
              );
        if (resources !== undefined) {
          yield* adapter.setResources(resources);
        }
        const projectRuntimeScope = yield* Scope.make("sequential");
        yield* Scope.addFinalizer(
          runtimeScope,
          Scope.close(projectRuntimeScope, Exit.void).pipe(Effect.ignore),
        );
        const eventProjection = yield* makePmEventProjectionRuntime({
          project,
          pmModelSelection,
          providerName: harnessConfig.provider,
          events: adapter.events,
        }).pipe(
          Effect.provideService(OrchestrationEngineService, orchestrationEngine),
          Effect.provideService(ProjectionSnapshotQuery, projectionSnapshotQuery),
          Scope.provide(projectRuntimeScope),
          Effect.provide(NodeServices.layer),
        );
        const pmProviderInstanceId = harnessConfig.providerInstanceId;
        const queue = yield* makePmReEntryQueue(adapter, {
          canDrain: projectionSnapshotQuery.getCommandReadModel().pipe(
            Effect.map(
              (readModel) =>
                !readModel.projectContextRuns.some(
                  (run) =>
                    run.projectId === project.id &&
                    (run.status === "pending" ||
                      run.status === "running" ||
                      run.status === "pending-review"),
                ),
            ),
            Effect.catch(() => Effect.succeed(false)),
          ),
          // Detect PM-instance quota exhaustion from the PM's own failed turn. The
          // adapter failure surfaces as a PmRuntimeError (not a `runtime.error`
          // provider event), so it bypasses the ingestion-path detection that marks
          // worker instances blocked. Classify it here and mark the PM instance
          // blocked so the re-entry gate holds subsequent turns.
          onTurnError: (error) =>
            Effect.gen(function* () {
              const updatedAt = DateTime.formatIso(yield* DateTime.now);
              const failure = formatPmTurnFailure(error);
              yield* eventProjection
                .dispatchActivity({
                  id: pmTurnFailedActivityId(project.id, failure.summary),
                  tone: "error",
                  kind: "pm.turn.failed",
                  summary: failure.summary,
                  payload: {
                    itemType: "error",
                    category: failure.category,
                    reason: failure.reason,
                    operation: error.operation,
                    providerInstanceId: pmProviderInstanceId,
                  },
                  turnId: null,
                  createdAt: updatedAt,
                })
                .pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("failed to append PM turn-failed activity", {
                      projectId: String(project.id),
                      providerInstanceId: String(pmProviderInstanceId),
                      cause: Cause.pretty(cause),
                    }),
                  ),
                );
              if (failure.category !== "rate_limit") {
                return;
              }
              yield* providerQuotaStatusRepository
                .markBlocked({ providerInstanceId: pmProviderInstanceId, resetAt: null, updatedAt })
                .pipe(Effect.ignore);
              // Surface the pause in the PM conversation timeline (WP-Q7 option A):
              // PmConversation renders thread activities, so this calm info-tone
              // marker shows live as "Paused — <backend> usage limit reached".
              // Best-effort — a failed marker must never mask the original turn error.
              yield* orchestrationEngine
                .dispatch({
                  type: "thread.activity.append",
                  commandId: pmQuotaPausedActivityCommandId(pmThreadId, updatedAt),
                  threadId: pmThreadId,
                  activity: {
                    id: pmQuotaPausedActivityId(pmThreadId, updatedAt),
                    tone: "info",
                    kind: "quota.paused",
                    summary: `Paused — ${pmProviderInstanceId} usage limit reached`,
                    payload: { providerInstanceId: pmProviderInstanceId, resetAt: null },
                    turnId: null,
                    createdAt: updatedAt,
                  },
                  createdAt: updatedAt,
                })
                .pipe(
                  Effect.catch((activityError) =>
                    Effect.logWarning("failed to append PM quota-paused activity", {
                      projectId: String(project.id),
                      error: activityError,
                    }),
                  ),
                );
              yield* Effect.logWarning(
                "PM provider instance marked quota-blocked after failed turn",
                {
                  projectId: String(project.id),
                  providerInstanceId: String(pmProviderInstanceId),
                },
              );
            }),
        });
        const currentHarnessConfig = yield* Ref.make(harnessConfig);
        const runtimeActive = yield* Ref.make(true);

        const interruptActive = Effect.gen(function* () {
          if (!(yield* Ref.get(runtimeActive))) return;
          yield* Ref.set(runtimeActive, false);
          yield* adapter.abort;
          yield* Scope.close(projectRuntimeScope, Exit.void);
          runtimes.delete(key);
          yield* Effect.logInfo("PM runtime interrupted for project-context handoff", {
            projectId: String(project.id),
          });
        });

        const invalidateRuntime = (reason: string) =>
          queue.runExclusive(
            Effect.gen(function* () {
              if (!(yield* Ref.get(runtimeActive))) return;
              yield* adapter.waitForIdle;
              yield* Ref.set(runtimeActive, false);
              yield* Scope.close(projectRuntimeScope, Exit.void);
              runtimes.delete(key);
              yield* Effect.logInfo("PM runtime cache entry invalidated", {
                projectId: String(project.id),
                reason,
              });
            }),
          );
        const waitForIdle = queue.runExclusive(adapter.waitForIdle);

        if (pendingPmHandoff !== null) {
          yield* adapter.start;
          const completedAt = DateTime.formatIso(yield* DateTime.now);
          yield* orchestrationEngine
            .dispatch({
              type: "thread.pm-handoff.complete",
              commandId: pmHandoffCompletedCommandId(pmThreadId, completedAt),
              threadId: pmThreadId,
              mode: pendingPmHandoff.mode,
              createdAt: completedAt,
            })
            .pipe(
              Effect.mapError(
                toPmRuntimeError(
                  "PmProjectRuntimeFactory.completePmHandoff",
                  "Failed to complete pending PM handoff.",
                ),
              ),
            );
          yield* orchestrationEngine
            .dispatch({
              type: "thread.activity.append",
              commandId: pmHandoffActivityCommandId(pmThreadId, completedAt),
              threadId: pmThreadId,
              activity: {
                id: pmHandoffActivityId(pmThreadId, completedAt),
                tone: "info",
                kind: "pm.handoff",
                summary: `PM handed off (${pendingPmHandoff.mode})`,
                payload: {
                  mode: pendingPmHandoff.mode,
                  providerInstanceId: pmProviderInstanceId,
                },
                turnId: null,
                createdAt: completedAt,
              },
              createdAt: completedAt,
            })
            .pipe(
              Effect.mapError(
                toPmRuntimeError(
                  "PmProjectRuntimeFactory.appendPmHandoffMarker",
                  "Failed to append PM handoff activity.",
                ),
              ),
            );
        }

        const applyUpdatedPmHarnessConfig = (updatedProject: OrchestrationProject) =>
          Effect.gen(function* () {
            const active = yield* Ref.get(runtimeActive);
            if (!active) return;

            const nextHarnessConfig = yield* resolvePmHarnessConfig(updatedProject, {
              serverSettings,
              providerAdapterRegistry,
            }).pipe(Effect.catch((error) => invalidateRuntime(error.detail).pipe(Effect.as(null))));
            if (nextHarnessConfig === null) {
              return;
            }

            const current = yield* Ref.get(currentHarnessConfig);
            if (
              samePmModelSelection(current.selection, nextHarnessConfig.selection) &&
              canApplyPmModelInPlace(current, nextHarnessConfig)
            ) {
              return;
            }

            if (!canApplyPmModelInPlace(current, nextHarnessConfig)) {
              yield* invalidateRuntime("PM provider instance changed");
              return;
            }

            yield* queue.runExclusive(
              Effect.gen(function* () {
                if (!(yield* Ref.get(runtimeActive))) return;
                const latest = yield* Ref.get(currentHarnessConfig);
                if (samePmModelSelection(latest.selection, nextHarnessConfig.selection)) return;

                yield* adapter.waitForIdle;
                yield* adapter.setModel(
                  pmAdapterModelDescriptor(nextHarnessConfig.selection, nextHarnessConfig.provider),
                );
                yield* Ref.set(currentHarnessConfig, nextHarnessConfig);
                yield* Effect.logInfo("PM model changed in place", {
                  projectId: String(project.id),
                  providerInstanceId: nextHarnessConfig.providerInstanceId,
                  previousModel: latest.selection.model,
                  nextModel: nextHarnessConfig.selection.model,
                });
              }),
            );
          });

        const watchPmConfigChanges = orchestrationEngine.streamDomainEvents.pipe(
          Stream.runForEach((event) => {
            if (
              event.type !== "project.meta-updated" ||
              event.payload.projectId !== project.id ||
              event.payload.orchestratorConfig === undefined
            ) {
              return Effect.void;
            }

            return applyUpdatedPmHarnessConfig({
              ...project,
              orchestratorConfig: event.payload.orchestratorConfig,
              updatedAt: event.payload.updatedAt,
            }).pipe(
              Effect.catchCause((cause) => {
                if (Cause.hasInterruptsOnly(cause)) {
                  return Effect.failCause(cause);
                }
                return Effect.logWarning("PM runtime config update failed", {
                  projectId: String(project.id),
                  sequence: event.sequence,
                  cause: Cause.pretty(cause),
                });
              }),
            );
          }),
          Effect.catchCause((cause) => {
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.void;
            }
            return Effect.logWarning("PM runtime config watcher failed", {
              projectId: String(project.id),
              cause: Cause.pretty(cause),
            });
          }),
          Effect.forkIn(projectRuntimeScope),
        );
        yield* watchPmConfigChanges;
        const watchProjectContextSettlement = orchestrationEngine.streamDomainEvents.pipe(
          Stream.runForEach((event) => {
            if (
              event.type !== "project.context-run-committed" &&
              event.type !== "project.context-run-applied" &&
              event.type !== "project.context-run-discarded" &&
              event.type !== "project.context-run-failed" &&
              event.type !== "project.context-run-interrupted"
            ) {
              return Effect.void;
            }
            return projectionSnapshotQuery.getCommandReadModel().pipe(
              Effect.flatMap((readModel) => {
                const run = readModel.projectContextRuns.find(
                  (candidate) => candidate.id === event.payload.projectContextRunId,
                );
                return run?.projectId === project.id ? queue.drain : Effect.void;
              }),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.void
                  : Effect.logWarning("failed to release PM queue after context settlement", {
                      projectId: String(project.id),
                      cause: Cause.pretty(cause),
                    }),
              ),
            );
          }),
          Effect.forkIn(projectRuntimeScope),
        );
        yield* watchProjectContextSettlement;
        const ensureRuntimeActive = Effect.gen(function* () {
          if (yield* Ref.get(runtimeActive)) return;
          return yield* new PmRuntimeError({
            operation: "PmProjectRuntime.drain",
            detail: `PM runtime for project '${project.id}' was invalidated and must be rebuilt.`,
          });
        });
        const runtime: PmProjectRuntime = {
          surfaceUserMessage: (message) =>
            ensureRuntimeActive.pipe(
              Effect.andThen(
                eventProjection
                  .dispatchUserMessage(message)
                  .pipe(
                    Effect.mapError(
                      toPmRuntimeError(
                        "PmProjectRuntime.surfaceUserMessage",
                        "Failed to surface PM user message.",
                      ),
                    ),
                  ),
              ),
            ),
          createHandoffBrief: ensureRuntimeActive.pipe(
            Effect.flatMap(() =>
              queue.runExclusive(
                adapter.prompt(PM_HANDOFF_BRIEF_PROMPT).pipe(
                  Effect.map(textContent),
                  Effect.flatMap((brief) =>
                    brief.length > 0
                      ? Effect.succeed(brief)
                      : Effect.fail(
                          new PmRuntimeError({
                            operation: "PmProjectRuntime.createHandoffBrief",
                            detail: "PM returned an empty handoff brief.",
                          }),
                        ),
                  ),
                  Effect.timeout(PM_HANDOFF_BRIEF_TIMEOUT),
                  Effect.mapError(
                    toPmRuntimeError(
                      "PmProjectRuntime.createHandoffBrief",
                      "Failed to create PM handoff brief.",
                    ),
                  ),
                ),
              ),
            ),
          ),
          enqueue: (message) => ensureRuntimeActive.pipe(Effect.andThen(queue.enqueue(message))),
          drain: ensureRuntimeActive.pipe(
            Effect.andThen(queue.drain),
            Effect.andThen(eventProjection.drain),
          ),
        };
        runtimes.set(key, {
          runtime,
          waitForIdle,
          interruptActive,
          invalidateRuntime,
        });
        return runtime;
      });

    const waitForIdle: PmProjectRuntimeFactoryShape["waitForIdle"] = (projectId) => {
      const existing = runtimes.get(String(projectId));
      return existing?.waitForIdle ?? Effect.void;
    };

    const interruptActive: PmProjectRuntimeFactoryShape["interruptActive"] = (projectId) => {
      const existing = runtimes.get(String(projectId));
      return existing?.interruptActive ?? Effect.void;
    };

    const invalidateRuntimeByProjectId: PmProjectRuntimeFactoryShape["invalidateRuntime"] = (
      projectId,
      reason,
    ) => {
      const existing = runtimes.get(String(projectId));
      return existing?.invalidateRuntime(reason) ?? Effect.void;
    };

    const resetConfiguredDriverPmSession = (project: OrchestrationProject) =>
      Effect.gen(function* () {
        const harnessConfig = yield* resolvePmHarnessConfig(project, {
          serverSettings,
          providerAdapterRegistry,
        }).pipe(Effect.catch(() => Effect.succeed(null)));
        if (harnessConfig === null || !isSupportedPmDriver(harnessConfig.provider)) {
          return;
        }
        yield* resetDriverPmSession({
          project,
          driverKind: harnessConfig.provider,
          providerAdapterRegistry,
          providerSessionDirectory,
        });
      });

    const clearSessionStorage: PmProjectRuntimeFactoryShape["clearSessionStorage"] = (project) =>
      Effect.gen(function* () {
        yield* clearSqliteSessionStorage({ sessionId: `pm:${project.id}` }).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.mapError(
            toPmRuntimeError(
              "PmProjectRuntimeFactory.clearSessionStorage",
              "Failed to clear PM session storage.",
            ),
          ),
        );
        yield* resetConfiguredDriverPmSession(project);
      });

    const resetSessionBinding: PmProjectRuntimeFactoryShape["resetSessionBinding"] = (project) =>
      resetConfiguredDriverPmSession(project);

    const createHandoffBrief: PmProjectRuntimeFactoryShape["createHandoffBrief"] = (projectId) => {
      const existing = runtimes.get(String(projectId));
      return existing === undefined
        ? Effect.succeed(Option.none())
        : existing.runtime.createHandoffBrief.pipe(Effect.map(Option.some));
    };

    return {
      getOrCreate,
      waitForIdle,
      interruptActive,
      invalidateRuntime: invalidateRuntimeByProjectId,
      clearSessionStorage,
      resetSessionBinding,
      createHandoffBrief,
    } satisfies PmProjectRuntimeFactoryShape;
  });

export const makePmProjectRuntimeFactory = makePmProjectRuntimeFactoryWithOptions();

export const PmProjectRuntimeFactoryLive = Layer.effect(
  PmProjectRuntimeFactory,
  makePmProjectRuntimeFactory,
);
