import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationCommand,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OrchestrationThread,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CheckpointUnavailableError } from "../../checkpointing/Errors.ts";
import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery.ts";
import { ServerConfig } from "../../config.ts";
import { ProjectionAwaitedStageRepository } from "../../persistence/Services/ProjectionAwaitedStages.ts";
import { ProjectionQuotaBlockedStageRepository } from "../../persistence/Services/ProjectionQuotaBlockedStages.ts";
import {
  ProviderQuotaStatusRepository,
  type ProviderQuotaStatusRow,
  type UpsertProviderQuotaStatusInput,
} from "../../persistence/Services/ProviderQuotaStatus.ts";
import {
  PmRuntimeStateRepository,
  type ConsumePmSettlementInput,
  type MarkPmSettlementActedInput,
  type PmConsumedSettlement,
} from "../../persistence/Services/PmRuntimeState.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { ProviderUnsupportedError } from "../../provider/Errors.ts";
import type { ClaudeAdapterShape } from "../../provider/Services/ClaudeAdapter.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../../provider/Services/ProviderAdapterRegistry.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderSessionDirectoryShape,
} from "../../provider/Services/ProviderSessionDirectory.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PmProjectRuntimeFactory,
  PmRuntime,
  type PmProjectRuntime,
} from "../Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RepositoryIdentityResolver } from "../../project/Services/RepositoryIdentityResolver.ts";
import type { DriverPmAdapterOptions } from "../claude/DriverPmAdapter.ts";
import { OrchestrationMcpServerProviderLive } from "../claude/OrchestrationMcpServerProvider.ts";
import { PmRuntimeError } from "../pm/Errors.ts";
import type {
  AgentHarnessEvent,
  AgentHarnessResources,
  PmAdapterShape,
} from "../claude/pmHarness.ts";
import { fauxAssistantMessage } from "../claude/pmHarness.ts";
import { pmThreadIdForProject } from "../pm/PmEventProjection.ts";
import { quotaStageResumeCommandId } from "../stageResolution.ts";
import {
  buildPmSystemPrompt,
  makePmProjectRuntimeFactoryWithOptions,
  makePmRuntimeLive,
  resolvePmHarnessResources,
} from "./PmRuntime.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const now = "2026-06-14T10:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const stageThreadId = ThreadId.make("thread-stage-1");
const turnId = TurnId.make("turn-1");
const quotaBlockedSettlementKey = `${stageThreadId}::quota-blocked`;
const interruptedSettlementKey = `${stageThreadId}::interrupted`;
const claudeDriver = ProviderDriverKind.make("claudeAgent");
const codexDriver = ProviderDriverKind.make("codex");
const claudeInstanceId = ProviderInstanceId.make("claudeAgent");
const claudeWorkInstanceId = ProviderInstanceId.make("claude_work");
const codexInstanceId = ProviderInstanceId.make("codex");

const pmSelection = (
  instanceId: ProviderInstanceId = claudeInstanceId,
  model = "claude-sonnet-4-6",
): ModelSelection => ({
  instanceId,
  model,
});

const project: OrchestrationProject = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/tmp/project",
  repositoryIdentity: null,
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  roleModelSelections: {},
  orchestratorConfig: {
    pmModelSelection: pmSelection(),
  },
  scripts: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const task: OrchestrationTask = {
  id: taskId,
  projectId,
  type: TaskTypeId.make("feature"),
  title: "Implement feature",
  status: "review",
  branch: "orchestrator/task-1",
  worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
  prUrl: null,
  pmMessageId: MessageId.make("pm-message-1"),
  stageThreadIds: [stageThreadId],
  currentStageThreadId: null,
  landing: null,
  playbookVersion: "feature@v1",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
};

const readModel: OrchestrationReadModel = {
  snapshotSequence: 3,
  projects: [project],
  threads: [],
  tasks: [task],
  pendingGates: [],
  quotaBlockedStages: [],
  stageHistory: {},
  updatedAt: now,
};

const stageThread: OrchestrationThread = {
  id: stageThreadId,
  projectId,
  title: "Implement feature (work)",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "orchestrator/task-1",
  worktreePath: "/tmp/project/.gedcode/orchestrator/tasks/task-1",
  latestTurn: {
    turnId,
    state: "completed",
    requestedAt: now,
    startedAt: now,
    completedAt: now,
    assistantMessageId: MessageId.make("assistant-1"),
  },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  pendingPmHandoff: null,
  messages: [
    {
      id: MessageId.make("user-1"),
      role: "user",
      text: "Implement feature",
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: MessageId.make("assistant-1"),
      role: "assistant",
      text: "Implemented it. OPENAI_API_KEY=sk-live-secret should not leak.",
      attachments: [],
      turnId,
      streaming: false,
      createdAt: now,
      updatedAt: now,
    },
  ],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
};

const stageCompletedEvent: OrchestrationEvent = {
  sequence: 10,
  eventId: EventId.make("evt-stage-completed"),
  aggregateKind: "task",
  aggregateId: taskId,
  type: "task.stage-completed",
  occurredAt: now,
  commandId: CommandId.make("cmd-stage-completed"),
  causationEventId: null,
  correlationId: CommandId.make("cmd-stage-completed"),
  metadata: {},
  payload: {
    taskId,
    role: "work",
    stageThreadId,
    awaitedTurnId: turnId,
    updatedAt: now,
  },
};

const stageBlockedEvent: OrchestrationEvent = {
  sequence: 11,
  eventId: EventId.make("evt-stage-blocked"),
  aggregateKind: "task",
  aggregateId: taskId,
  type: "task.stage-blocked",
  occurredAt: now,
  commandId: CommandId.make("cmd-stage-blocked"),
  causationEventId: null,
  correlationId: CommandId.make("cmd-stage-blocked"),
  metadata: {},
  payload: {
    taskId,
    role: "work",
    stageThreadId,
    reason: "quota",
    providerInstanceId: ProviderInstanceId.make("codex"),
    resetAt: "2026-06-14T12:00:00.000Z",
    updatedAt: now,
  },
};

const stageInterruptedEvent: OrchestrationEvent = {
  sequence: 12,
  eventId: EventId.make("evt-stage-interrupted"),
  aggregateKind: "task",
  aggregateId: taskId,
  type: "task.stage-interrupted",
  occurredAt: now,
  commandId: CommandId.make("cmd-stage-interrupted"),
  causationEventId: null,
  correlationId: CommandId.make("cmd-stage-interrupted"),
  metadata: {},
  payload: {
    taskId,
    role: "work",
    stageThreadId,
    reason: "orphaned",
    updatedAt: now,
  },
};

const makeProviderSession = (
  threadId: ThreadId,
  instanceId: ProviderInstanceId = claudeInstanceId,
  provider: ProviderDriverKind = claudeDriver,
): ProviderSession => ({
  provider,
  providerInstanceId: instanceId,
  status: "ready",
  runtimeMode: "approval-required",
  cwd: project.workspaceRoot,
  model: "claude-sonnet-4-6",
  threadId,
  createdAt: now,
  updatedAt: now,
});

const makeFakeClaudeAdapter = (
  input: {
    readonly provider?: ProviderDriverKind;
    readonly startInputs?: ProviderSessionStartInput[];
    readonly sendTurn?: ClaudeAdapterShape["sendTurn"];
    readonly stopSession?: ClaudeAdapterShape["stopSession"];
  } = {},
): ClaudeAdapterShape => ({
  provider: input.provider ?? claudeDriver,
  capabilities: { sessionModelSwitch: "in-session" },
  streamEvents: Stream.empty,
  startSession: (sessionInput) =>
    Effect.sync(() => {
      input.startInputs?.push(sessionInput);
      return makeProviderSession(
        sessionInput.threadId,
        sessionInput.providerInstanceId,
        sessionInput.provider,
      );
    }),
  sendTurn:
    input.sendTurn ??
    ((turnInput) =>
      Effect.succeed({
        threadId: turnInput.threadId,
        turnId,
      })),
  interruptTurn: () => Effect.void,
  respondToRequest: () => Effect.void,
  respondToUserInput: () => Effect.void,
  stopSession: input.stopSession ?? (() => Effect.void),
  listSessions: () => Effect.succeed([]),
  hasSession: () => Effect.succeed(false),
  readThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
  rollbackThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
  stopAll: () => Effect.void,
});

const makeProviderAdapterRegistryLayer = (
  instances: ReadonlyMap<
    string,
    {
      readonly driverKind: ProviderDriverKind;
      readonly adapter: ClaudeAdapterShape;
      readonly enabled?: boolean;
    }
  > = new Map([
    [String(claudeInstanceId), { driverKind: claudeDriver, adapter: makeFakeClaudeAdapter() }],
    [String(claudeWorkInstanceId), { driverKind: claudeDriver, adapter: makeFakeClaudeAdapter() }],
    [
      String(codexInstanceId),
      { driverKind: codexDriver, adapter: makeFakeClaudeAdapter({ provider: codexDriver }) },
    ],
  ]),
) =>
  Layer.succeed(ProviderAdapterRegistry, {
    getByInstance: (instanceId) => {
      const entry = instances.get(String(instanceId));
      return entry
        ? Effect.succeed(entry.adapter)
        : Effect.fail(new ProviderUnsupportedError({ provider: instanceId }));
    },
    getInstanceInfo: (instanceId) => {
      const entry = instances.get(String(instanceId));
      return entry
        ? Effect.succeed({
            instanceId,
            driverKind: entry.driverKind,
            displayName: undefined,
            accentColor: undefined,
            enabled: entry.enabled ?? true,
            continuationIdentity: {
              driverKind: entry.driverKind,
              continuationKey: `${entry.driverKind}:instance:${instanceId}`,
            },
          })
        : Effect.fail(new ProviderUnsupportedError({ provider: instanceId }));
    },
    listInstances: () =>
      Effect.succeed(
        Array.from(instances.keys()).map((instanceId) => ProviderInstanceId.make(instanceId)),
      ),
    listProviders: () =>
      Effect.succeed(
        Array.from(new Set(Array.from(instances.values()).map((entry) => entry.driverKind))),
      ),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  } satisfies ProviderAdapterRegistryShape);

