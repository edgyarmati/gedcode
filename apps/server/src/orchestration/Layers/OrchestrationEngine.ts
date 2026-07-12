import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationShellStreamEvent,
  ProjectId,
  TaskId,
} from "@t3tools/contracts";
import { OrchestrationCommand, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  metricAttributes,
  orchestrationCommandAckDuration,
  orchestrationCommandQueueDepth,
  orchestrationCommandQueueWaitDuration,
  orchestrationCommandsTotal,
  orchestrationCommandDuration,
} from "../../observability/Metrics.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import { withBusyRetry } from "../../persistence/retryPolicy.ts";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepository } from "../../persistence/Services/OrchestrationCommandReceipts.ts";
import {
  OrchestrationCommandInvariantError,
  OrchestrationCommandPreviouslyRejectedError,
  type OrchestrationDispatchError,
  type OrchestrationProjectorDecodeError,
} from "../Errors.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
const isOrchestrationCommandPreviouslyRejectedError = Schema.is(
  OrchestrationCommandPreviouslyRejectedError,
);
const isOrchestrationCommandInvariantError = Schema.is(OrchestrationCommandInvariantError);

interface CommandEnvelope {
  command: OrchestrationCommand;
  result: Deferred.Deferred<{ sequence: number }, OrchestrationDispatchError>;
  startedAtMs: number;
  // Enqueue timestamp, captured when the envelope is offered to the single
  // serialized dispatch queue. Used purely for the WP-7 queue-wait metric
  // (time spent waiting behind the in-flight command). Distinct from
  // `startedAtMs` so the ack-latency anchor and the queue-wait anchor stay
  // independent even though they currently coincide.
  enqueuedAtMs: number;
}

/**
 * Coarse command class for queue-contention measurement (WP-7).
 *
 * MEASUREMENT ONLY. This classifier exists so the WP-7 queue metrics can be
 * sliced by the kind of work flowing through the single serialized dispatch
 * queue. It does NOT influence dispatch ordering or serialization — it is a
 * pure, total function over the command type used solely as a metric label to
 * inform a FUTURE lane-split decision.
 *
 * Classes:
 * - `streaming`: high-frequency, internally-generated thread writes that
 *   accompany an active turn (message deltas/appends, activity, plan upserts).
 *   These are the prime candidate for a dedicated lane.
 * - `turn`: turn lifecycle and interactive responses (start/interrupt/diff,
 *   approvals, user-input, checkpoint/revert).
 * - `thread-control`: thread create/delete/archive and mode/session control.
 * - `project`: project lifecycle.
 * - `task`: task lifecycle and gating.
 */
export type OrchestrationCommandClass =
  | "streaming"
  | "turn"
  | "thread-control"
  | "project"
  | "task";

export function classifyOrchestrationCommand(
  command: OrchestrationCommand,
): OrchestrationCommandClass {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return "project";
    case "task.create":
    case "task.classify":
    case "task.role-selections.set":
    case "task.stage.start":
    case "task.stage.complete":
    case "task.stage.block":
    case "task.stage.interrupt":
    case "task.gate.request":
    case "task.gate.resolve":
    case "task.land":
    case "task.landing.retry":
    case "task.pr.opened":
    case "task.pr.open.failed":
    case "task.abandon":
    case "task.cancellation.request":
    case "task.cancellation.fail":
    case "task.cancellation.phase.complete":
      return "task";
    case "thread.message.user.append":
    case "thread.message.assistant.delta":
    case "thread.message.assistant.complete":
    case "thread.clear":
    case "thread.pm-handoff.request":
    case "thread.pm-handoff.complete":
    case "thread.proposed-plan.upsert":
    case "thread.activity.append":
      return "streaming";
    case "thread.turn.start":
    case "thread.turn.interrupt":
    case "thread.turn.diff.complete":
    case "thread.approval.respond":
    case "thread.user-input.respond":
    case "thread.checkpoint.revert":
    case "thread.revert.complete":
      return "turn";
    case "thread.create":
    case "thread.delete":
    case "thread.archive":
    case "thread.unarchive":
    case "thread.meta.update":
    case "thread.runtime-mode.set":
    case "thread.interaction-mode.set":
    case "thread.session.set":
    case "thread.session.stop":
      return "thread-control";
    default: {
      // Exhaustiveness guard: a new command type must be classified above.
      const _exhaustive: never = command;
      void _exhaustive;
      return "thread-control";
    }
  }
}

