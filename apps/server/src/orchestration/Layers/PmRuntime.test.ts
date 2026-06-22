import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationGetFullThreadDiffResult,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
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
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PmProjectRuntimeFactory,
  PmRuntime,
  type PmProjectRuntime,
} from "../Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { quotaStageResumeCommandId } from "../stageResolution.ts";
import { makePmRuntimeLive } from "./PmRuntime.ts";

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
    pmModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
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
  // (preserving exactly-once). The PM runs on the `codex` instance per the test
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
          [String(ProviderInstanceId.make("codex")), "blocked-until"],
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
