import {
  OrchestratorProjectConfig,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveAutoCompaction } from "@t3tools/shared/orchestrator";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
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
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { makeDenyingExecutionEnv } from "../pi/DenyingExecutionEnv.ts";
import { PmRuntimeError } from "../pi/Errors.ts";
import { classifyRuntimeErrorClass } from "../../provider/rateLimits.ts";
import {
  makePiAgentAdapter,
  type PiAgentAdapterOptions,
  type PiAgentAdapterShape,
} from "../pi/PiAgentAdapter.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "../pi/PmEventProjection.ts";
import { pmQuotaPausedActivityCommandId, pmQuotaPausedActivityId } from "../stageResolution.ts";
import { resolvePiApiKey, resolvePiModel, resolvePiProvider } from "../pi/PmModelResolver.ts";
import { makePmReEntryQueue } from "../pi/PmReEntryQueue.ts";
import { makePmTools } from "../pi/pmTools.ts";
import { repairDanglingToolCalls } from "../pi/SessionRepair.ts";
import { makeSqliteSessionStorage } from "../pi/SqliteSessionStorage.ts";
import { resumeQuotaBlockedStageWithServices } from "../quotaStageResumption.ts";
import {
  buildStageResult,
  serializeStageResultToMessage,
  type StageResult,
} from "../StageResultBuilder.ts";
import { boundUntrustedContent } from "../untrustedContent.ts";

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

export interface PmRuntimeLiveOptions {
  readonly reconciliationIntervalMsOverride?: number;
}

export interface PiProjectRuntimeFactoryOptions {
  readonly makePiAgentAdapterOverride?: (
    options: PiAgentAdapterOptions,
  ) => Effect.Effect<PiAgentAdapterShape, never, never>;
}

const decodeOrchestratorConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);
const PM_SYSTEM_PROMPT = [
  "You are the orchestrator project manager.",
  "Use the stage roles precisely: classify assigns type/playbook, plan designs the implementation, review critiques the plan before work, work implements, and verify validates completed work before landing.",
  "Use tools to create tasks, hand off stages, inspect ledgers, and request human approval gates; do not claim a stage is done until the relevant worker settlement is present.",
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
): PiAgentAdapterOptions["resources"] | undefined => {
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

export const makePmRuntime = (options?: PmRuntimeLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
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

export const makePiProjectRuntimeFactoryWithOptions = (options?: PiProjectRuntimeFactoryOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const tools = yield* makePmTools;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const providerQuotaStatusRepository = yield* ProviderQuotaStatusRepository;
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const autoCompactionDefaults = resolveAutoCompaction({
      defaults: settings.orchestratorDefaults,
    });
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
        const resources = resolvePmHarnessResources(
          config.value.taskTypes.map((taskType) => taskType.id),
        );
        const adapter = yield* (options?.makePiAgentAdapterOverride ?? makePiAgentAdapter)({
          env: makeDenyingExecutionEnv(project.workspaceRoot),
          sessionStorage,
          model,
          tools,
          ...(resources !== undefined ? { resources } : {}),
          systemPrompt: PM_SYSTEM_PROMPT,
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
        const pmProviderInstanceId = pmModelSelection.instanceId;
        const pmThreadId = pmThreadIdForProject(project);
        const queue = yield* makePmReEntryQueue(adapter, {
          autoCompaction: {
            ...autoCompactionDefaults,
            contextWindow: model.contextWindow,
          },
          // Detect PM-instance quota exhaustion from the PM's own failed turn. The
          // pi turn failure surfaces as a PmRuntimeError (not a `runtime.error`
          // provider event), so it bypasses the ingestion-path detection that marks
          // worker instances blocked — we classify it here and mark the PM instance
          // blocked so the re-entry gate holds subsequent turns rather than hammering
          // a dry PM.
          onTurnError: (error) =>
            Effect.gen(function* () {
              const causeText =
                error.cause instanceof Error
                  ? error.cause.message
                  : typeof error.cause === "string"
                    ? error.cause
                    : "";
              const message = `${error.detail} ${causeText}`.trim();
              if (
                classifyRuntimeErrorClass({ message, fallback: "provider_error" }) !== "rate_limit"
              ) {
                return;
              }
              const updatedAt = DateTime.formatIso(yield* DateTime.now);
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

export const makePiProjectRuntimeFactory = makePiProjectRuntimeFactoryWithOptions();

export const PiProjectRuntimeFactoryLive = Layer.effect(
  PmProjectRuntimeFactory,
  makePiProjectRuntimeFactory,
);
