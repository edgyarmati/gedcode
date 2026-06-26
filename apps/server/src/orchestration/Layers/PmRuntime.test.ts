import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  PiProviderId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationCommand,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OrchestrationThread,
} from "@t3tools/contracts";
import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { assert, describe, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { CheckpointUnavailableError } from "../../checkpointing/Errors.ts";
import { CheckpointDiffQuery } from "../../checkpointing/Services/CheckpointDiffQuery.ts";
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
import { ServerSettingsService } from "../../serverSettings.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PmProjectRuntimeFactory,
  PmRuntime,
  type PmProjectRuntime,
} from "../Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { PmRuntimeError } from "../pi/Errors.ts";
import type { PiAgentAdapterOptions } from "../pi/PiAgentAdapter.ts";
import { PiOAuthCredentialStore } from "../pi/PiOAuthCredentialStore.ts";
import { quotaStageResumeCommandId } from "../stageResolution.ts";
import {
  buildPmSystemPrompt,
  makePiProjectRuntimeFactoryWithOptions,
  makePmRuntimeLive,
  resolvePmHarnessResources,
} from "./PmRuntime.ts";

const now = "2026-06-14T10:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const stageThreadId = ThreadId.make("thread-stage-1");
const turnId = TurnId.make("turn-1");
const quotaBlockedSettlementKey = `${stageThreadId}::quota-blocked`;

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
    enabled: true,
    pmModelSelection: { piProvider: PiProviderId.make("openai"), model: "gpt-5.5" },
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
  playbookVersion: "feature@v1",
  createdAt: now,
  updatedAt: now,
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
  gedWorkflowEnabled: false,
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
      }),
    ),
    Layer.provide(ServerSettingsService.layerTest()),
  );
};