function commandToAggregateRef(command: OrchestrationCommand): {
  readonly aggregateKind: "project" | "thread" | "task";
  readonly aggregateId: ProjectId | ThreadId | TaskId;
} {
  switch (command.type) {
    case "project.create":
    case "project.meta.update":
    case "project.delete":
      return {
        aggregateKind: "project",
        aggregateId: command.projectId,
      };
    case "task.create":
    case "task.classify":
    case "task.role-selections.set":
    case "task.stage.start":
    case "task.stage.complete":
    case "task.stage.block":
    case "task.stage.interrupt":
    case "task.gate.request":
    case "task.gate.resolve":
    case "task.land":
    case "task.landing.retry":
    case "task.pr.opened":
    case "task.pr.open.failed":
    case "task.abandon":
    case "task.cancellation.request":
    case "task.cancellation.fail":
    case "task.cancellation.phase.complete":
      return {
        aggregateKind: "task",
        aggregateId: command.taskId,
      };
    default:
      return {
        aggregateKind: "thread",
        aggregateId: command.threadId,
      };
  }
}

/**
 * Map a single orchestration domain event to its shell-stream projection.
 *
 * Exported so the mapping is computed once per event (inside the engine's
 * shared shell hub) and can be reused by tests. Non-thread/non-project events
 * and events whose aggregate row is missing degrade gracefully to `None`.
 */
export const toShellStreamEvent = (
  projectionSnapshotQuery: Pick<
    ProjectionSnapshotQueryShape,
    "getProjectShellById" | "getThreadShellById"
  >,
  event: OrchestrationEvent,
): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
  switch (event.type) {
    case "project.created":
    case "project.meta-updated":
      return projectionSnapshotQuery.getProjectShellById(event.payload.projectId).pipe(
        Effect.map((project) =>
          Option.map(project, (nextProject) => ({
            kind: "project-upserted" as const,
            sequence: event.sequence,
            project: nextProject,
          })),
        ),
        Effect.catch(() => Effect.succeed(Option.none())),
      );
    case "project.deleted":
      return Effect.succeed(
        Option.some({
          kind: "project-removed" as const,
          sequence: event.sequence,
          projectId: event.payload.projectId,
        }),
      );
    case "thread.deleted":
    case "thread.archived":
      return Effect.succeed(
        Option.some({
          kind: "thread-removed" as const,
          sequence: event.sequence,
          threadId: event.payload.threadId,
        }),
      );
    case "thread.unarchived":
      return projectionSnapshotQuery.getThreadShellById(event.payload.threadId).pipe(
        Effect.map((thread) =>
          Option.map(thread, (nextThread) => ({
            kind: "thread-upserted" as const,
            sequence: event.sequence,
            thread: nextThread,
          })),
        ),
        Effect.catch(() => Effect.succeed(Option.none())),
      );
    default:
      if (event.aggregateKind !== "thread") {
        return Effect.succeed(Option.none());
      }
      return projectionSnapshotQuery.getThreadShellById(ThreadId.make(event.aggregateId)).pipe(
        Effect.map((thread) =>
          Option.map(thread, (nextThread) => ({
            kind: "thread-upserted" as const,
            sequence: event.sequence,
            thread: nextThread,
          })),
        ),
        Effect.catch(() => Effect.succeed(Option.none())),
      );
  }
};

