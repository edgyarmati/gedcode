import {
  EventId,
  OrchestratorProjectConfig,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import { resolveAutoCompaction } from "@t3tools/shared/orchestrator";
import type { AgentHarnessResources } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
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
import type { ClaudeAdapterShape } from "../../provider/Services/ClaudeAdapter.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../../provider/Services/ProviderAdapterRegistry.ts";
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
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { PmRuntimeError, toPmRuntimeError } from "../pi/Errors.ts";
import { classifyRuntimeErrorClass } from "../../provider/rateLimits.ts";
import type { PiAgentAdapterShape } from "../pi/PiAgentAdapter.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "../pi/PmEventProjection.ts";
import { pmQuotaPausedActivityCommandId, pmQuotaPausedActivityId } from "../stageResolution.ts";
import { makePmReEntryQueue, PM_COMPACTION_TIMEOUT } from "../pi/PmReEntryQueue.ts";
import { clearSqliteSessionStorage } from "../pi/SqliteSessionStorage.ts";
import { makeDriverPmAdapter, type DriverPmAdapterOptions } from "../claude/DriverPmAdapter.ts";
import { CLAUDE_PM_DRIVER } from "../claude/constants.ts";
import { makeOrchestrationMcpServer } from "../claude/pmMcpServer.ts";
import { OrchestrationMcpServerProvider } from "../claude/OrchestrationMcpServerProvider.ts";
import { resumeQuotaBlockedStageWithServices } from "../quotaStageResumption.ts";
import {
  buildStageResult,
  serializeStageResultToMessage,
  type StageResult,
} from "../StageResultBuilder.ts";
import { boundUntrustedContent, scrubSecrets } from "../untrustedContent.ts";

type SettlementEvent = Extract<
  OrchestrationEvent,
  { type: "task.stage-completed" | "task.stage-blocked" | "task.gate-resolved" }
>;

type SettlementEnvelope = {
  readonly event: SettlementEvent;
  readonly project: OrchestrationProject;
  readonly task: OrchestrationTask;
  readonly kind: "stage" | "gate";
  readonly settlementKey: string;
  readonly message: string;
};

type RuntimeCacheEntry = {
  readonly runtime: PmProjectRuntime;
  readonly waitForIdle: Effect.Effect<void, PmRuntimeError>;
  readonly invalidateRuntime: (reason: string) => Effect.Effect<void, PmRuntimeError>;
};

export interface PmRuntimeLiveOptions {
  readonly reconciliationIntervalMsOverride?: number;
}

export interface PmProjectRuntimeFactoryOptions {
  readonly makeDriverPmAdapterOverride?: (
    options: DriverPmAdapterOptions,
  ) => Effect.Effect<PiAgentAdapterShape, never, never>;
}

const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);
const PM_SYSTEM_PROMPT = [
  "You are the orchestrator project manager (PM). You DELEGATE work; you never do it yourself.",
  "You are intentionally READ-ONLY: you can read and search files for lightweight context to write good task specs, but you have NO shell, NO network, and cannot edit files. This is by design — never apologize for it, never try to work around it, and never present it as a limitation.",
  "The workers you hand off to have FULL tool access — shell, network, editing files, running commands (e.g. `bun outdated`, tests, builds, installs). ANY request that needs running a command, inspecting live/build state, installing, editing, or producing changes MUST be performed by a worker, never by you.",
  "Never answer such a request from your own read-only view, and never ask the human to run commands or paste output back to you. Instead, turn the request into a task and hand it to a worker.",
  "Operate by driving the stage roles through your tools: classify assigns type/playbook, plan designs the implementation, review critiques the plan before work, work implements, and verify validates completed work before landing.",
  "Use your tools to create tasks, hand off stages, inspect ledgers, and request human approval gates; do not claim a stage is done until the relevant worker settlement is present.",
  "When the human asks for something, your job is to turn it into a task and drive it through these stages — not to produce the answer yourself.",
].join("\n");

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
export const buildPmSystemPrompt = (project: {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
}): string =>
  [
    `You are scoped to project "${project.title}" (project id: ${project.id}), workspace root ${project.workspaceRoot}.`,
    `Operate on THIS project only — never ask the human for a project id or repo id; when a tool needs a projectId, use ${project.id}. Create tasks and hand off stages for this project directly.`,
    PM_SYSTEM_PROMPT,
  ].join("\n");

const isSettlementEvent = (event: OrchestrationEvent): event is SettlementEvent =>
  event.type === "task.stage-completed" ||
  event.type === "task.stage-blocked" ||
  event.type === "task.gate-resolved";