const makeMemoryProviderSessionDirectory = (): {
  readonly service: ProviderSessionDirectoryShape;
  readonly bindings: Map<string, ProviderRuntimeBinding>;
} => {
  const bindings = new Map<string, ProviderRuntimeBinding>();
  const service = {
    upsert: (binding) =>
      Effect.sync(() => {
        const existing = bindings.get(String(binding.threadId));
        bindings.set(
          String(binding.threadId),
          existing === undefined ? binding : { ...existing, ...binding },
        );
      }),
    getProvider: (threadId) =>
      Effect.succeed(bindings.get(String(threadId))?.provider ?? claudeDriver),
    getBinding: (threadId) => {
      const binding = bindings.get(String(threadId));
      return Effect.succeed(binding === undefined ? Option.none() : Option.some(binding));
    },
    listThreadIds: () =>
      Effect.succeed(Array.from(bindings.values()).map((binding) => binding.threadId)),
    listBindings: () =>
      Effect.succeed(
        Array.from(bindings.values()).map((binding) =>
          Object.assign({}, binding, {
            lastSeenAt: now,
          }),
        ),
      ),
  } satisfies ProviderSessionDirectoryShape;
  return { service, bindings };
};

const makeProviderSessionDirectoryLayer = (service?: ProviderSessionDirectoryShape) =>
  Layer.succeed(ProviderSessionDirectory, service ?? makeMemoryProviderSessionDirectory().service);

const makeLayer = (input: {
  readonly liveEvents: ReadonlyArray<OrchestrationEvent>;
  readonly historicalEvents: ReadonlyArray<OrchestrationEvent>;
  readonly consumed: Set<string>;
  readonly messages: string[];
  readonly consumeCalls: ConsumePmSettlementInput[];
  readonly markActedCalls?: MarkPmSettlementActedInput[];
  readonly pendingSettlements?: PmConsumedSettlement[];
  readonly cursorByProject?: Map<string, number>;
  readonly readEventCursors?: number[];
  readonly commandReadModel?: OrchestrationReadModel;
  readonly quotaBlockedStages?: OrchestrationReadModel["quotaBlockedStages"];
  readonly providerQuotaStatuses?: Map<string, "ok" | "blocked-until" | "blocked-unknown">;
  // WP-Q6: rows returned by ProviderQuotaStatusRepository.listBlocked (the
  // currently quota-blocked instances the sweep scans for elapsed resets), plus
  // a capture of the upserts the sweep issues when it clears an elapsed reset.
  readonly providerQuotaBlockedRows?: ProviderQuotaStatusRow[];
  readonly quotaUpsertCalls?: UpsertProviderQuotaStatusInput[];
  readonly dispatchCalls?: unknown[];
  readonly dispatchFailureCommandIds?: ReadonlySet<string>;
  readonly threadDetails?: ReadonlyMap<string, OrchestrationThread>;
  // WP-4 diff-capture knobs. By default the stage thread has no captured
  // checkpoint (latestCheckpointTurnCount = 0 → diff-unavailable), preserving
  // the pre-WP-4 behavior of the existing suite (no diff section).
  readonly latestCheckpointTurnCount?: number;
  readonly fullThreadDiff?: OrchestrationGetFullThreadDiffResult;
  readonly fullThreadDiffFails?: boolean;
}) => {
  const cursorByProject = input.cursorByProject ?? new Map<string, number>();
  const readEventCursors = input.readEventCursors ?? [];
  const latestCheckpointTurnCount = input.latestCheckpointTurnCount ?? 0;
  const projectRuntime: PmProjectRuntime = {
    surfaceUserMessage: (message) =>
      Effect.sync(() => {
        input.messages.push(`surface:${message}`);
      }),
    createHandoffBrief: Effect.succeed("handoff brief"),
    enqueue: (message) =>
      Effect.sync(() => {
        input.messages.push(message);
      }),
    drain: Effect.void,
  };

  return makePmRuntimeLive({ reconciliationIntervalMsOverride: 60_000 }).pipe(
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        readEvents: (fromSequenceExclusive: number) => {
          readEventCursors.push(fromSequenceExclusive);
          return Stream.fromIterable(
            input.historicalEvents.filter((event) => event.sequence > fromSequenceExclusive),
          );
        },
        dispatch: (command) =>
          input.dispatchCalls
            ? input.dispatchFailureCommandIds?.has(String(command.commandId))
              ? Effect.die("dispatch failed (test)")
              : Effect.sync(() => {
                  input.dispatchCalls?.push(command);
                  return { sequence: 100 };
                })
            : Effect.die("dispatch should not be called by PmRuntime"),
        streamDomainEvents: Stream.fromIterable(input.liveEvents),
        streamShellEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getCommandReadModel: () => Effect.succeed(input.commandReadModel ?? readModel),
        getThreadDetailById: (threadId: ThreadId) => {
          const detail = input.threadDetails?.get(String(threadId));
          return Effect.succeed(
            detail !== undefined
              ? Option.some(detail)
              : threadId === stageThreadId
                ? Option.some(stageThread)
                : Option.none(),
          );
        },
        getFullThreadDiffContext: (threadId: ThreadId) =>
          Effect.succeed(
            threadId === stageThreadId && latestCheckpointTurnCount > 0
              ? Option.some({
                  threadId,
                  projectId,
                  workspaceRoot: "/tmp/project",
                  worktreePath: null,
                  latestCheckpointTurnCount,
                  toCheckpointRef: null,
                })
              : Option.none(),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(CheckpointDiffQuery)({
        getFullThreadDiff: () =>
          input.fullThreadDiffFails === true
            ? new CheckpointUnavailableError({
                threadId: String(stageThreadId),
                turnCount: latestCheckpointTurnCount,
                detail: "checkpoint read failed (test)",
              })
            : Effect.succeed(
                input.fullThreadDiff ?? {
                  threadId: stageThreadId,
                  fromTurnCount: 0,
                  toTurnCount: latestCheckpointTurnCount,
                  diff: "",
                },
              ),
      }),
    ),
    Layer.provide(
      Layer.succeed(PmRuntimeStateRepository, {
        getCursor: ({ projectId }) =>
          Effect.sync(() => {
            const lastConsumedSequence = cursorByProject.get(String(projectId));
            return lastConsumedSequence === undefined
              ? Option.none()
              : Option.some({ projectId, lastConsumedSequence, updatedAt: now });
          }),
        listConsumedSettlements: () => Effect.succeed([]),
        listPending: () => Effect.succeed(input.pendingSettlements ?? []),
        consumeSettlementAndAdvanceCursor: (consumeInput: ConsumePmSettlementInput) =>
          Effect.sync(() => {
            input.consumeCalls.push(consumeInput);
            const key = `${consumeInput.projectId}:${consumeInput.kind}:${consumeInput.settlementKey}`;
            if (input.consumed.has(key)) {
              return false;
            }
            input.consumed.add(key);
            cursorByProject.set(
              String(consumeInput.projectId),
              Math.max(
                cursorByProject.get(String(consumeInput.projectId)) ?? 0,
                consumeInput.sequence,
              ),
            );
            return true;
          }),
        markActed: (actedInput: MarkPmSettlementActedInput) =>
          Effect.sync(() => {
            input.markActedCalls?.push(actedInput);
            if (input.pendingSettlements) {
              const index = input.pendingSettlements.findIndex(
                (settlement) =>
                  settlement.projectId === actedInput.projectId &&
                  settlement.kind === actedInput.kind &&
                  settlement.settlementKey === actedInput.settlementKey,
              );
              if (index >= 0) {
                input.pendingSettlements.splice(index, 1);
              }
            }
          }),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProjectionAwaitedStageRepository, {
        upsert: () => Effect.void,
        listByTaskId: () => Effect.succeed([]),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProjectionQuotaBlockedStageRepository, {
        upsert: () => Effect.void,
        listByTaskId: () => Effect.succeed([]),
        listBlockedByProviderInstanceId: ({ providerInstanceId }) =>
          Effect.succeed(
            (input.quotaBlockedStages ?? []).filter(
              (stage) =>
                stage.providerInstanceId === providerInstanceId && stage.status === "blocked",
            ),
          ),
        listBlocked: () =>
          Effect.succeed(
            (input.quotaBlockedStages ?? []).filter((stage) => stage.status === "blocked"),
          ),
        listAll: () => Effect.succeed(input.quotaBlockedStages ?? []),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProviderQuotaStatusRepository, {
        upsert: (row) =>
          Effect.sync(() => {
            input.quotaUpsertCalls?.push(row);
            return {
              providerInstanceId: row.providerInstanceId,
              previousStatus: null,
              nextStatus: row.status,
              resetAt: row.resetAt,
            };
          }),
        markBlocked: () =>
          Effect.die("ProviderQuotaStatusRepository.markBlocked should not be called by PmRuntime"),
        observeRuntimeStatus: () =>
          Effect.die(
            "ProviderQuotaStatusRepository.observeRuntimeStatus should not be called by PmRuntime",
          ),
        getByProviderInstanceId: ({ providerInstanceId }) =>
          Effect.sync(() => {
            const status = input.providerQuotaStatuses?.get(String(providerInstanceId));
            return status === undefined
              ? Option.none()
              : Option.some({
                  providerInstanceId,
                  status,
                  resetAt: null,
                  updatedAt: now,
                });
          }),
        isInstanceQuotaBlocked: ({ providerInstanceId }) =>
          Effect.sync(() => {
            const status = input.providerQuotaStatuses?.get(String(providerInstanceId)) ?? "ok";
            return {
              providerInstanceId,
              status,
              blocked: status !== "ok",
              resetAt: null,
            };
          }),
        listBlocked: () => Effect.succeed(input.providerQuotaBlockedRows ?? []),
      }),
    ),
    Layer.provide(
      Layer.succeed(PmProjectRuntimeFactory, {
        getOrCreate: () => Effect.succeed(projectRuntime),
        waitForIdle: () => Effect.void,
        invalidateRuntime: () => Effect.void,
        clearSessionStorage: () => Effect.void,
        resetSessionBinding: () => Effect.void,
        createHandoffBrief: () => Effect.succeed(Option.none()),
      }),
    ),
    Layer.provide(ServerSettingsService.layerTest()),
    Layer.provide(OrchestrationMcpServerProviderLive),
    Layer.provide(NodeServices.layer),
  );
};

const makeFactoryCaptureLayer = (input?: {
  readonly streamDomainEvents?: Stream.Stream<OrchestrationEvent>;
  readonly serverSettingsOverrides?: Parameters<typeof ServerSettingsService.layerTest>[0];
  readonly dispatchCalls?: OrchestrationCommand[];
  readonly threadDetails?: ReadonlyMap<string, OrchestrationThread>;
  readonly liveProjection?: boolean;
  readonly runtimeEvents?: Stream.Stream<ProviderRuntimeEvent>;
  readonly providerInstances?: ReadonlyMap<
    string,
    {
      readonly driverKind: ProviderDriverKind;
      readonly adapter: ClaudeAdapterShape;
      readonly enabled?: boolean;
    }
  >;
  readonly providerSessionDirectory?: ProviderSessionDirectoryShape;
}) => {
  const repositoryIdentityResolverLayer = Layer.succeed(RepositoryIdentityResolver, {
    resolve: () => Effect.succeed(null),
  });
  const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
    Layer.provide(repositoryIdentityResolverLayer),
    Layer.provide(SqlitePersistenceMemory),
  );
  const projectionPipelineLayer = OrchestrationProjectionPipelineLive.pipe(
    Layer.provide(ServerSettingsService.layerTest(input?.serverSettingsOverrides)),
    Layer.provide(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provide(NodeServices.layer),
  );
  const orchestrationServices =
    input?.liveProjection === true
      ? Layer.merge(
          OrchestrationEngineLive.pipe(
            Layer.provide(OrchestrationProjectionSnapshotQueryLive),
            Layer.provide(projectionPipelineLayer),
            Layer.provide(OrchestrationEventStoreLive),
            Layer.provide(OrchestrationCommandReceiptRepositoryLive),
            Layer.provide(ServerSettingsService.layerTest(input?.serverSettingsOverrides)),
            Layer.provide(repositoryIdentityResolverLayer),
            Layer.provide(SqlitePersistenceMemory),
            Layer.provide(NodeServices.layer),
          ),
          projectionSnapshotLayer,
        )
      : Layer.merge(
          Layer.mock(OrchestrationEngineService)({
            readEvents: () => Stream.empty,
            dispatch: (command) =>
              Effect.sync(() => {
                input?.dispatchCalls?.push(command);
                return { sequence: input?.dispatchCalls?.length ?? 1 };
              }),
            streamDomainEvents: input?.streamDomainEvents ?? Stream.empty,
            streamShellEvents: Stream.empty,
          }),
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Effect.succeed(readModel),
            getSnapshot: () => Effect.succeed(readModel),
            getShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                projects: [],
                threads: [],
                updatedAt: now,
              }),
            getArchivedShellSnapshot: () =>
              Effect.succeed({
                snapshotSequence: 0,
                projects: [],
                threads: [],
                updatedAt: now,
              }),
            getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
            getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
            getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
            getProjectShellById: () => Effect.succeed(Option.none()),
            getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
            getThreadCheckpointContext: () => Effect.succeed(Option.none()),
            getFullThreadDiffContext: () => Effect.succeed(Option.none()),
            getThreadShellById: () => Effect.succeed(Option.none()),
            getThreadDetailById: (threadId) => {
              const detail = input?.threadDetails?.get(String(threadId));
              return Effect.succeed(detail === undefined ? Option.none() : Option.some(detail));
            },
          }),
        );

  return Layer.mergeAll(
    SqlitePersistenceMemory,
    NodeServices.layer,
    OrchestrationMcpServerProviderLive,
    makeProviderAdapterRegistryLayer(input?.providerInstances),
    Layer.succeed(ProviderService, {
      startSession: () => Effect.die("ProviderService.startSession should not be called"),
      sendTurn: () => Effect.die("ProviderService.sendTurn should not be called"),
      interruptTurn: () => Effect.die("ProviderService.interruptTurn should not be called"),
      respondToRequest: () => Effect.die("ProviderService.respondToRequest should not be called"),
      respondToUserInput: () =>
        Effect.die("ProviderService.respondToUserInput should not be called"),
      stopSession: () => Effect.die("ProviderService.stopSession should not be called"),
      listSessions: () => Effect.die("ProviderService.listSessions should not be called"),
      getCapabilities: () => Effect.die("ProviderService.getCapabilities should not be called"),
      getInstanceInfo: () => Effect.die("ProviderService.getInstanceInfo should not be called"),
      rollbackConversation: () =>
        Effect.die("ProviderService.rollbackConversation should not be called"),
      get streamEvents() {
        return input?.runtimeEvents ?? Stream.empty;
      },
    } satisfies ProviderServiceShape),
    Layer.succeed(TerminalManager, {
      open: () => Effect.die("TerminalManager.open should not be called"),
      write: () => Effect.die("TerminalManager.write should not be called"),
      resize: () => Effect.die("TerminalManager.resize should not be called"),
      clear: () => Effect.die("TerminalManager.clear should not be called"),
      restart: () => Effect.die("TerminalManager.restart should not be called"),
      close: () => Effect.void,
      subscribe: () => Effect.succeed(() => undefined),
    } satisfies TerminalManagerShape),
    makeProviderSessionDirectoryLayer(input?.providerSessionDirectory),
    orchestrationServices,
    Layer.succeed(ProviderQuotaStatusRepository, {
      upsert: () =>
        Effect.succeed({
          providerInstanceId: claudeInstanceId,
          previousStatus: null,
          nextStatus: "ok" as const,
          resetAt: null,
        }),
      markBlocked: ({ providerInstanceId, resetAt }) =>
        Effect.succeed({
          providerInstanceId,
          previousStatus: null,
          nextStatus: resetAt === null ? ("blocked-unknown" as const) : ("blocked-until" as const),
          resetAt,
        }),
      observeRuntimeStatus: () => Effect.succeed(Option.none()),
      getByProviderInstanceId: () => Effect.succeed(Option.none()),
      isInstanceQuotaBlocked: ({ providerInstanceId }) =>
        Effect.succeed({
          providerInstanceId,
          status: "ok" as const,
          blocked: false,
          resetAt: null,
        }),
      listBlocked: () => Effect.succeed([]),
    }),
    ServerSettingsService.layerTest(input?.serverSettingsOverrides),
  );
};