const makeFactoryCaptureLayer = (input?: {
  readonly streamDomainEvents?: Stream.Stream<OrchestrationEvent>;
  readonly serverSettingsOverrides?: Parameters<typeof ServerSettingsService.layerTest>[0];
  readonly dispatchCalls?: OrchestrationCommand[];
}) =>
  Layer.mergeAll(
    SqlitePersistenceMemory,
    NodeServices.layer,
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
      getThreadDetailById: () => Effect.succeed(Option.none()),
    }),
    Layer.succeed(ProviderQuotaStatusRepository, {
      upsert: () =>
        Effect.succeed({
          providerInstanceId: ProviderInstanceId.make("openai"),
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
    Layer.succeed(PiOAuthCredentialStore, {
      save: () => Effect.void,
      clear: () => Effect.void,
      getAccessToken: () => Effect.succeed("test-oauth-token"),
    }),
    ServerSettingsService.layerTest(input?.serverSettingsOverrides),
  );

const makeCapturingAdapter = (captured: PiAgentAdapterOptions[]) =>
  ((options: PiAgentAdapterOptions) =>
    Effect.sync(() => {
      captured.push(options);
      return {
        events: Stream.empty,
        isIdle: Effect.succeed(true),
        latestAssistantUsage: Effect.sync(() => undefined),
        waitForIdle: Effect.void,
        prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
        followUp: () => Effect.void,
        compact: () =>
          Effect.succeed({
            summary: "summary",
            firstKeptEntryId: "entry-1",
            tokensBefore: 1,
          }),
        setModel: () => Effect.void,
        setResources: () => Effect.void,
        abort: Effect.void,
      };
    })) satisfies NonNullable<
    Parameters<typeof makePiProjectRuntimeFactoryWithOptions>[0]
  >["makePiAgentAdapterOverride"];

const projectWithPmModel = (piProvider: string, model: string): OrchestrationProject => ({
  ...project,
  orchestratorConfig: {
    enabled: true,
    pmModelSelection: {
      piProvider: PiProviderId.make(piProvider),
      model,
    },
  },
});

const projectMetaUpdatedEvent = (input: {
  readonly sequence: number;
  readonly piProvider: string;
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
      enabled: true,
      pmModelSelection: {
        piProvider: PiProviderId.make(input.piProvider),
        model: input.model,
      },
    },
    updatedAt: now,
  },
});

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
      withEnvVars(
        { OPENAI_API_KEY: "env-openai-key" },
        Effect.gen(function* () {
          const captured: PiAgentAdapterOptions[] = [];
          const factory = yield* makePiProjectRuntimeFactoryWithOptions({
            makePiAgentAdapterOverride: makeCapturingAdapter(captured),
          });

          yield* factory.getOrCreate(projectWithPmModel("openai", "gpt-5"));

          assert.strictEqual(captured.length, 1);
          assert.strictEqual(captured[0]?.model.provider, "openai");
          assert.strictEqual(captured[0]?.model.id, "gpt-5");

          const credential = yield* Effect.promise(
            () =>
              captured[0]?.getApiKeyAndHeaders?.(captured[0].model) ?? Promise.resolve(undefined),
          );
          assert.deepStrictEqual(credential, { apiKey: "test-key" });
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              serverSettingsOverrides: {
                orchestratorDefaults: {
                  pmModelSelection: {
                    piProvider: PiProviderId.make("openai"),
                    model: "gpt-5.5",
                  },
                },
                piProviders: {
                  [PiProviderId.make("openai")]: {
                    enabled: true,
                    apiKey: { value: "test-key" },
                  },
                },
              },
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("uses the global PM model selection when the project selection is null", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: PiAgentAdapterOptions[] = [];
        const factory = yield* makePiProjectRuntimeFactoryWithOptions({
          makePiAgentAdapterOverride: makeCapturingAdapter(captured),
        });

        yield* factory.getOrCreate({
          ...project,
          orchestratorConfig: {
            enabled: true,
            pmModelSelection: null,
          },
        });

        assert.strictEqual(captured.length, 1);
        assert.strictEqual(captured[0]?.model.provider, "openai");
        assert.strictEqual(captured[0]?.model.id, "gpt-5");
      }).pipe(
        Effect.provide(
          makeFactoryCaptureLayer({
            serverSettingsOverrides: {
              orchestratorDefaults: {
                pmModelSelection: {
                  piProvider: PiProviderId.make("openai"),
                  model: "gpt-5",
                },
              },
              piProviders: {
                [PiProviderId.make("openai")]: {
                  enabled: true,
                  apiKey: { value: "test-key" },
                },
              },
            },
          }),
        ),
      ),
    ),
  );

  it.effect("leaves a missing PM model selection unconfigured without creating an adapter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const captured: PiAgentAdapterOptions[] = [];
        const factory = yield* makePiProjectRuntimeFactoryWithOptions({
          makePiAgentAdapterOverride: makeCapturingAdapter(captured),
        });

        const error = yield* factory
          .getOrCreate({
            ...project,
            orchestratorConfig: {
              enabled: true,
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
      const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "test-openai-key";
      const captured: PiAgentAdapterOptions[] = [];

      try {
        yield* Effect.gen(function* () {
          const factory = yield* makePiProjectRuntimeFactoryWithOptions({
            makePiAgentAdapterOverride: makeCapturingAdapter(captured),
          });
          yield* factory.getOrCreate({
            ...project,
            orchestratorConfig: {
              enabled: true,
              pmModelSelection: {
                piProvider: PiProviderId.make("openai"),
                model: "gpt-5",
              },
            },
          });
        }).pipe(Effect.scoped, Effect.provide(makeFactoryCaptureLayer()));
      } finally {
        if (previousOpenAiApiKey === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = previousOpenAiApiKey;
        }
      }

      const resolved = defaultPlaybookLoader.resolve("feature");
      assert.ok(resolved);
      assert.strictEqual(captured.length, 1);
      assert.deepStrictEqual(captured[0]?.resources?.skills, [resolved.skill]);
      assert.strictEqual(captured[0]?.resources?.skills?.[0]?.name, resolved.skill.name);
      assert.strictEqual(
        captured[0]?.resources?.skills?.[0]?.description,
        resolved.skill.description,
      );
    }),
  );

  it("omits PM harness resources when no configured playbook resolves", () => {
    assert.strictEqual(resolvePmHarnessResources(["unknown"]), undefined);
  });

  it.effect("does not surface queued settlement prompts as human PM messages", () => {
    const dispatchCalls: OrchestrationCommand[] = [];
    return Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const events = yield* Queue.unbounded<AgentHarnessEvent>();
          const factory = yield* makePiProjectRuntimeFactoryWithOptions({
            makePiAgentAdapterOverride: (() =>
              Effect.succeed({
                events: Stream.fromQueue(events),
                isIdle: Effect.succeed(true),
                latestAssistantUsage: Effect.sync(() => undefined),
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
                compact: () =>
                  Effect.succeed({
                    summary: "summary",
                    firstKeptEntryId: "entry-1",
                    tokensBefore: 1,
                  }),
                setModel: () => Effect.void,
                setResources: () => Effect.void,
                abort: Effect.void,
              })) satisfies NonNullable<
              Parameters<typeof makePiProjectRuntimeFactoryWithOptions>[0]
            >["makePiAgentAdapterOverride"],
          });

          const runtime = yield* factory.getOrCreate(projectWithPmModel("openai", "gpt-5"));
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
            dispatchCalls.map((command) => command.type),
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

  it.effect(
    "applies same-provider PM model changes in place after the current turn and compaction",
    () =>
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
              const factory = yield* makePiProjectRuntimeFactoryWithOptions({
                makePiAgentAdapterOverride: ((_options: PiAgentAdapterOptions) =>
                  Effect.succeed({
                    events: Stream.empty,
                    isIdle: Effect.succeed(true),
                    latestAssistantUsage: Effect.sync(() => undefined),
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
                    compact: () =>
                      Effect.sync(() => {
                        calls.push("compact");
                        return {
                          summary: "summary",
                          firstKeptEntryId: "entry-1",
                          tokensBefore: 1,
                        };
                      }),
                    setModel: (model) =>
                      Effect.gen(function* () {
                        calls.push(`setModel:${model.id}`);
                        yield* Deferred.succeed(modelSwitched, void 0);
                      }),
                    setResources: () => Effect.void,
                    abort: Effect.void,
                  })) satisfies NonNullable<
                  Parameters<typeof makePiProjectRuntimeFactoryWithOptions>[0]
                >["makePiAgentAdapterOverride"],
              });

              const runtime = yield* factory.getOrCreate(projectWithPmModel("openai", "gpt-5"));
              yield* runtime.enqueue("stage result");
              const drain = yield* runtime.drain.pipe(Effect.forkScoped);
              yield* Deferred.await(promptEntered);

              yield* Queue.offer(
                domainEvents,
                projectMetaUpdatedEvent({
                  sequence: 101,
                  piProvider: "openai",
                  model: "gpt-5-mini",
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
                "compact",
                "setModel:gpt-5-mini",
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

  it.effect("still switches the PM model when compact-first fails", () =>
    Effect.scoped(
      withEnvVars(
        { OPENAI_API_KEY: "test-openai-key" },
        Effect.gen(function* () {
          const calls: string[] = [];
          const modelSwitched = yield* Deferred.make<void>();
          const factory = yield* makePiProjectRuntimeFactoryWithOptions({
            makePiAgentAdapterOverride: (() =>
              Effect.succeed({
                events: Stream.empty,
                isIdle: Effect.succeed(true),
                latestAssistantUsage: Effect.sync(() => undefined),
                waitForIdle: Effect.sync(() => {
                  calls.push("waitForIdle");
                }),
                prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                followUp: () => Effect.void,
                compact: () =>
                  Effect.gen(function* () {
                    calls.push("compact");
                    return yield* new PmRuntimeError({
                      operation: "PiAgentAdapter.compact",
                      detail: "PM compaction failed.",
                      cause: new Error("compact failed"),
                    });
                  }),
                setModel: (model) =>
                  Effect.gen(function* () {
                    calls.push(`setModel:${model.id}`);
                    yield* Deferred.succeed(modelSwitched, void 0);
                  }),
                setResources: () => Effect.void,
                abort: Effect.void,
              })) satisfies NonNullable<
              Parameters<typeof makePiProjectRuntimeFactoryWithOptions>[0]
            >["makePiAgentAdapterOverride"],
          });

          yield* factory.getOrCreate(projectWithPmModel("openai", "gpt-5"));
          yield* Deferred.await(modelSwitched);

          assert.deepStrictEqual(calls, ["waitForIdle", "compact", "setModel:gpt-5-mini"]);
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              streamDomainEvents: Stream.fromIterable([
                projectMetaUpdatedEvent({
                  sequence: 102,
                  piProvider: "openai",
                  model: "gpt-5-mini",
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
            const factory = yield* makePiProjectRuntimeFactoryWithOptions({
              makePiAgentAdapterOverride: (() =>
                Effect.succeed({
                  events: Stream.empty,
                  isIdle: Effect.succeed(true),
                  latestAssistantUsage: Effect.sync(() => undefined),
                  waitForIdle: Effect.sync(() => {
                    calls.push("waitForIdle");
                  }),
                  prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                  followUp: () => Effect.void,
                  compact: () =>
                    Effect.sync(() => {
                      calls.push("compact");
                      return {
                        summary: "summary",
                        firstKeptEntryId: "entry-1",
                        tokensBefore: 1,
                      };
                    }),
                  setModel: (model) =>
                    Effect.sync(() => {
                      calls.push(`setModel:${model.id}`);
                    }),
                  setResources: () => Effect.void,
                  abort: Effect.void,
                })) satisfies NonNullable<
                Parameters<typeof makePiProjectRuntimeFactoryWithOptions>[0]
              >["makePiAgentAdapterOverride"],
            });

            yield* factory.getOrCreate(projectWithPmModel("openai", "gpt-5"));
            yield* Queue.offer(
              domainEvents,
              projectMetaUpdatedEvent({
                sequence: 103,
                piProvider: "openai",
                model: "gpt-5",
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
      withEnvVars(
        {
          OPENAI_API_KEY: "test-openai-key",
          AZURE_OPENAI_API_KEY: "test-azure-key",
        },
        Effect.gen(function* () {
          const captured: string[] = [];
          const invalidated = yield* Deferred.make<void>();
          const factory = yield* makePiProjectRuntimeFactoryWithOptions({
            makePiAgentAdapterOverride: ((options: PiAgentAdapterOptions) =>
              Effect.sync(() => {
                captured.push(`${options.model.provider}:${options.model.id}`);
                return {
                  events: Stream.empty,
                  isIdle: Effect.succeed(true),
                  latestAssistantUsage: Effect.sync(() => undefined),
                  waitForIdle: Deferred.succeed(invalidated, void 0).pipe(Effect.asVoid),
                  prompt: () => Effect.succeed(fauxAssistantMessage("ok")),
                  followUp: () => Effect.void,
                  compact: () =>
                    Effect.succeed({
                      summary: "summary",
                      firstKeptEntryId: "entry-1",
                      tokensBefore: 1,
                    }),
                  setModel: () => Effect.void,
                  setResources: () => Effect.void,
                  abort: Effect.void,
                };
              })) satisfies NonNullable<
              Parameters<typeof makePiProjectRuntimeFactoryWithOptions>[0]
            >["makePiAgentAdapterOverride"],
          });

          const first = yield* factory.getOrCreate(projectWithPmModel("openai", "gpt-5"));
          yield* Deferred.await(invalidated);

          let second = first;
          for (let index = 0; index < 20 && second === first; index += 1) {
            yield* Effect.yieldNow;
            second = yield* factory.getOrCreate(
              projectWithPmModel("azure-openai-responses", "gpt-5"),
            );
          }

          assert.notStrictEqual(second, first);
          assert.deepStrictEqual(captured, ["openai:gpt-5", "azure-openai-responses:gpt-5"]);
        }).pipe(
          Effect.provide(
            makeFactoryCaptureLayer({
              streamDomainEvents: Stream.fromIterable([
                projectMetaUpdatedEvent({
                  sequence: 104,
                  piProvider: "azure-openai-responses",
                  model: "gpt-5",
                }),
              ]),
            }),
          ),
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

  // WP-Q5: when the PM's own provider instance is quota-blocked, re-entry is held
  // BEFORE the settlement is consumed — nothing is delivered to the PM and nothing
  // is consumed, so the reconciliation sweep re-drives it once quota recovers
  // (preserving exactly-once). The PM runs on the `openai` pi provider per the test
  // project config.
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
        providerQuotaStatuses: new Map([
          [String(ProviderInstanceId.make("openai")), "blocked-until"],
        ]),
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
  it("scopes the prompt to the project and forbids asking for ids", () => {
    const prompt = buildPmSystemPrompt(project);
    assert.include(prompt, String(project.id));
    assert.include(prompt, "Project");
    assert.include(prompt, "/tmp/project");
    assert.include(prompt, "never ask the human for a project id");
    // Existing role guidance is preserved.
    assert.include(prompt, "Use the stage roles precisely");
  });
});
