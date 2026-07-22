import {
  CommandId,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type OrchestrationStageRole,
  type ProviderSession,
  type TaskId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  OrphanTurnReconciler,
  type OrphanTurnReconcilerShape,
} from "../Services/OrphanTurnReconciler.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { activeStageRoleForTaskStatus } from "../stageResolution.ts";
import { withTaskLifecycleLock } from "../taskLifecycleCoordinator.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const RECONCILE_LAST_ERROR = "Provider session was not live during server startup reconciliation.";

export interface OrphanedActiveStage {
  readonly taskId: TaskId;
  readonly threadId: ThreadId;
  readonly role: OrchestrationStageRole;
  readonly session: OrchestrationSession | null;
}

/**
 * Select from task ownership rather than historical stage threads. Provider
 * absence is authoritative even when a previous startup already changed the
 * projected session to interrupted, which closes the crash window between
 * repairing the thread and settling the task stage.
 */
export function findOrphanedActiveStages(input: {
  readonly readModel: OrchestrationReadModel;
  readonly liveProviderSessions: ReadonlyArray<ProviderSession>;
}): ReadonlyArray<OrphanedActiveStage> {
  const liveThreadIds = new Set(
    input.liveProviderSessions.map((session) => String(session.threadId)),
  );

  return input.readModel.tasks.flatMap((task) => {
    const threadId = task.currentStageThreadId;
    if (
      threadId === null ||
      task.cancellation != null ||
      task.status === "landed" ||
      task.status === "abandoned" ||
      input.readModel.stageHistory[threadId]?.status === "paused" ||
      liveThreadIds.has(String(threadId))
    ) {
      return [];
    }
    const role =
      input.readModel.stageHistory[threadId]?.role ?? activeStageRoleForTaskStatus(task.status);
    if (role === null || role === undefined) {
      return [];
    }
    const thread = input.readModel.threads.find((entry) => entry.id === threadId);
    return [{ taskId: task.id, threadId, role, session: thread?.session ?? null }];
  });
}

function interruptedSession(
  session: OrchestrationSession,
  updatedAt: string,
): OrchestrationSession {
  return {
    ...session,
    status: "interrupted",
    activeTurnId: null,
    lastError: RECONCILE_LAST_ERROR,
    updatedAt,
  };
}

interface OrphanTurnReconcilerOptions {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

const make = (options?: OrphanTurnReconcilerOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const providerService = yield* ProviderService;

    const reconcileOnce = Effect.fn("OrphanTurnReconciler.reconcileOnce")(function* () {
      const readModel = yield* projectionSnapshotQuery.getSnapshot();
      const liveProviderSessions = yield* providerService.listSessions();
      const orphanedStages = findOrphanedActiveStages({ readModel, liveProviderSessions });
      if (orphanedStages.length === 0) {
        return { pendingCount: 0, reconciledCount: 0 };
      }

      const updatedAt = yield* nowIso;
      const results = yield* Effect.forEach(
        orphanedStages,
        (stage) =>
          withTaskLifecycleLock(
            stage.taskId,
            Effect.gen(function* () {
              // Worker startup uses this same lock. Re-read both durable task
              // ownership and live provider state after acquiring it so an
              // initial orphan snapshot can never interrupt a worker that
              // became live while reconciliation was waiting.
              const freshReadModel = yield* projectionSnapshotQuery.getSnapshot();
              const freshLiveSessions = yield* providerService.listSessions();
              const freshStage = findOrphanedActiveStages({
                readModel: freshReadModel,
                liveProviderSessions: freshLiveSessions,
              }).find(
                (candidate) =>
                  candidate.taskId === stage.taskId && candidate.threadId === stage.threadId,
              );
              if (freshStage === undefined) {
                return true;
              }

              if (
                freshStage.session !== null &&
                (freshStage.session.status !== "interrupted" ||
                  freshStage.session.activeTurnId !== null)
              ) {
                yield* orchestrationEngine
                  .dispatch({
                    type: "thread.session.set",
                    commandId: CommandId.make(
                      `server:orphan-turn-reconcile:${String(freshStage.threadId)}:${String(freshStage.session.activeTurnId ?? "no-active-turn")}`,
                    ),
                    threadId: freshStage.threadId,
                    session: interruptedSession(freshStage.session, updatedAt),
                    createdAt: updatedAt,
                  })
                  .pipe(Effect.asVoid);
              }

              yield* orchestrationEngine
                .dispatch({
                  type: "task.stage.interrupt",
                  commandId: CommandId.make(
                    `server:orphan-stage-reconcile:${String(freshStage.taskId)}:${String(freshStage.threadId)}`,
                  ),
                  taskId: freshStage.taskId,
                  stageThreadId: freshStage.threadId,
                  role: freshStage.role,
                  reason: "orphaned",
                  createdAt: updatedAt,
                })
                .pipe(Effect.asVoid);
              return true;
            }),
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("orphan stage reconciliation failed", {
                taskId: stage.taskId,
                stageThreadId: stage.threadId,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(false)),
            ),
          ),
        { concurrency: 4 },
      );
      const reconciledCount = results.filter(Boolean).length;
      yield* Effect.logInfo("orphan turn reconciler repaired active stages", {
        pendingCount: orphanedStages.length,
        reconciledCount,
      });
      return { pendingCount: orphanedStages.length, reconciledCount };
    });

    const reconcile: OrphanTurnReconcilerShape["reconcile"] = () =>
      Effect.gen(function* () {
        const maxAttempts = Math.max(1, options?.maxAttempts ?? 5);
        const retryDelay = Duration.millis(Math.max(0, options?.retryDelayMs ?? 1_000));
        let totalReconciled = 0;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const outcome = yield* Effect.exit(reconcileOnce());
          if (Exit.isSuccess(outcome)) {
            totalReconciled += outcome.value.reconciledCount;
            if (outcome.value.reconciledCount === outcome.value.pendingCount) {
              return totalReconciled;
            }
          } else {
            yield* Effect.logWarning("orphan turn reconciliation attempt failed", {
              attempt,
              maxAttempts,
              cause: Cause.pretty(outcome.cause),
            });
          }
          if (attempt < maxAttempts) {
            yield* Effect.sleep(retryDelay);
          }
        }

        yield* Effect.logWarning("orphan turn reconciliation exhausted startup retries", {
          maxAttempts,
        });
        return totalReconciled;
      });

    return { reconcile } satisfies OrphanTurnReconcilerShape;
  });

export const makeOrphanTurnReconcilerLive = (options?: OrphanTurnReconcilerOptions) =>
  Layer.effect(OrphanTurnReconciler, make(options));

export const OrphanTurnReconcilerLive = makeOrphanTurnReconcilerLive();