const makeOrchestrationEngine = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventStore = yield* OrchestrationEventStore;
  const commandReceiptRepository = yield* OrchestrationCommandReceiptRepository;
  const projectionPipeline = yield* OrchestrationProjectionPipeline;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const serverSettings = yield* ServerSettingsService;
  const crypto = yield* Crypto.Crypto;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  let commandReadModel = createEmptyReadModel(yield* nowIso);

  const commandQueue = yield* Queue.unbounded<CommandEnvelope>();
  const eventPubSub = yield* PubSub.unbounded<OrchestrationEvent>();
  // Shell-stream events are derived from domain events exactly once here and
  // fanned out to every shell subscriber via this hub, so the per-event shell
  // mapping (which issues projection queries) does not run per subscriber.
  const shellPubSub = yield* PubSub.unbounded<OrchestrationShellStreamEvent>();

  const projectEventsOntoReadModel = (
    baseReadModel: OrchestrationReadModel,
    events: ReadonlyArray<OrchestrationEvent>,
  ): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError, never> =>
    Effect.gen(function* () {
      let nextReadModel = baseReadModel;
      for (const event of events) {
        nextReadModel = yield* projectEvent(nextReadModel, event);
      }
      return nextReadModel;
    });

  const processEnvelope = (envelope: CommandEnvelope): Effect.Effect<void> => {
    const dispatchStartSequence = commandReadModel.snapshotSequence;
    let processingStartedAtMs = 0;
    const aggregateRef = commandToAggregateRef(envelope.command);
    const commandClass = classifyOrchestrationCommand(envelope.command);
    const baseMetricAttributes = {
      commandType: envelope.command.type,
      aggregateKind: aggregateRef.aggregateKind,
    } as const;
    const reconcileReadModelAfterDispatchFailure = Effect.gen(function* () {
      const persistedEvents = yield* Stream.runCollect(
        eventStore.readFromSequence(dispatchStartSequence),
      ).pipe(Effect.map((chunk): OrchestrationEvent[] => Array.from(chunk)));
      if (persistedEvents.length === 0) {
        return;
      }

      commandReadModel = yield* projectEventsOntoReadModel(commandReadModel, persistedEvents);

      for (const persistedEvent of persistedEvents) {
        yield* PubSub.publish(eventPubSub, persistedEvent);
      }
    });

    return Effect.exit(
      Effect.gen(function* () {
        processingStartedAtMs = yield* Clock.currentTimeMillis;
        // WP-7 (measurement only): record how long this envelope waited in the
        // single serialized dispatch queue before the worker picked it up. This
        // is observed strictly after the worker has dequeued the envelope, so it
        // does not affect dispatch ordering or serialization in any way.
        yield* Metric.update(
          Metric.withAttributes(
            orchestrationCommandQueueWaitDuration,
            metricAttributes({ ...baseMetricAttributes, commandClass }),
          ),
          Math.max(0, processingStartedAtMs - envelope.enqueuedAtMs),
        );
        yield* Effect.annotateCurrentSpan({
          "orchestration.command_id": envelope.command.commandId,
          "orchestration.command_type": envelope.command.type,
          "orchestration.aggregate_kind": aggregateRef.aggregateKind,
          "orchestration.aggregate_id": aggregateRef.aggregateId,
        });

        const existingReceipt = yield* commandReceiptRepository.getByCommandId({
          commandId: envelope.command.commandId,
        });
        if (Option.isSome(existingReceipt)) {
          if (existingReceipt.value.status === "accepted") {
            return {
              sequence: existingReceipt.value.resultSequence,
            };
          }
          return yield* new OrchestrationCommandPreviouslyRejectedError({
            commandId: envelope.command.commandId,
            detail: existingReceipt.value.error ?? "Previously rejected.",
          });
        }

        const orchestratorDefaults = (yield* serverSettings.getSettings).orchestratorDefaults;
        const eventBase = yield* decideOrchestrationCommand({
          command: envelope.command,
          orchestratorDefaults,
          readModel: commandReadModel,
        }).pipe(
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.mapError((cause) =>
            isOrchestrationCommandInvariantError(cause)
              ? cause
              : new OrchestrationCommandInvariantError({
                  commandType: envelope.command.type,
                  detail: "Failed to generate an event identifier.",
                  cause,
                }),
          ),
        );
        const eventBases = Array.isArray(eventBase) ? eventBase : [eventBase];
        const committedCommand = yield* withBusyRetry(
          sql.withTransaction(
            Effect.gen(function* () {
              const committedEvents: OrchestrationEvent[] = [];
              let nextCommandReadModel = commandReadModel;

              for (const nextEvent of eventBases) {
                const savedEvent = yield* eventStore.append(nextEvent);
                nextCommandReadModel = yield* projectEvent(nextCommandReadModel, savedEvent);
                yield* projectionPipeline.projectEvent(savedEvent);
                committedEvents.push(savedEvent);
              }

              const lastSavedEvent = committedEvents.at(-1) ?? null;
              if (lastSavedEvent === null) {
                return yield* new OrchestrationCommandInvariantError({
                  commandType: envelope.command.type,
                  detail: "Command produced no events.",
                });
              }

              yield* commandReceiptRepository.upsert({
                commandId: envelope.command.commandId,
                aggregateKind: lastSavedEvent.aggregateKind,
                aggregateId: lastSavedEvent.aggregateId,
                acceptedAt: lastSavedEvent.occurredAt,
                resultSequence: lastSavedEvent.sequence,
                status: "accepted",
                error: null,
              });

              return {
                committedEvents,
                lastSequence: lastSavedEvent.sequence,
                nextCommandReadModel,
              } as const;
            }),
          ),
        ).pipe(
          Effect.catchTag("SqlError", (sqlError) =>
            Effect.fail(
              toPersistenceSqlError("OrchestrationEngine.processEnvelope:transaction")(sqlError),
            ),
          ),
        );

        commandReadModel = committedCommand.nextCommandReadModel;
        for (const [index, event] of committedCommand.committedEvents.entries()) {
          yield* PubSub.publish(eventPubSub, event);
          if (index === 0) {
            yield* Metric.update(
              Metric.withAttributes(
                orchestrationCommandAckDuration,
                metricAttributes({
                  ...baseMetricAttributes,
                  ackEventType: event.type,
                }),
              ),
              Duration.millis(Math.max(0, (yield* Clock.currentTimeMillis) - envelope.startedAtMs)),
            );
          }
        }
        return { sequence: committedCommand.lastSequence };
      }).pipe(Effect.withSpan(`orchestration.command.${envelope.command.type}`)),
    ).pipe(
      Effect.flatMap((exit) =>
        Effect.gen(function* () {
          const outcome = Exit.isSuccess(exit)
            ? "success"
            : Cause.hasInterruptsOnly(exit.cause)
              ? "interrupt"
              : "failure";
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandDuration,
              metricAttributes(baseMetricAttributes),
            ),
            Duration.millis(Math.max(0, (yield* Clock.currentTimeMillis) - processingStartedAtMs)),
          );
          yield* Metric.update(
            Metric.withAttributes(
              orchestrationCommandsTotal,
              metricAttributes({
                ...baseMetricAttributes,
                outcome,
              }),
            ),
            1,
          );

          if (Exit.isSuccess(exit)) {
            yield* Deferred.succeed(envelope.result, exit.value);
            return;
          }

          const error = Cause.squash(exit.cause) as OrchestrationDispatchError;
          if (!isOrchestrationCommandPreviouslyRejectedError(error)) {
            yield* reconcileReadModelAfterDispatchFailure.pipe(
              Effect.catch(() =>
                Effect.logWarning(
                  "failed to reconcile orchestration read model after dispatch failure",
                ).pipe(
                  Effect.annotateLogs({
                    commandId: envelope.command.commandId,
                    snapshotSequence: commandReadModel.snapshotSequence,
                  }),
                ),
              ),
            );

            if (isOrchestrationCommandInvariantError(error)) {
              yield* commandReceiptRepository
                .upsert({
                  commandId: envelope.command.commandId,
                  aggregateKind: aggregateRef.aggregateKind,
                  aggregateId: aggregateRef.aggregateId,
                  acceptedAt: yield* nowIso,
                  resultSequence: commandReadModel.snapshotSequence,
                  status: "rejected",
                  error: error.message,
                })
                .pipe(Effect.catch(() => Effect.void));
            }
          }

          yield* Deferred.fail(envelope.result, error);
        }),
      ),
    );
  };

  yield* projectionPipeline.bootstrap;
  commandReadModel = yield* projectionSnapshotQuery.getCommandReadModel();

  const worker = Effect.forever(Queue.take(commandQueue).pipe(Effect.flatMap(processEnvelope)));
  yield* Effect.forkScoped(worker);

  // A single consumer maps each domain event to its shell projection once and
  // publishes the result for all shell subscribers, removing the prior
  // per-event per-subscriber re-query multiplier.
  yield* Stream.fromPubSub(eventPubSub).pipe(
    Stream.mapEffect((event) => toShellStreamEvent(projectionSnapshotQuery, event)),
    Stream.flatMap((shellEvent) =>
      Option.isSome(shellEvent) ? Stream.succeed(shellEvent.value) : Stream.empty,
    ),
    Stream.runForEach((shellEvent) => PubSub.publish(shellPubSub, shellEvent)),
    Effect.forkScoped,
  );
  yield* Effect.logDebug("orchestration engine started").pipe(
    Effect.annotateLogs({ sequence: commandReadModel.snapshotSequence }),
  );

  const readEvents: OrchestrationEngineShape["readEvents"] = (fromSequenceExclusive) =>
    eventStore.readFromSequence(fromSequenceExclusive);

  const dispatch: OrchestrationEngineShape["dispatch"] = (command) =>
    Effect.gen(function* () {
      const result = yield* Deferred.make<{ sequence: number }, OrchestrationDispatchError>();
      const enqueuedAtMs = yield* Clock.currentTimeMillis;
      yield* Queue.offer(commandQueue, {
        command,
        result,
        startedAtMs: enqueuedAtMs,
        enqueuedAtMs,
      });
      // WP-7 (measurement only): sample the single serialized dispatch queue's
      // depth right after offering this envelope. The reading includes this
      // envelope plus any others still waiting behind the in-flight command, so
      // it captures contention without altering the offer or the worker loop.
      yield* Metric.update(
        Metric.withAttributes(
          orchestrationCommandQueueDepth,
          metricAttributes({
            commandType: command.type,
            commandClass: classifyOrchestrationCommand(command),
          }),
        ),
        yield* Queue.size(commandQueue),
      );
      return yield* Deferred.await(result);
    });

  return {
    readEvents,
    dispatch,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (wsServer, ProviderRuntimeIngestion, CheckpointReactor, etc.)
    // each independently receive all domain events.
    get streamDomainEvents(): OrchestrationEngineShape["streamDomainEvents"] {
      return Stream.fromPubSub(eventPubSub);
    },
    // Shell-stream events are mapped once (above) and fanned out here. Each
    // access creates a fresh subscription to the shared, already-mapped hub, so
    // no projection re-query runs per subscriber.
    get streamShellEvents(): OrchestrationEngineShape["streamShellEvents"] {
      return Stream.fromPubSub(shellPubSub);
    },
  } satisfies OrchestrationEngineShape;
});

export const OrchestrationEngineLive = Layer.effect(
  OrchestrationEngineService,
  makeOrchestrationEngine,
);