const makeTestPmAdapter = (input?: {
  readonly resourceCalls?: AgentHarnessResources[];
  readonly calls?: string[];
  readonly prompt?: PmAdapterShape["prompt"];
  readonly waitForIdle?: PmAdapterShape["waitForIdle"];
  readonly setModel?: PmAdapterShape["setModel"];
}) =>
  ({
    events: Stream.empty,
    isIdle: Effect.succeed(true),
    latestAssistantUsage: Effect.sync(() => undefined),
    start: Effect.sync(() => {
      input?.calls?.push("start");
    }),
    waitForIdle:
      input?.waitForIdle ??
      Effect.sync(() => {
        input?.calls?.push("waitForIdle");
      }),
    prompt:
      input?.prompt ??
      (() => {
        input?.calls?.push("prompt");
        return Effect.succeed(fauxAssistantMessage("ok"));
      }),
    followUp: () => Effect.void,
    setModel:
      input?.setModel ??
      ((model) =>
        Effect.sync(() => {
          input?.calls?.push(`setModel:${model.id}`);
        })),
    setResources: (resources) =>
      Effect.sync(() => {
        input?.resourceCalls?.push(resources);
      }),
    abort: Effect.void,
  }) satisfies PmAdapterShape;

const makeCapturingAdapter = (
  captured: DriverPmAdapterOptions[],
  resourceCalls?: AgentHarnessResources[],
) =>
  ((options: DriverPmAdapterOptions) =>
    Effect.sync(() => {
      captured.push(options);
      return makeTestPmAdapter(resourceCalls === undefined ? undefined : { resourceCalls });
    })) satisfies NonNullable<
    Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
  >["makeDriverPmAdapterOverride"];

const projectWithPmModel = (instanceId: string, model: string): OrchestrationProject => ({
  ...project,
  orchestratorConfig: {
    pmModelSelection: pmSelection(ProviderInstanceId.make(instanceId), model),
  },
});

const projectMetaUpdatedEvent = (input: {
  readonly sequence: number;
  readonly instanceId: string;
  readonly model: string;
}): OrchestrationEvent => ({
  sequence: input.sequence,
  eventId: EventId.make(`evt-project-meta-${input.sequence}`),
  aggregateKind: "project",
  aggregateId: projectId,
  type: "project.meta-updated",
  occurredAt: now,
  commandId: CommandId.make(`cmd-project-meta-${input.sequence}`),
  causationEventId: null,
  correlationId: CommandId.make(`cmd-project-meta-${input.sequence}`),
  metadata: {},
  payload: {
    projectId,
    orchestratorConfig: {
      pmModelSelection: pmSelection(ProviderInstanceId.make(input.instanceId), input.model),
    },
    updatedAt: now,
  },
});

const makeProviderRuntimeEvent = (
  input: Omit<ProviderRuntimeEvent, "eventId" | "provider" | "createdAt" | "threadId"> & {
    readonly eventId?: string;
    readonly threadId?: ThreadId;
  },
): ProviderRuntimeEvent =>
  ({
    eventId: EventId.make(input.eventId ?? `event-${input.type}`),
    provider: claudeDriver,
    createdAt: now,
    threadId: input.threadId ?? pmThreadIdForProject(project),
    ...input,
  }) as ProviderRuntimeEvent;

const withEnvVars = <A, E, R>(
  vars: Record<string, string>,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = new Map<string, string | undefined>();
      for (const [key, value] of Object.entries(vars)) {
        previous.set(key, process.env[key]);
        process.env[key] = value;
      }
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of previous) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }),
  );