const settlementEventKind = (event: SettlementEvent): PmConsumedSettlementKind =>
  event.type === "task.gate-resolved" ? "gate" : "stage";

const quotaBlockedStageSettlementKey = (stageThreadId: ThreadId): string =>
  `${stageThreadId}::quota-blocked`;

const settlementEventKey = (event: SettlementEvent): string =>
  event.type === "task.stage-completed"
    ? makeStageSettlementKey({
        stageThreadId: event.payload.stageThreadId,
        awaitedTurnId: event.payload.awaitedTurnId,
      })
    : event.type === "task.stage-blocked"
      ? quotaBlockedStageSettlementKey(event.payload.stageThreadId)
      : makeGateSettlementKey(event.payload.gateId);

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
  decodeOrchestratorConfig(project.orchestratorConfig ?? {});

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

type ResolvedPmHarnessConfig = {
  readonly selection: ModelSelection;
  readonly providerInstanceId: ProviderInstanceId;
  readonly provider: ProviderDriverKind;
};

const resetClaudePmSession = (input: {
  readonly project: OrchestrationProject;
  readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  readonly providerSessionDirectory: ProviderSessionDirectoryShape;
}): Effect.Effect<void, PmRuntimeError> =>
  Effect.gen(function* () {
    const pmThreadId = pmThreadIdForProject(input.project);
    const binding = yield* input.providerSessionDirectory
      .getBinding(pmThreadId)
      .pipe(
        Effect.map(Option.getOrUndefined),
        Effect.mapError(
          toPmRuntimeError(
            "PmProjectRuntimeFactory.resetClaudePmSession",
            "Failed to read PM provider session binding.",
          ),
        ),
      );

    if (binding?.provider !== CLAUDE_PM_DRIVER || binding.providerInstanceId === undefined) {
      return;
    }

    const claudeAdapter = yield* input.providerAdapterRegistry
      .getByInstance(binding.providerInstanceId)
      .pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.map((adapter) =>
          adapter !== undefined && adapter.provider === CLAUDE_PM_DRIVER ? adapter : undefined,
        ),
      );

    if (claudeAdapter !== undefined) {
      yield* claudeAdapter.stopSession(pmThreadId).pipe(Effect.catchCause(() => Effect.void));
    }

    yield* input.providerSessionDirectory
      .upsert({
        threadId: pmThreadId,
        provider: CLAUDE_PM_DRIVER,
        providerInstanceId: binding.providerInstanceId,
        status: "stopped",
        resumeCursor: null,
      })
      .pipe(
        Effect.mapError(
          toPmRuntimeError(
            "PmProjectRuntimeFactory.resetClaudePmSession",
            "Failed to reset PM Claude resume cursor.",
          ),
        ),
      );
  });
const DEFAULT_CLAUDE_PM_CONTEXT_WINDOW = 200_000;
const EXTENDED_CLAUDE_PM_CONTEXT_WINDOW = 1_000_000;

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

const pmAdapterModelDescriptor = (selection: ModelSelection): Model<any> =>
  ({
    id: selection.model,
    name: selection.model,
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: resolveClaudePmContextWindow(selection),
    maxTokens: 0,
  }) satisfies Model<any>;

