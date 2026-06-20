import {
  OrchestratorProjectConfig,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
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
  orchestrationReconciliationSettlementsRedrivenTotal,
  orchestrationReconciliationSweepDuration,
  orchestrationReconciliationSweepsTotal,
  withMetrics,
} from "../../observability/Metrics.ts";
import { ProjectionAwaitedStageRepository } from "../../persistence/Services/ProjectionAwaitedStages.ts";
import {
  makeGateSettlementKey,
  makeStageSettlementKey,
  PmRuntimeStateRepository,
  type PmConsumedSettlement,
  type PmConsumedSettlementKind,
} from "../../persistence/Services/PmRuntimeState.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  PmProjectRuntimeFactory,
  PmRuntime,
  type PmProjectRuntime,
  type PmProjectRuntimeFactoryShape,
  type PmRuntimeShape,
} from "../Services/PmRuntime.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makeDenyingExecutionEnv } from "../pi/DenyingExecutionEnv.ts";
import { PmRuntimeError } from "../pi/Errors.ts";
import { makePiAgentAdapter } from "../pi/PiAgentAdapter.ts";
import { makePmEventProjectionRuntime } from "../pi/PmEventProjection.ts";
import { resolvePiApiKey, resolvePiModel, resolvePiProvider } from "../pi/PmModelResolver.ts";
import { makePmReEntryQueue } from "../pi/PmReEntryQueue.ts";
import { makePmTools } from "../pi/pmTools.ts";
import { repairDanglingToolCalls } from "../pi/SessionRepair.ts";
import { makeSqliteSessionStorage } from "../pi/SqliteSessionStorage.ts";
import {
  buildStageResult,
  serializeStageResultToMessage,
  type StageResult,
} from "../StageResultBuilder.ts";
import { boundUntrustedContent } from "../untrustedContent.ts";

type SettlementEvent = Extract<
  OrchestrationEvent,
  { type: "task.stage-completed" | "task.gate-resolved" }
>;

type SettlementEnvelope = {
  readonly event: SettlementEvent;
  readonly project: OrchestrationProject;
  readonly task: OrchestrationTask;
  readonly kind: "stage" | "gate";
  readonly settlementKey: string;
  readonly message: string;
};

export interface PmRuntimeLiveOptions {
  readonly reconciliationIntervalMsOverride?: number;
}

const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);

const isSettlementEvent = (event: OrchestrationEvent): event is SettlementEvent =>
  event.type === "task.stage-completed" || event.type === "task.gate-resolved";

const settlementEventKind = (event: SettlementEvent): PmConsumedSettlementKind =>
  event.type === "task.stage-completed" ? "stage" : "gate";

const settlementEventKey = (event: SettlementEvent): string =>
  event.type === "task.stage-completed"
    ? makeStageSettlementKey({
        stageThreadId: event.payload.stageThreadId,
        awaitedTurnId: event.payload.awaitedTurnId,
      })
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

const makeNoPmRuntimeError = (detail: string, cause?: unknown): PmRuntimeError =>
  new PmRuntimeError({
    operation: "PmProjectRuntimeFactory.getOrCreate",
    detail,
    ...(cause !== undefined ? { cause } : {}),
  });

export const makePmRuntime = (options?: PmRuntimeLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const projectionAwaitedStageRepository = yield* ProjectionAwaitedStageRepository;
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

        return {
          stageKeys,
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

    const runReconciliationSweep = reconciliationSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        const events = yield* readSettlementEvents();
        let neverConsumedCount = 0;
        let pendingActedCount = 0;

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

        const redrivenCount = neverConsumedCount + pendingActedCount;
        if (redrivenCount > 0) {
          yield* increment(orchestrationReconciliationSettlementsRedrivenTotal, {}, redrivenCount);
          yield* Effect.logInfo("PM runtime reconciliation sweep completed", {
            neverConsumedCount,
            pendingActedCount,
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

export const makePiProjectRuntimeFactory = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tools = yield* makePmTools;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const runtimeScope = yield* Scope.make("sequential");
  yield* Effect.addFinalizer(() => Scope.close(runtimeScope, Exit.void));
  const runtimes = new Map<string, PmProjectRuntime>();

  const getOrCreate: PmProjectRuntimeFactoryShape["getOrCreate"] = (project) =>
    Effect.gen(function* () {
      const key = String(project.id);
      const existing = runtimes.get(key);
      if (existing !== undefined) {
        return existing;
      }

      const config = resolveProjectConfig(project);
      if (Option.isNone(config) || config.value.enabled !== true) {
        return yield* makeNoPmRuntimeError(
          `Orchestrator mode is not enabled for project '${project.id}'.`,
        );
      }
      const pmModelSelection = config.value.pmModelSelection;
      if (pmModelSelection === null) {
        return yield* makeNoPmRuntimeError(
          `Project '${project.id}' has no PM model selection configured.`,
        );
      }

      const provider = resolvePiProvider(String(pmModelSelection.instanceId));
      const model = resolvePiModel(provider, pmModelSelection.model);
      if (model === undefined) {
        return yield* makeNoPmRuntimeError(
          `PM model '${pmModelSelection.model}' was not found for provider '${provider}'.`,
        );
      }
      const apiKey = resolvePiApiKey(provider);
      if (apiKey === undefined) {
        return yield* makeNoPmRuntimeError(
          `No PM API key is configured for provider '${provider}'.`,
        );
      }

      const sessionStorage = yield* makeSqliteSessionStorage({
        sessionId: `pm:${project.id}`,
        metadata: {
          projectId: String(project.id),
          workspaceRoot: project.workspaceRoot,
        },
        createdAt: project.createdAt,
      }).pipe(Effect.provideService(SqlClient.SqlClient, sql));
      const repairedToolCallCount = yield* repairDanglingToolCalls({
        storage: sessionStorage,
        reason: "pm-runtime-startup",
      });
      if (repairedToolCallCount > 0) {
        yield* Effect.logInfo("PM session dangling tool calls repaired", {
          projectId: String(project.id),
          repairedToolCallCount,
        });
      }
      const adapter = yield* makePiAgentAdapter({
        env: makeDenyingExecutionEnv(project.workspaceRoot),
        sessionStorage,
        model,
        tools,
        getApiKeyAndHeaders: async () => ({ apiKey }),
      });
      const eventProjection = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: adapter.events,
      }).pipe(
        Effect.provideService(OrchestrationEngineService, orchestrationEngine),
        Effect.provideService(ProjectionSnapshotQuery, projectionSnapshotQuery),
        Scope.provide(runtimeScope),
      );
      const queue = yield* makePmReEntryQueue(adapter);
      const runtime: PmProjectRuntime = {
        enqueue: queue.enqueue,
        drain: queue.drain.pipe(Effect.andThen(eventProjection.drain)),
      };
      runtimes.set(key, runtime);
      return runtime;
    });

  return {
    getOrCreate,
  } satisfies PmProjectRuntimeFactoryShape;
});

export const PiProjectRuntimeFactoryLive = Layer.effect(
  PmProjectRuntimeFactory,
  makePiProjectRuntimeFactory,
);