const counterCount = (snapshots: ReadonlyArray<Metric.Metric.Snapshot>, id: string): number => {
  const snapshot = snapshots.find(
    (entry): entry is Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }> =>
      entry.type === "Counter" && entry.id === id,
  );
  return Number(snapshot?.state.count ?? 0);
};

const histogramCount = (snapshots: ReadonlyArray<Metric.Metric.Snapshot>, id: string): number => {
  const snapshot = snapshots.find(
    (entry): entry is Extract<Metric.Metric.Snapshot, { readonly type: "Histogram" }> =>
      entry.type === "Histogram" && entry.id === id,
  );
  return snapshot?.state.count ?? 0;
};

describe("PmRuntime", () => {
  it.effect("prefers an explicit project PM model selection over the global default", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: DriverPmAdapterOptions[] = [];
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured),
        });

        yield* factory.getOrCreate(projectWithPmModel("claudeAgent", "claude-opus-4-8"));

        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0]?.modelSelection, {
          instanceId: claudeInstanceId,
          model: "claude-opus-4-8",
        });
        assert.strictEqual(captured[0]?.providerAdapter.provider, claudeDriver);
      }).pipe(
        Effect.provide(
          makeFactoryCaptureLayer({
            serverSettingsOverrides: {
              orchestratorDefaults: {
                pmModelSelection: pmSelection(claudeInstanceId, "claude-sonnet-4-6"),
              },
            },
          }),
        ),
      ),
    ),
  );

  it.effect(
    "injects pending PM handoff context once and clears it with completion commands",
    () => {
      const pmThreadId = pmThreadIdForProject(project);
      const dispatchCalls: OrchestrationCommand[] = [];
      const pendingThread: OrchestrationThread = {
        id: pmThreadId,
        projectId: project.id,
        title: "Project PM",
        modelSelection: pmSelection(claudeInstanceId, "claude-opus-4-6"),
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: project.workspaceRoot,
        latestTurn: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        deletedAt: null,
        pendingPmHandoff: {
          mode: "transcript",
          requestedAt: now,
        },
        messages: [
          {
            id: MessageId.make("pm-message-before-handoff"),
            role: "user",
            text: "Prior PM context",
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      };
      return Effect.scoped(
        Effect.gen(function* () {
          const captured: DriverPmAdapterOptions[] = [];
          const adapterCalls: string[] = [];
          const factory = yield* makePmProjectRuntimeFactoryWithOptions({
            makeDriverPmAdapterOverride: ((options: DriverPmAdapterOptions) =>
              Effect.sync(() => {
                captured.push(options);
                return makeTestPmAdapter({ calls: adapterCalls });
              })) satisfies NonNullable<
              Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
            >["makeDriverPmAdapterOverride"],
          });

          yield* factory.getOrCreate(project);

          assert.strictEqual(adapterCalls.filter((call) => call === "start").length, 1);
          assert.strictEqual(captured.length, 1);
          assert.include(
            captured[0]?.systemPrompt ?? "",
            "You are the orchestrator project manager",
          );
          assert.include(captured[0]?.systemPrompt ?? "", "BEGIN PM HANDOFF CONTEXT");
          assert.include(captured[0]?.systemPrompt ?? "", "Prior PM context");

          const completedCommand = dispatchCalls.find(
            (command) => command.type === "thread.pm-handoff.complete",
          );
          assert.isDefined(completedCommand);
          const markerCommand = dispatchCalls.find(
            (command) => command.type === "thread.activity.append",
          );
          assert.isDefined(markerCommand);
          if (markerCommand?.type === "thread.activity.append") {
            assert.equal(markerCommand.activity.kind, "pm.handoff");
            assert.equal(markerCommand.activity.summary, "PM handed off (transcript)");
          }

          yield* factory.getOrCreate(project);
          assert.strictEqual(adapterCalls.filter((call) => call === "start").length, 1);
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              dispatchCalls,
              threadDetails: new Map([[String(pmThreadId), pendingThread]]),
            }),
          ),
        ),
      );
    },
  );

  it.effect("uses the global PM model selection when the project selection is null", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: DriverPmAdapterOptions[] = [];
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured),
        });

        yield* factory.getOrCreate({
          ...project,
          orchestratorConfig: {
            pmModelSelection: null,
          },
        });

        assert.strictEqual(captured.length, 1);
        assert.deepStrictEqual(captured[0]?.modelSelection, {
          instanceId: claudeInstanceId,
          model: "claude-sonnet-4-6",
        });
      }).pipe(
        Effect.provide(
          makeFactoryCaptureLayer({
            serverSettingsOverrides: {
              orchestratorDefaults: {
                pmModelSelection: pmSelection(claudeInstanceId, "claude-sonnet-4-6"),
              },
            },
          }),
        ),
      ),
    ),
  );

  it.effect("constructs the PM adapter for a Codex PM instance", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: DriverPmAdapterOptions[] = [];
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured),
        });

        yield* factory.getOrCreate(projectWithPmModel("codex", "gpt-5-codex"));

        assert.strictEqual(captured.length, 1);
        assert.strictEqual(captured[0]?.driverKind, codexDriver);
        assert.strictEqual(captured[0]?.providerAdapter.provider, codexDriver);
        assert.deepStrictEqual(captured[0]?.modelSelection, {
          instanceId: codexInstanceId,
          model: "gpt-5-codex",
        });
        assert.include(
          captured[0]?.systemPrompt ?? "",
          "For decisions, ask in plain text and end your turn.",
        );
        assert.notInclude(captured[0]?.systemPrompt ?? "", "interactive question tool");
      }).pipe(Effect.provide(makeFactoryCaptureLayer())),
    ),
  );

  it.effect("starts a Codex PM from the projected config after a PM model update", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const snapshotQuery = yield* ProjectionSnapshotQuery;
        const captured: DriverPmAdapterOptions[] = [];
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured),
        });
        const projectedProjectId = ProjectId.make("project-pm-projection-update");

        yield* engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-pm-projection-create"),
          projectId: projectedProjectId,
          title: "PM Projection Update",
          workspaceRoot: "/tmp/pm-projection-update",
          defaultModelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5-codex",
          },
          orchestratorConfig: {},
          createdAt: now,
        });

        yield* engine.dispatch({
          type: "project.meta.update",
          commandId: CommandId.make("cmd-pm-projection-select"),
          projectId: projectedProjectId,
          orchestratorConfig: {
            pmModelSelection: pmSelection(codexInstanceId, "gpt-5.5"),
          },
        });

        const snapshot = yield* snapshotQuery.getSnapshot();
        const projectedProject = snapshot.projects.find((entry) => entry.id === projectedProjectId);
        if (projectedProject === undefined) {
          assert.fail("expected projected project to exist");
        }
        assert.deepStrictEqual(projectedProject.orchestratorConfig, {
          pmModelSelection: {
            instanceId: codexInstanceId,
            model: "gpt-5.5",
          },
        });

        yield* factory.getOrCreate(projectedProject);

        assert.strictEqual(captured.length, 1);
        assert.strictEqual(captured[0]?.driverKind, codexDriver);
        assert.deepStrictEqual(captured[0]?.modelSelection, {
          instanceId: codexInstanceId,
          model: "gpt-5.5",
        });
      }).pipe(Effect.provide(makeFactoryCaptureLayer({ liveProjection: true }))),
    ),
  );

  it.effect("leaves a missing PM model selection unconfigured without creating an adapter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: DriverPmAdapterOptions[] = [];
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured),
        });

        const error = yield* factory
          .getOrCreate({
            ...project,
            orchestratorConfig: {
              pmModelSelection: null,
            },
          })
          .pipe(Effect.flip);

        assert.instanceOf(error, PmRuntimeError);
        assert.match(error.detail, /no PM model selection configured/);
        assert.strictEqual(captured.length, 0);
      }).pipe(Effect.provide(makeFactoryCaptureLayer())),
    ),
  );

  it.effect("constructs the PM adapter with the built-in feature playbook skill", () =>
    Effect.gen(function* () {
      const captured: DriverPmAdapterOptions[] = [];
      const resourceCalls: AgentHarnessResources[] = [];

      yield* Effect.gen(function* () {
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured, resourceCalls),
        });
        yield* factory.getOrCreate(projectWithPmModel("claudeAgent", "claude-sonnet-4-6"));
      }).pipe(Effect.scoped, Effect.provide(makeFactoryCaptureLayer()));

      const resolved = defaultPlaybookLoader.resolve("feature");
      assert.ok(resolved);
      assert.strictEqual(captured.length, 1);
      assert.strictEqual(resourceCalls.length, 1);
      assert.deepStrictEqual(resourceCalls[0]?.skills, [resolved.skill]);
      assert.strictEqual(resourceCalls[0]?.skills?.[0]?.name, resolved.skill.name);
      assert.strictEqual(resourceCalls[0]?.skills?.[0]?.description, resolved.skill.description);
    }),
  );

  it.effect("builds the DriverPmAdapter for a Claude PM instance and processes a message", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
        const sendTurnCalled = yield* Deferred.make<void>();
        const dispatchCalls: OrchestrationCommand[] = [];
        const startInputs: ProviderSessionStartInput[] = [];
        const threadId = pmThreadIdForProject(project);
        const claudeAdapter = makeFakeClaudeAdapter({
          startInputs,
          sendTurn: (turnInput) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(sendTurnCalled, undefined);
              return { threadId: turnInput.threadId, turnId };
            }),
        });

        yield* Effect.gen(function* () {
          const factory = yield* makePmProjectRuntimeFactoryWithOptions();
          const runtime = yield* factory.getOrCreate(
            projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
          );

          yield* runtime.enqueue("Create a task.");
          const drain = yield* runtime.drain.pipe(Effect.forkScoped);
          yield* Deferred.await(sendTurnCalled);
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "turn.started",
              turnId,
              payload: { model: "claude-sonnet-4-6" },
            }),
          );
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "content.delta",
              turnId,
              itemId: RuntimeItemId.make("assistant-1"),
              payload: { streamKind: "assistant_text", delta: "Handled." },
            }),
          );
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "item.completed",
              turnId,
              itemId: RuntimeItemId.make("assistant-1"),
              payload: {
                itemType: "assistant_message",
                status: "completed",
                title: "Assistant message",
              },
            }),
          );
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "turn.completed",
              turnId,
              payload: {
                state: "completed",
                stopReason: "stop",
              },
            }),
          );

          yield* Fiber.join(drain);

          assert.deepStrictEqual(startInputs, [
            {
              threadId,
              provider: claudeDriver,
              providerInstanceId: claudeInstanceId,
              cwd: project.workspaceRoot,
              modelSelection: pmSelection(claudeInstanceId, "claude-sonnet-4-6"),
              runtimeMode: "full-access",
              enableOrchestrationTools: true,
              systemPromptAppend: buildPmSystemPrompt(project),
            },
          ]);
          assert.strictEqual("readOnly" in startInputs[0]!, false);
          assert.deepStrictEqual(
            dispatchCalls
              .map((command) => command.type)
              .filter((type) => type !== "thread.session.set"),
            [
              "thread.create",
              "thread.message.assistant.delta",
              "thread.message.assistant.complete",
            ],
          );
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              dispatchCalls,
              providerInstances: new Map([
                [String(claudeInstanceId), { driverKind: claudeDriver, adapter: claudeAdapter }],
              ]),
              runtimeEvents: Stream.fromQueue(runtimeEvents),
            }),
          ),
        );

        yield* Queue.shutdown(runtimeEvents);
      }),
    ),
  );

  it.effect("clears Claude PM driver session state before the next PM start", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
        const sendTurnCalled = yield* Deferred.make<void>();
        const startInputs: ProviderSessionStartInput[] = [];
        const stopSessionCalls: ThreadId[] = [];
        const directory = makeMemoryProviderSessionDirectory();
        const threadId = pmThreadIdForProject(project);
        const claudeAdapter = makeFakeClaudeAdapter({
          startInputs,
          stopSession: (stoppedThreadId) =>
            Effect.sync(() => {
              stopSessionCalls.push(stoppedThreadId);
            }),
          sendTurn: (turnInput) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(sendTurnCalled, undefined);
              return { threadId: turnInput.threadId, turnId };
            }),
        });

        yield* Effect.gen(function* () {
          const providerSessionDirectory = yield* ProviderSessionDirectory;
          yield* providerSessionDirectory.upsert({
            threadId,
            provider: claudeDriver,
            providerInstanceId: claudeInstanceId,
            status: "running",
            runtimeMode: "full-access",
            resumeCursor: { resume: "previous-claude-session" },
          });

          const factory = yield* makePmProjectRuntimeFactoryWithOptions();
          const pmProject = projectWithPmModel("claudeAgent", "claude-sonnet-4-6");
          yield* factory.clearSessionStorage(pmProject);

          const clearedBindingOption = yield* providerSessionDirectory.getBinding(threadId);
          assert.isTrue(Option.isSome(clearedBindingOption));
          if (Option.isNone(clearedBindingOption)) {
            return;
          }
          const clearedBinding = clearedBindingOption.value;
          assert.deepStrictEqual(stopSessionCalls, [threadId]);
          assert.strictEqual(clearedBinding.status, "stopped");
          assert.strictEqual(clearedBinding.resumeCursor, null);

          const runtime = yield* factory.getOrCreate(pmProject);
          yield* runtime.enqueue("Create a task.");
          const drain = yield* runtime.drain.pipe(Effect.forkScoped);
          yield* Deferred.await(sendTurnCalled);
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "turn.started",
              turnId,
              payload: { model: "claude-sonnet-4-6" },
            }),
          );
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "content.delta",
              turnId,
              itemId: RuntimeItemId.make("assistant-after-clear"),
              payload: { streamKind: "assistant_text", delta: "Fresh." },
            }),
          );
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "item.completed",
              turnId,
              itemId: RuntimeItemId.make("assistant-after-clear"),
              payload: {
                itemType: "assistant_message",
                status: "completed",
                title: "Assistant message",
              },
            }),
          );
          yield* Queue.offer(
            runtimeEvents,
            makeProviderRuntimeEvent({
              threadId,
              type: "turn.completed",
              turnId,
              payload: {
                state: "completed",
                stopReason: "stop",
              },
            }),
          );
          yield* Fiber.join(drain);

          assert.strictEqual(startInputs.length, 1);
          assert.strictEqual("resumeCursor" in (startInputs[0] ?? {}), false);
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              providerSessionDirectory: directory.service,
              providerInstances: new Map([
                [String(claudeInstanceId), { driverKind: claudeDriver, adapter: claudeAdapter }],
              ]),
              runtimeEvents: Stream.fromQueue(runtimeEvents),
            }),
          ),
        );

        yield* Queue.shutdown(runtimeEvents);
      }),
    ),
  );

  it.effect("clears Codex PM driver session state", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stopSessionCalls: ThreadId[] = [];
        const directory = makeMemoryProviderSessionDirectory();
        const threadId = pmThreadIdForProject(project);
        const codexAdapter = makeFakeClaudeAdapter({
          provider: codexDriver,
          stopSession: (stoppedThreadId) =>
            Effect.sync(() => {
              stopSessionCalls.push(stoppedThreadId);
            }),
        });

        yield* Effect.gen(function* () {
          const providerSessionDirectory = yield* ProviderSessionDirectory;
          yield* providerSessionDirectory.upsert({
            threadId,
            provider: codexDriver,
            providerInstanceId: codexInstanceId,
            status: "running",
            runtimeMode: "full-access",
            resumeCursor: { threadId: "previous-codex-thread" },
          });

          const factory = yield* makePmProjectRuntimeFactoryWithOptions();
          yield* factory.clearSessionStorage(projectWithPmModel("codex", "gpt-5-codex"));

          const clearedBindingOption = yield* providerSessionDirectory.getBinding(threadId);
          assert.isTrue(Option.isSome(clearedBindingOption));
          if (Option.isNone(clearedBindingOption)) {
            return;
          }
          const clearedBinding = clearedBindingOption.value;
          assert.deepStrictEqual(stopSessionCalls, [threadId]);
          assert.strictEqual(clearedBinding.provider, codexDriver);
          assert.strictEqual(clearedBinding.providerInstanceId, codexInstanceId);
          assert.strictEqual(clearedBinding.status, "stopped");
          assert.strictEqual(clearedBinding.resumeCursor, null);
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              providerSessionDirectory: directory.service,
              providerInstances: new Map([
                [String(codexInstanceId), { driverKind: codexDriver, adapter: codexAdapter }],
              ]),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("surfaces failed PM driver turns as PM-thread error activities", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const failure = new PmRuntimeError({
          operation: "DriverPmAdapter.prompt",
          detail: "Claude PM turn failed.",
          cause: new Error("429 quota exceeded for OPENAI_API_KEY=sk-live-secret"),
        });

        yield* Effect.gen(function* () {
          const engine = yield* OrchestrationEngineService;
          const snapshotQuery = yield* ProjectionSnapshotQuery;
          yield* engine.dispatch({
            type: "project.create",
            commandId: CommandId.make("cmd-project-create"),
            projectId,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
            defaultModelSelection: project.defaultModelSelection,
            createdAt: now,
          });

          const factory = yield* makePmProjectRuntimeFactoryWithOptions({
            makeDriverPmAdapterOverride: (() =>
              Effect.succeed(
                makeTestPmAdapter({
                  prompt: () => Effect.fail(failure),
                }),
              )) satisfies NonNullable<
              Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
            >["makeDriverPmAdapterOverride"],
          });
          const runtime = yield* factory.getOrCreate(
            projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
          );

          yield* runtime.enqueue("Create a task.");
          const firstError = yield* runtime.drain.pipe(Effect.flip);
          yield* runtime.enqueue("Create a task.");
          const secondError = yield* runtime.drain.pipe(Effect.flip);

          assert.strictEqual(firstError, failure);
          assert.strictEqual(secondError, failure);

          const pmThreadId = pmThreadIdForProject(project);
          const threadDetail = yield* snapshotQuery.getThreadDetailById(pmThreadId);
          if (Option.isNone(threadDetail)) {
            assert.fail("expected the PM thread to be projected");
          }
          const pmThread = threadDetail.value;
          const failureActivities = pmThread.activities.filter(
            (activity) => activity.kind === "pm.turn.failed",
          );

          assert.strictEqual(failureActivities.length, 1);
          assert.strictEqual(pmThread.id, pmThreadId);
          assert.strictEqual(failureActivities[0]?.tone, "error");
          assert.match(
            failureActivities[0]?.summary ?? "",
            /PM turn failed: PM provider quota or rate limit reached/,
          );
          assert.match(failureActivities[0]?.summary ?? "", /429 quota exceeded/);
          assert.notMatch(failureActivities[0]?.summary ?? "", /sk-live-secret/);
          assert.match(failureActivities[0]?.summary ?? "", /OPENAI_API_KEY=\[REDACTED\]/);

          const payload = failureActivities[0]?.payload as Record<string, unknown>;
          assert.strictEqual(payload.category, "rate_limit");
          assert.strictEqual(payload.operation, "DriverPmAdapter.prompt");
          assert.strictEqual(payload.providerInstanceId, claudeInstanceId);
          assert.match(String(payload.reason), /429 quota exceeded/);
          assert.notMatch(String(payload.reason), /sk-live-secret/);

          assert.ok(pmThread.activities.some((activity) => activity.kind === "quota.paused"));
        }).pipe(Effect.provide(makeFactoryCaptureLayer({ liveProjection: true })));
      }),
    ),
  );

  it.effect("rejects unsupported PM provider instances with a clear typed error", () => {
    const opencodeDriver = ProviderDriverKind.make("opencode");
    const opencodeInstanceId = ProviderInstanceId.make("opencode");
    return Effect.scoped(
      Effect.gen(function* () {
        const captured: DriverPmAdapterOptions[] = [];
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: makeCapturingAdapter(captured),
        });

        const error = yield* factory
          .getOrCreate(projectWithPmModel("opencode", "opencode-model"))
          .pipe(Effect.flip);

        assert.instanceOf(error, PmRuntimeError);
        assert.match(
          error.detail,
          /The orchestrator PM requires a Claude or Codex provider instance/,
        );
        assert.strictEqual(captured.length, 0);
      }).pipe(
        Effect.provide(
          makeFactoryCaptureLayer({
            providerInstances: new Map([
              [
                String(opencodeInstanceId),
                {
                  driverKind: opencodeDriver,
                  adapter: makeFakeClaudeAdapter({ provider: opencodeDriver }),
                },
              ],
            ]),
          }),
        ),
      ),
    );
  });

  it("omits PM harness resources when no configured playbook resolves", () => {
    assert.strictEqual(resolvePmHarnessResources(["unknown"]), undefined);
  });

  it.effect("waits for idle and invalidates the cached project runtime", () =>
    Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const calls: string[] = [];
          const factory = yield* makePmProjectRuntimeFactoryWithOptions({
            makeDriverPmAdapterOverride: (() =>
              Effect.sync(() => {
                calls.push("create");
                return {
                  events: Stream.empty,
                  isIdle: Effect.succeed(true),
                  latestAssistantUsage: Effect.sync(() => undefined),
                  start: Effect.void,
                  waitForIdle: Effect.sync(() => {
                    calls.push("waitForIdle");
                  }),
                  prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                  followUp: () => Effect.void,
                  setModel: () => Effect.void,
                  setResources: () => Effect.void,
                  abort: Effect.void,
                };
              })) satisfies NonNullable<
              Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
            >["makeDriverPmAdapterOverride"],
          });

          const firstRuntime = yield* factory.getOrCreate(
            projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
          );
          const cachedRuntime = yield* factory.getOrCreate(
            projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
          );
          assert.strictEqual(cachedRuntime, firstRuntime);

          yield* factory.waitForIdle(projectId);
          yield* factory.invalidateRuntime(projectId, "test clear");
          const rebuiltRuntime = yield* factory.getOrCreate(
            projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
          );

          assert.notStrictEqual(rebuiltRuntime, firstRuntime);
          assert.deepStrictEqual(calls, ["create", "waitForIdle", "waitForIdle", "create"]);
        }).pipe(Effect.provide(makeFactoryCaptureLayer())),
      ),
    ),
  );

  it.effect("does not surface queued settlement prompts as human PM messages", () => {
    const dispatchCalls: OrchestrationCommand[] = [];
    return Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const events = yield* Queue.unbounded<AgentHarnessEvent>();
          const factory = yield* makePmProjectRuntimeFactoryWithOptions({
            makeDriverPmAdapterOverride: (() =>
              Effect.succeed({
                events: Stream.fromQueue(events),
                isIdle: Effect.succeed(true),
                latestAssistantUsage: Effect.sync(() => undefined),
                start: Effect.void,
                waitForIdle: Effect.void,
                prompt: (text) =>
                  Effect.gen(function* () {
                    const assistant = fauxAssistantMessage("PM handled settlement");
                    yield* Queue.offer(events, {
                      type: "before_agent_start",
                      prompt: text,
                    } as AgentHarnessEvent);
                    yield* Queue.offer(events, {
                      type: "message_start",
                      message: assistant,
                    } satisfies AgentHarnessEvent);
                    yield* Queue.offer(events, {
                      type: "message_end",
                      message: assistant,
                    } satisfies AgentHarnessEvent);
                    return assistant;
                  }),
                followUp: () => Effect.void,
                setModel: () => Effect.void,
                setResources: () => Effect.void,
                abort: Effect.void,
              })) satisfies NonNullable<
              Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
            >["makeDriverPmAdapterOverride"],
          });

          const runtime = yield* factory.getOrCreate(
            projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
          );
          yield* runtime.enqueue("settlement re-entry payload");
          yield* runtime.drain;
          for (
            let index = 0;
            index < 20 &&
            !dispatchCalls.some((command) => command.type === "thread.message.assistant.complete");
            index += 1
          ) {
            yield* Effect.yieldNow;
          }

          assert.deepStrictEqual(
            dispatchCalls
              .map((command) => command.type)
              .filter((type) => type !== "thread.session.set"),
            [
              "thread.create",
              "thread.message.assistant.delta",
              "thread.message.assistant.complete",
            ],
          );
          assert.strictEqual(
            dispatchCalls.some((command) => command.type === "thread.message.user.append"),
            false,
          );
          yield* Queue.shutdown(events);
        }).pipe(Effect.provide(makeFactoryCaptureLayer({ dispatchCalls }))),
      ),
    );
  });

  it.effect("applies same-provider PM model changes in place after the current turn", () =>
    Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const domainEvents = yield* Queue.unbounded<OrchestrationEvent>();
          const calls: string[] = [];
          const promptEntered = yield* Deferred.make<void>();
          const releasePrompt = yield* Deferred.make<void>();
          const eventSeen = yield* Deferred.make<void>();
          const modelSwitched = yield* Deferred.make<void>();

          yield* Effect.gen(function* () {
            const factory = yield* makePmProjectRuntimeFactoryWithOptions({
              makeDriverPmAdapterOverride: ((_options: DriverPmAdapterOptions) =>
                Effect.succeed({
                  events: Stream.empty,
                  isIdle: Effect.succeed(true),
                  latestAssistantUsage: Effect.sync(() => undefined),
                  start: Effect.void,
                  waitForIdle: Effect.sync(() => {
                    calls.push("waitForIdle");
                  }),
                  prompt: () =>
                    Effect.gen(function* () {
                      calls.push("prompt:start");
                      yield* Deferred.succeed(promptEntered, void 0);
                      yield* Deferred.await(releasePrompt);
                      calls.push("prompt:end");
                      return fauxAssistantMessage("ok");
                    }),
                  followUp: () => Effect.void,
                  setModel: (model) =>
                    Effect.gen(function* () {
                      calls.push(`setModel:${model.id}`);
                      yield* Deferred.succeed(modelSwitched, void 0);
                    }),
                  setResources: () => Effect.void,
                  abort: Effect.void,
                })) satisfies NonNullable<
                Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
              >["makeDriverPmAdapterOverride"],
            });

            const runtime = yield* factory.getOrCreate(
              projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
            );
            yield* runtime.enqueue("stage result");
            const drain = yield* runtime.drain.pipe(Effect.forkScoped);
            yield* Deferred.await(promptEntered);

            yield* Queue.offer(
              domainEvents,
              projectMetaUpdatedEvent({
                sequence: 101,
                instanceId: "claudeAgent",
                model: "claude-opus-4-8",
              }),
            );
            yield* Deferred.await(eventSeen);
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;

            assert.deepStrictEqual(calls, ["prompt:start"]);

            yield* Deferred.succeed(releasePrompt, void 0);
            yield* Fiber.join(drain);
            yield* Deferred.await(modelSwitched);

            assert.deepStrictEqual(calls, [
              "prompt:start",
              "prompt:end",
              "waitForIdle",
              "setModel:claude-opus-4-8",
            ]);
            yield* Queue.shutdown(domainEvents);
          }).pipe(
            Effect.provide(
              makeFactoryCaptureLayer({
                streamDomainEvents: Stream.fromQueue(domainEvents).pipe(
                  Stream.tap(() => Deferred.succeed(eventSeen, void 0)),
                ),
              }),
            ),
          );
        }),
      ),
    ),
  );

  it.effect("switches the PM model in place after the adapter is idle", () =>
    Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const calls: string[] = [];
          const modelSwitched = yield* Deferred.make<void>();
          const factory = yield* makePmProjectRuntimeFactoryWithOptions({
            makeDriverPmAdapterOverride: (() =>
              Effect.succeed({
                events: Stream.empty,
                isIdle: Effect.succeed(true),
                latestAssistantUsage: Effect.sync(() => undefined),
                start: Effect.void,
                waitForIdle: Effect.sync(() => {
                  calls.push("waitForIdle");
                }),
                prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                followUp: () => Effect.void,
                setModel: (model) =>
                  Effect.gen(function* () {
                    calls.push(`setModel:${model.id}`);
                    yield* Deferred.succeed(modelSwitched, void 0);
                  }),
                setResources: () => Effect.void,
                abort: Effect.void,
              })) satisfies NonNullable<
              Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
            >["makeDriverPmAdapterOverride"],
          });

          yield* factory.getOrCreate(projectWithPmModel("claudeAgent", "claude-sonnet-4-6"));
          yield* Deferred.await(modelSwitched);

          assert.deepStrictEqual(calls, ["waitForIdle", "setModel:claude-opus-4-8"]);
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              streamDomainEvents: Stream.fromIterable([
                projectMetaUpdatedEvent({
                  sequence: 102,
                  instanceId: "claudeAgent",
                  model: "claude-opus-4-8",
                }),
              ]),
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("ignores PM model selection updates that do not change the live config", () =>
    Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const domainEvents = yield* Queue.unbounded<OrchestrationEvent>();
          const calls: string[] = [];
          const eventSeen = yield* Deferred.make<void>();
          yield* Effect.gen(function* () {
            const factory = yield* makePmProjectRuntimeFactoryWithOptions({
              makeDriverPmAdapterOverride: (() =>
                Effect.succeed({
                  events: Stream.empty,
                  isIdle: Effect.succeed(true),
                  latestAssistantUsage: Effect.sync(() => undefined),
                  start: Effect.void,
                  waitForIdle: Effect.sync(() => {
                    calls.push("waitForIdle");
                  }),
                  prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                  followUp: () => Effect.void,
                  setModel: (model) =>
                    Effect.sync(() => {
                      calls.push(`setModel:${model.id}`);
                    }),
                  setResources: () => Effect.void,
                  abort: Effect.void,
                })) satisfies NonNullable<
                Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
              >["makeDriverPmAdapterOverride"],
            });

            yield* factory.getOrCreate(projectWithPmModel("claudeAgent", "claude-sonnet-4-6"));
            yield* Queue.offer(
              domainEvents,
              projectMetaUpdatedEvent({
                sequence: 103,
                instanceId: "claudeAgent",
                model: "claude-sonnet-4-6",
              }),
            );
            yield* Deferred.await(eventSeen);
            yield* Effect.yieldNow;
            yield* Effect.yieldNow;

            assert.deepStrictEqual(calls, []);
            yield* Queue.shutdown(domainEvents);
          }).pipe(
            Effect.provide(
              makeFactoryCaptureLayer({
                streamDomainEvents: Stream.fromQueue(domainEvents).pipe(
                  Stream.tap(() => Deferred.succeed(eventSeen, void 0)),
                ),
              }),
            ),
          );
        }),
      ),
    ),
  );

  it.effect("invalidates the cached PM runtime when the provider instance changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: string[] = [];
        const invalidated = yield* Deferred.make<void>();
        const factory = yield* makePmProjectRuntimeFactoryWithOptions({
          makeDriverPmAdapterOverride: ((options: DriverPmAdapterOptions) =>
            Effect.sync(() => {
              captured.push(`${options.modelSelection.instanceId}:${options.modelSelection.model}`);
              return {
                events: Stream.empty,
                isIdle: Effect.succeed(true),
                latestAssistantUsage: Effect.sync(() => undefined),
                start: Effect.void,
                waitForIdle: Deferred.succeed(invalidated, void 0).pipe(Effect.asVoid),
                prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                followUp: () => Effect.void,
                setModel: () => Effect.void,
                setResources: () => Effect.void,
                abort: Effect.void,
              };
            })) satisfies NonNullable<
            Parameters<typeof makePmProjectRuntimeFactoryWithOptions>[0]
          >["makeDriverPmAdapterOverride"],
        });

        const first = yield* factory.getOrCreate(
          projectWithPmModel("claudeAgent", "claude-sonnet-4-6"),
        );
        yield* Deferred.await(invalidated);

        let second = first;
        for (let index = 0; index < 20 && second === first; index += 1) {
          yield* Effect.yieldNow;
          second = yield* factory.getOrCreate(
            projectWithPmModel("claude_work", "claude-sonnet-4-6"),
          );
        }

        assert.notStrictEqual(second, first);
        assert.deepStrictEqual(captured, [
          "claudeAgent:claude-sonnet-4-6",
          "claude_work:claude-sonnet-4-6",
        ]);
      }).pipe(
        Effect.provide(
          makeFactoryCaptureLayer({
            streamDomainEvents: Stream.fromIterable([
              projectMetaUpdatedEvent({
                sequence: 104,
                instanceId: "claude_work",
                model: "claude-sonnet-4-6",
              }),
            ]),
          }),
        ),
      ),
    ),
  );

  it.effect("records reconciliation sweep and PM re-entry durability metrics", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        // Let the forked reconciliation sweep run at least once.
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      const snapshots = yield* Metric.snapshot;
      // One PM re-entry turn for the single replayed settlement.
      assert.strictEqual(histogramCount(snapshots, "t3_orchestration_pm_reentry_duration"), 1);
      // The reconciliation sweep ran at least once after startup.
      assert.ok(counterCount(snapshots, "t3_orchestration_reconciliation_sweeps_total") >= 1);
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
  );

  it.effect("replays duplicate settled worker stages exactly once", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent, stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      assert.match(messages[0] ?? "", /A detached worker stage completed/);
      assert.notMatch(messages[0] ?? "", /sk-live-secret/);
      assert.match(messages[0] ?? "", /OPENAI_API_KEY=\[REDACTED\]/);
      assert.strictEqual(consumeCalls.length, 1);
    }),
  );

  it.effect("notifies the PM when a worker stage is blocked on quota", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageBlockedEvent, stageBlockedEvent],
        consumed,
        messages,
        consumeCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      assert.match(messages[0] ?? "", /A worker stage paused on subscription quota/);
      assert.match(messages[0] ?? "", /Provider instance: codex/);
      assert.deepStrictEqual(
        consumeCalls.map((call) => ({
          projectId: call.projectId,
          kind: call.kind,
          settlementKey: call.settlementKey,
        })),
        [{ projectId, kind: "stage", settlementKey: quotaBlockedSettlementKey }],
      );
    }),
  );

  it.effect("notifies the PM exactly once when restart recovery interrupts a stage", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageInterruptedEvent, stageInterruptedEvent],
        consumed,
        messages,
        consumeCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      assert.match(
        messages[0] ?? "",
        /worker stage was interrupted during server restart recovery/,
      );
      assert.match(messages[0] ?? "", /Retry the same role with a fresh worker handoff/);
      assert.deepStrictEqual(
        consumeCalls.map((call) => ({
          projectId: call.projectId,
          kind: call.kind,
          settlementKey: call.settlementKey,
        })),
        [{ projectId, kind: "stage", settlementKey: interruptedSettlementKey }],
      );
    }),
  );

  // WP-Q5: when the PM's own provider instance is quota-blocked, re-entry is held
  // BEFORE the settlement is consumed — nothing is delivered to the PM and nothing
  // is consumed, so the reconciliation sweep re-drives it once quota recovers
  // (preserving exactly-once). The PM runs on the configured Claude provider
  // instance in the test project config.
  it.effect("holds PM re-entry while the PM provider instance is quota-blocked", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        providerQuotaStatuses: new Map([[String(claudeInstanceId), "blocked-until"]]),
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 0);
      assert.strictEqual(consumeCalls.length, 0);
    }),
  );

  it.effect("buffers live restart-window duplicates until after historical replay", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const readEventCursors: number[] = [];
      const layer = makeLayer({
        liveEvents: [stageCompletedEvent],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        readEventCursors,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(readEventCursors[0], 0);
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(consumeCalls.length, 1);
    }),
  );

  it.effect("starts historical replay from the durable project cursor", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const readEventCursors: number[] = [];
      const cursorByProject = new Map<string, number>([
        [String(projectId), stageCompletedEvent.sequence],
      ]);
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        cursorByProject,
        readEventCursors,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(readEventCursors[0], stageCompletedEvent.sequence);
      assert.deepStrictEqual(messages, []);
      assert.deepStrictEqual(consumeCalls, []);
    }),
  );

  it.effect(
    "redrives pending settlements through the project runtime even when the cursor would skip them",
    () =>
      Effect.gen(function* () {
        const consumed = new Set<string>();
        const messages: string[] = [];
        const consumeCalls: ConsumePmSettlementInput[] = [];
        const markActedCalls: MarkPmSettlementActedInput[] = [];
        const pendingSettlements: PmConsumedSettlement[] = [
          {
            projectId,
            kind: "stage",
            settlementKey: "thread-stage-1::turn-1",
            consumedAt: now,
            status: "pending",
          },
        ];
        const cursorByProject = new Map<string, number>([
          [String(projectId), stageCompletedEvent.sequence],
        ]);
        const layer = makeLayer({
          liveEvents: [],
          historicalEvents: [stageCompletedEvent],
          consumed,
          messages,
          consumeCalls,
          markActedCalls,
          pendingSettlements,
          cursorByProject,
        });

        yield* Effect.gen(function* () {
          const runtime = yield* PmRuntime;
          yield* runtime.start();
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;
          yield* runtime.drain;
        }).pipe(Effect.scoped, Effect.provide(layer));

        assert.strictEqual(messages.length, 1);
        assert.match(messages[0] ?? "", /A detached worker stage completed/);
        assert.deepStrictEqual(consumeCalls, []);
        assert.deepStrictEqual(
          markActedCalls.map((call) => ({
            projectId: call.projectId,
            kind: call.kind,
            settlementKey: call.settlementKey,
          })),
          [{ projectId, kind: "stage", settlementKey: "thread-stage-1::turn-1" }],
        );
        assert.deepStrictEqual(pendingSettlements, []);
      }),
  );

  it.effect("resumes quota-blocked stages during reconciliation when the provider is ok", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const dispatchCalls: unknown[] = [];
      const quotaBlockedStage: OrchestrationReadModel["quotaBlockedStages"][number] = {
        taskId,
        stageThreadId,
        role: "work",
        providerInstanceId: ProviderInstanceId.make("codex"),
        resetAt: null,
        status: "blocked",
        retryCount: 1,
        blockedAt: now,
        resumedAt: null,
      };
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [],
        consumed,
        messages,
        consumeCalls,
        commandReadModel: {
          ...readModel,
          tasks: [
            {
              ...task,
              status: "blocked-on-quota",
              currentStageThreadId: null,
            },
          ],
          quotaBlockedStages: [quotaBlockedStage],
        },
        quotaBlockedStages: [quotaBlockedStage],
        providerQuotaStatuses: new Map([[String(ProviderInstanceId.make("codex")), "ok"]]),
        dispatchCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        for (let index = 0; index < 20 && dispatchCalls.length === 0; index += 1) {
          yield* Effect.yieldNow;
        }
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(dispatchCalls.length, 1);
      const command = dispatchCalls[0] as Record<string, unknown>;
      assert.strictEqual(command.type, "task.stage.start");
      assert.strictEqual(command.commandId, quotaStageResumeCommandId(stageThreadId, 1));
      assert.strictEqual(command.taskId, taskId);
      assert.strictEqual(command.role, "work");
      assert.strictEqual(command.instructions, "Implement feature");
      assert.strictEqual(typeof command.createdAt, "string");
    }),
  );

  it.effect("continues quota resume reconciliation after one stage dispatch fails", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const dispatchCalls: unknown[] = [];
      const secondTaskId = TaskId.make("task-2");
      const secondStageThreadId = ThreadId.make("thread-stage-2");
      const secondStageThread: OrchestrationThread = {
        ...stageThread,
        id: secondStageThreadId,
        title: "Implement second feature (work)",
        messages: [
          {
            id: MessageId.make("user-2"),
            role: "user",
            text: "Implement second feature",
            attachments: [],
            turnId: null,
            streaming: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      };
      const firstBlockedStage: OrchestrationReadModel["quotaBlockedStages"][number] = {
        taskId,
        stageThreadId,
        role: "work",
        providerInstanceId: ProviderInstanceId.make("codex"),
        resetAt: null,
        status: "blocked",
        retryCount: 1,
        blockedAt: now,
        resumedAt: null,
      };
      const secondBlockedStage: OrchestrationReadModel["quotaBlockedStages"][number] = {
        taskId: secondTaskId,
        stageThreadId: secondStageThreadId,
        role: "work",
        providerInstanceId: ProviderInstanceId.make("codex"),
        resetAt: null,
        status: "blocked",
        retryCount: 1,
        blockedAt: "2026-06-14T10:01:00.000Z",
        resumedAt: null,
      };
      const firstResumeCommandId = quotaStageResumeCommandId(stageThreadId, 1);
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [],
        consumed,
        messages,
        consumeCalls,
        commandReadModel: {
          ...readModel,
          tasks: [
            { ...task, status: "blocked-on-quota", currentStageThreadId: null },
            {
              ...task,
              id: secondTaskId,
              title: "Implement second feature",
              status: "blocked-on-quota",
              stageThreadIds: [secondStageThreadId],
              currentStageThreadId: null,
            },
          ],
          quotaBlockedStages: [firstBlockedStage, secondBlockedStage],
        },
        quotaBlockedStages: [firstBlockedStage, secondBlockedStage],
        providerQuotaStatuses: new Map([[String(ProviderInstanceId.make("codex")), "ok"]]),
        threadDetails: new Map([[String(secondStageThreadId), secondStageThread]]),
        dispatchFailureCommandIds: new Set([String(firstResumeCommandId)]),
        dispatchCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        for (let index = 0; index < 50 && dispatchCalls.length === 0; index += 1) {
          yield* Effect.yieldNow;
        }
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(dispatchCalls.length, 1);
      const command = dispatchCalls[0] as Record<string, unknown>;
      assert.strictEqual(command.type, "task.stage.start");
      assert.strictEqual(command.commandId, quotaStageResumeCommandId(secondStageThreadId, 1));
      assert.strictEqual(command.taskId, secondTaskId);
      assert.strictEqual(command.instructions, "Implement second feature");
    }),
  );

  // WP-Q7: the sweep's quota metric taps (gauge sampling, resumed counter,
  // blocked-duration timer) must never break the resume path or the sweep — a
  // throwing tap would silently fail reconciliation. This pins that the sweep
  // still resumes the blocked stage and completes with the taps in place.
  it.effect("quota metric taps do not break the resume reconciliation sweep", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const dispatchCalls: unknown[] = [];
      const quotaBlockedStage: OrchestrationReadModel["quotaBlockedStages"][number] = {
        taskId,
        stageThreadId,
        role: "work",
        providerInstanceId: ProviderInstanceId.make("codex"),
        resetAt: null,
        status: "blocked",
        retryCount: 1,
        blockedAt: "2026-01-01T00:00:00.000Z",
        resumedAt: null,
      };
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [],
        consumed,
        messages,
        consumeCalls,
        commandReadModel: {
          ...readModel,
          tasks: [{ ...task, status: "blocked-on-quota", currentStageThreadId: null }],
          quotaBlockedStages: [quotaBlockedStage],
        },
        quotaBlockedStages: [quotaBlockedStage],
        providerQuotaStatuses: new Map([[String(ProviderInstanceId.make("codex")), "ok"]]),
        dispatchCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        // Wait for the forked sweep to resume the blocked stage (proven by the
        // dispatch), then let its tail (the resumed counter + gauges) settle.
        for (let index = 0; index < 50 && dispatchCalls.length === 0; index += 1) {
          yield* Effect.yieldNow;
        }
        yield* runtime.drain;
        for (let index = 0; index < 10; index += 1) {
          yield* Effect.yieldNow;
        }
      }).pipe(Effect.scoped, Effect.provide(layer));

      const snapshots = yield* Metric.snapshot;
      // The blocked stage was resumed (its instance recovered)...
      assert.strictEqual(dispatchCalls.length, 1, "resume should have dispatched");
      // ...and the sweep ran to completion with the quota metric taps in place.
      assert.ok(
        counterCount(snapshots, "t3_orchestration_reconciliation_sweeps_total") >= 1,
        "sweep completed",
      );
    }).pipe(Effect.provideService(Metric.MetricRegistry, new Map())),
  );

  // WP-Q6 (auto-resume-at-reset): the sweep optimistically clears a
  // `blocked-until` instance to `ok` once its reset has elapsed, but leaves a
  // future reset and a `blocked-unknown` instance (no trustworthy reset) alone.
  it.effect("clears only blocked-until instances whose reset has elapsed", () =>
    Effect.gen(function* () {
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const quotaUpsertCalls: UpsertProviderQuotaStatusInput[] = [];
      const consumed = new Set<string>();
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [],
        consumed,
        messages,
        consumeCalls,
        providerQuotaBlockedRows: [
          {
            providerInstanceId: ProviderInstanceId.make("codex"),
            status: "blocked-until",
            // The sweep runs under @effect/vitest's TestClock (epoch 0), so this
            // reset is already due.
            resetAt: "1970-01-01T00:00:00.000Z",
            updatedAt: now,
          },
          {
            providerInstanceId: ProviderInstanceId.make("claudeAgent"),
            status: "blocked-until",
            resetAt: "2099-01-01T00:00:00.000Z",
            updatedAt: now,
          },
          {
            providerInstanceId: ProviderInstanceId.make("opencode"),
            status: "blocked-unknown",
            resetAt: null,
            updatedAt: now,
          },
        ],
        quotaUpsertCalls,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        for (let index = 0; index < 50 && quotaUpsertCalls.length === 0; index += 1) {
          yield* Effect.yieldNow;
        }
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      // Only the elapsed `codex` instance is cleared — back to ok with no reset.
      assert.strictEqual(quotaUpsertCalls.length, 1);
      assert.strictEqual(
        String(quotaUpsertCalls[0]?.providerInstanceId),
        String(ProviderInstanceId.make("codex")),
      );
      assert.strictEqual(quotaUpsertCalls[0]?.status, "ok");
      assert.strictEqual(quotaUpsertCalls[0]?.resetAt, null);
    }),
  );

  it.effect("captures the worker diff (scrubbed + bounded) in the stage settlement message", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        latestCheckpointTurnCount: 2,
        fullThreadDiff: {
          threadId: stageThreadId,
          fromTurnCount: 0,
          toTurnCount: 2,
          diff: `diff --git a/src/a.ts b/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-const a = 1;
+const a = 2;
diff --git a/.env b/.env
+++ b/.env
@@ -0,0 +1 @@
+OPENAI_API_KEY=sk-live-secret
`,
        },
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      const message = messages[0] ?? "";
      assert.match(message, /A detached worker stage completed/);
      // Structured diff fields are present.
      assert.match(message, /Diff summary: 2 files changed/);
      assert.match(message, /----- BEGIN WORKER DIFF \(untrusted\) -----/);
      assert.match(message, /----- END WORKER DIFF -----/);
      // Secrets in the diff are scrubbed (never leaked into PM context).
      assert.notMatch(message, /sk-live-secret/);
      assert.match(message, /OPENAI_API_KEY=\[REDACTED\]/);
      // The serialized envelope stays within the documented bound.
      assert.ok(message.length <= 12_000 + "\n[truncated]".length);
    }),
  );

  it.effect("produces a stage envelope without a diff section when no diff context exists", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        // Default latestCheckpointTurnCount = 0 → getFullThreadDiffContext None.
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      const message = messages[0] ?? "";
      assert.match(message, /A detached worker stage completed/);
      assert.match(message, /Diff summary: \(no diff was captured for this stage\)/);
      assert.notMatch(message, /BEGIN WORKER DIFF/);
    }),
  );

  it.effect("degrades to no diff section when the checkpoint diff read fails", () =>
    Effect.gen(function* () {
      const consumed = new Set<string>();
      const messages: string[] = [];
      const consumeCalls: ConsumePmSettlementInput[] = [];
      const layer = makeLayer({
        liveEvents: [],
        historicalEvents: [stageCompletedEvent],
        consumed,
        messages,
        consumeCalls,
        latestCheckpointTurnCount: 1,
        fullThreadDiffFails: true,
      });

      yield* Effect.gen(function* () {
        const runtime = yield* PmRuntime;
        yield* runtime.start();
        yield* runtime.drain;
      }).pipe(Effect.scoped, Effect.provide(layer));

      assert.strictEqual(messages.length, 1);
      const message = messages[0] ?? "";
      // A valid settlement message is still produced (settlement never fails).
      assert.match(message, /A detached worker stage completed/);
      assert.match(message, /Diff summary: \(no diff was captured for this stage\)/);
      assert.notMatch(message, /BEGIN WORKER DIFF/);
      assert.strictEqual(consumeCalls.length, 1);
    }),
  );
});