const resolvePmHarnessConfig = (
  project: OrchestrationProject,
  services: {
    readonly serverSettings: ServerSettingsShape;
    readonly providerAdapterRegistry: ProviderAdapterRegistryShape;
  },
): Effect.Effect<ResolvedPmHarnessConfig, PmRuntimeError> =>
  Effect.gen(function* () {
    const config = resolveProjectConfig(project);
    if (Option.isNone(config) || config.value.enabled !== true) {
      return yield* makeNoPmRuntimeError(
        `Orchestrator mode is not enabled for project '${project.id}'.`,
      );
    }
    const settings = yield* services.serverSettings.getSettings.pipe(
      Effect.mapError((cause) =>
        makeNoPmRuntimeError("Failed to read server settings for PM model selection.", cause),
      ),
    );
    const pmModelSelection =
      config.value.pmModelSelection ?? settings.orchestratorDefaults.pmModelSelection ?? null;
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

const resolveClaudePmAdapter = (
  config: ResolvedPmHarnessConfig,
  providerAdapterRegistry: ProviderAdapterRegistryShape,
): Effect.Effect<ClaudeAdapterShape, PmRuntimeError> =>
  Effect.gen(function* () {
    if (config.provider !== CLAUDE_PM_DRIVER) {
      return yield* makeNoPmRuntimeError(
        `The orchestrator PM currently requires a Claude provider instance; Codex support is coming. Provider instance '${config.providerInstanceId}' uses '${config.provider}'.`,
      );
    }

    const adapter = yield* providerAdapterRegistry
      .getByInstance(config.providerInstanceId)
      .pipe(
        Effect.mapError((cause) =>
          makeNoPmRuntimeError(
            `Failed to resolve Claude adapter for PM provider instance '${config.providerInstanceId}'.`,
            cause,
          ),
        ),
      );
    if (adapter.provider !== CLAUDE_PM_DRIVER) {
      return yield* makeNoPmRuntimeError(
        `The orchestrator PM currently requires a Claude provider instance; Codex support is coming. Provider instance '${config.providerInstanceId}' resolved adapter '${adapter.provider}'.`,
      );
    }
    return adapter as ClaudeAdapterShape;
  });

export const makePmRuntime = (options?: PmRuntimeLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationMcpServerProvider = yield* OrchestrationMcpServerProvider;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const projectionAwaitedStageRepository = yield* ProjectionAwaitedStageRepository;
    const projectionQuotaBlockedStageRepository = yield* ProjectionQuotaBlockedStageRepository;
    const providerQuotaStatusRepository = yield* ProviderQuotaStatusRepository;
    const pmRuntimeStateRepository = yield* PmRuntimeStateRepository;
    const projectRuntimeFactory = yield* PmProjectRuntimeFactory;
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
      const resolved = yield* resolveTaskProject(event.payload.taskId);
      if (resolved === null) {
        return null;
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
        return {
          event,
          ...resolved,
          kind: "stage" as const,
          settlementKey: makeStageSettlementKey({
            stageThreadId: event.payload.stageThreadId,
            awaitedTurnId: event.payload.awaitedTurnId,
          }),
          message: serializeStageResultToMessage(stageResult),
        } satisfies SettlementEnvelope;
      }

      if (event.type === "task.stage-blocked") {
        return {
          event,
          ...resolved,
          kind: "stage" as const,
          settlementKey: quotaBlockedStageSettlementKey(event.payload.stageThreadId),
          message: quotaBlockedStageMessage({ event, task: resolved.task }),
        } satisfies SettlementEnvelope;
      }

      return {
        event,
        ...resolved,
        kind: "gate" as const,
        settlementKey: makeGateSettlementKey(event.payload.gateId),
        message: gateResultMessage({ event, task: resolved.task }),
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
      if (
        Option.isNone(config) ||
        config.value.enabled !== true ||
        config.value.pmModelSelection === null
      ) {
        return false;
      }
      const providerInstanceId = config.value.pmModelSelection.instanceId;
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

      if (yield* pmInstanceQuotaBlocked(envelope.project)) {
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
      if (yield* pmInstanceQuotaBlocked(envelope.project)) {
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
            taskId: String(event.payload.taskId),
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

        return {
          stageKeys: [...stageKeys, ...quotaBlockedStageKeys],
          gateKeys,
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
      const [consumedStages, consumedGates] = yield* Effect.all(
        [
          pmRuntimeStateRepository.listConsumedSettlements({
            projectId: input.project.id,
            kind: "stage",
          }),
          pmRuntimeStateRepository.listConsumedSettlements({
            projectId: input.project.id,
            kind: "gate",
          }),
        ],
        { concurrency: 1 },
      );
      const consumedStageKeys = new Set(
        consumedStages.map((settlement) => settlement.settlementKey),
      );
      const consumedGateKeys = new Set(consumedGates.map((settlement) => settlement.settlementKey));
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
        const nowIso = DateTime.formatIso(yield* DateTime.now);
        const nowMs = Date.parse(nowIso);
        const blocked = yield* providerQuotaStatusRepository.listBlocked();
        const elapsed = blocked.filter(
          (row) =>
            row.status === "blocked-until" &&
            row.resetAt !== null &&
            Date.parse(row.resetAt) <= nowMs,
        );
        if (elapsed.length === 0) {
          return 0;
        }
        yield* Effect.forEach(
          elapsed,
          (row) =>
            providerQuotaStatusRepository.upsert({
              providerInstanceId: row.providerInstanceId,
              status: "ok",
              resetAt: null,
              updatedAt: nowIso,
            }),
          { concurrency: 1, discard: true },
        );
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

export const makePiProjectRuntimeFactoryWithOptions = (options?: PmProjectRuntimeFactoryOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const providerQuotaStatusRepository = yield* ProviderQuotaStatusRepository;
    const serverSettings = yield* ServerSettingsService;
    const providerAdapterRegistry = yield* ProviderAdapterRegistry;
    const providerSessionDirectory = yield* ProviderSessionDirectory;
    const settings = yield* serverSettings.getSettings;
    const autoCompactionDefaults = resolveAutoCompaction({
      defaults: settings.orchestratorDefaults,
    });
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

        const config = resolveProjectConfig(project);
        if (Option.isNone(config)) {
          return yield* makeNoPmRuntimeError(
            `Orchestrator mode is not enabled for project '${project.id}'.`,
          );
        }
        const harnessConfig = yield* resolvePmHarnessConfig(project, {
          serverSettings,
          providerAdapterRegistry,
        });
        const pmModelSelection = harnessConfig.selection;
        const claudeAdapter = yield* resolveClaudePmAdapter(harnessConfig, providerAdapterRegistry);
        const resources = resolvePmHarnessResources(
          config.value.taskTypes.map((taskType) => taskType.id),
        );
        const driverPmAdapterOptions = {
          project,
          claudeAdapter,
          modelSelection: pmModelSelection,
          systemPrompt: buildPmSystemPrompt(project),
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
          events: adapter.events,
        }).pipe(
          Effect.provideService(OrchestrationEngineService, orchestrationEngine),
          Effect.provideService(ProjectionSnapshotQuery, projectionSnapshotQuery),
          Scope.provide(projectRuntimeScope),
        );
        const pmProviderInstanceId = harnessConfig.providerInstanceId;
        const pmThreadId = pmThreadIdForProject(project);
        const autoCompactionForSelection = (selection: ModelSelection) => ({
          ...autoCompactionDefaults,
          contextWindow: resolveClaudePmContextWindow(selection),
        });
        const queue = yield* makePmReEntryQueue(adapter, {
          autoCompaction: autoCompactionForSelection(pmModelSelection),
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

        const compactBeforeModelSwitch = (nextModelSelection: ModelSelection) =>
          adapter.compact(autoCompactionDefaults.customInstructions).pipe(
            Effect.timeout(PM_COMPACTION_TIMEOUT),
            Effect.catchCause((cause) =>
              Effect.logWarning("PM model-switch compaction failed or timed out", {
                projectId: String(project.id),
                nextProviderInstanceId: String(nextModelSelection.instanceId),
                nextModel: nextModelSelection.model,
                timeoutMs: Duration.toMillis(PM_COMPACTION_TIMEOUT),
                cause: Cause.pretty(cause),
              }),
            ),
          );

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
                yield* compactBeforeModelSwitch(nextHarnessConfig.selection);
                yield* adapter.setModel(pmAdapterModelDescriptor(nextHarnessConfig.selection));
                yield* queue.setAutoCompaction(
                  autoCompactionForSelection(nextHarnessConfig.selection),
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
          enqueue: (message) => ensureRuntimeActive.pipe(Effect.andThen(queue.enqueue(message))),
          drain: ensureRuntimeActive.pipe(
            Effect.andThen(queue.drain),
            Effect.andThen(eventProjection.drain),
          ),
        };
        runtimes.set(key, {
          runtime,
          waitForIdle,
          invalidateRuntime,
        });
        return runtime;
      });

    const waitForIdle: PmProjectRuntimeFactoryShape["waitForIdle"] = (projectId) => {
      const existing = runtimes.get(String(projectId));
      return existing?.waitForIdle ?? Effect.void;
    };

    const invalidateRuntimeByProjectId: PmProjectRuntimeFactoryShape["invalidateRuntime"] = (
      projectId,
      reason,
    ) => {
      const existing = runtimes.get(String(projectId));
      return existing?.invalidateRuntime(reason) ?? Effect.void;
    };

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
        yield* resetClaudePmSession({
          project,
          providerAdapterRegistry,
          providerSessionDirectory,
        });
      });

    return {
      getOrCreate,
      waitForIdle,
      invalidateRuntime: invalidateRuntimeByProjectId,
      clearSessionStorage,
    } satisfies PmProjectRuntimeFactoryShape;
  });

export const makePiProjectRuntimeFactory = makePiProjectRuntimeFactoryWithOptions();

export const PiProjectRuntimeFactoryLive = Layer.effect(
  PmProjectRuntimeFactory,
  makePiProjectRuntimeFactory,
);