describe("buildPmSystemPrompt", () => {
  it("scopes the Claude prompt to the project and keeps the interactive question guidance", () => {
    const prompt = buildPmSystemPrompt(project, claudeDriver);
    assert.include(prompt, String(project.id));
    assert.include(prompt, "Project");
    assert.include(prompt, "/tmp/project");
    assert.include(prompt, "never ask the human for a project id");
    // Delegation framing: the PM orchestrates and never does the work itself.
    assert.include(prompt, "full tool access");
    assert.include(prompt, "Never implement product changes yourself");
    assert.include(prompt, "handoffWorker");
    assert.include(prompt, "steerStage");
    assert.include(prompt, "Poll inspectStage");
    assert.notInclude(prompt, "READ-ONLY");
    assert.notInclude(prompt, "NO shell");
    // Role guidance is preserved.
    assert.include(prompt, "classify");
    assert.include(prompt, "Use the interactive question tool");
    assert.notInclude(prompt, "For decisions, ask in plain text and end your turn.");
  });

  it("uses plain-text decision guidance for Codex PM prompts", () => {
    const prompt = buildPmSystemPrompt(project, codexDriver);

    assert.include(prompt, String(project.id));
    assert.include(prompt, "For decisions, ask in plain text and end your turn.");
    assert.notInclude(prompt, "Use the interactive question tool");
  });
});
