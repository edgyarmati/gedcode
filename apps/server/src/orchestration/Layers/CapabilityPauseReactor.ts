import {
  CommandId,
  type OrchestrationReadModel,
  type OrchestrationStageRole,
  type TaskId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  CapabilityPauseReactor,
  type CapabilityPauseReactorShape,
} from "../Services/CapabilityPauseReactor.ts";
import { withTaskLifecycleLock } from "../taskLifecycleCoordinator.ts";

const DEFAULT_RECONCILIATION_INTERVAL = Duration.minutes(1);

export interface ExpiredCapabilityPause {
  readonly taskId: TaskId;
  readonly stageThreadId: ThreadId;
  readonly role: OrchestrationStageRole;
  readonly expiresAt: string;
}

export function findExpiredCapabilityPauses(
  readModel: OrchestrationReadModel,
  now: string,
): ReadonlyArray<ExpiredCapabilityPause> {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];
  return readModel.tasks.flatMap((task) => {
    if (task.cancellation !== null || task.currentStageThreadId === null) return [];
    const stage = readModel.stageHistory[task.currentStageThreadId];
    const expiresAt = stage?.capabilityPauseExpiresAt;
    if (stage?.status !== "paused" || typeof expiresAt !== "string") return [];
    const expiresAtMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs > nowMs) return [];
    return [
      {
        taskId: task.id,
        stageThreadId: stage.stageThreadId,
        role: stage.role,
        expiresAt,
      },
    ];
  });
}

export const makeCapabilityPauseReactor = (options?: {
  readonly reconciliationIntervalMs?: number;
  readonly now?: () => string;
}) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const snapshots = yield* ProjectionSnapshotQuery;
    const providers = yield* ProviderService;
    const reconciliationInterval = Duration.millis(
      Math.max(
        1,
        options?.reconciliationIntervalMs ?? Duration.toMillis(DEFAULT_RECONCILIATION_INTERVAL),
      ),
    );
    const reconcile: CapabilityPauseReactorShape["reconcile"] = () =>
      Effect.gen(function* () {
        const reconciledAt = options?.now?.() ?? DateTime.formatIso(yield* DateTime.now);
        const expired = findExpiredCapabilityPauses(
          yield* snapshots.getCommandReadModel(),
          reconciledAt,
        );
        const results = yield* Effect.forEach(
          expired,
          (pause) =>
            withTaskLifecycleLock(
              pause.taskId,
              Effect.gen(function* () {
                const fresh = findExpiredCapabilityPauses(
                  yield* snapshots.getCommandReadModel(),
                  options?.now?.() ?? DateTime.formatIso(yield* DateTime.now),
                ).find(
                  (candidate) =>
                    candidate.taskId === pause.taskId &&
                    candidate.stageThreadId === pause.stageThreadId &&
                    candidate.expiresAt === pause.expiresAt,
                );
                if (fresh === undefined) return false;
                yield* engine.dispatch({
                  type: "task.stage.interrupt",
                  commandId: CommandId.make(
                    `server:task-stage-capability-timeout:${fresh.stageThreadId}:${fresh.expiresAt}`,
                  ),
                  taskId: fresh.taskId,
                  stageThreadId: fresh.stageThreadId,
                  role: fresh.role,
                  reason: "capability-timeout",
                  createdAt: reconciledAt,
                });
                yield* providers.stopSession({ threadId: fresh.stageThreadId }).pipe(
                  Effect.catchCause((cause) =>
                    Cause.hasInterruptsOnly(cause)
                      ? Effect.void
                      : Effect.logWarning("capability pause expiry could not stop worker session", {
                          taskId: fresh.taskId,
                          stageThreadId: fresh.stageThreadId,
                          cause: Cause.pretty(cause),
                        }),
                  ),
                );
                return true;
              }),
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("capability pause expiry reconciliation failed", {
                  taskId: pause.taskId,
                  stageThreadId: pause.stageThreadId,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.as(false)),
              ),
            ),
          { concurrency: 4 },
        );
        return results.filter(Boolean).length;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("capability pause reconciliation failed", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(0)),
        ),
      );

    const start: CapabilityPauseReactorShape["start"] = () =>
      Effect.gen(function* () {
        yield* reconcile().pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("capability pause startup reconciliation failed", {
              cause: Cause.pretty(cause),
            }),
          ),
        );
        yield* Effect.forkScoped(
          reconcile().pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("capability pause scheduled reconciliation failed", {
                cause: Cause.pretty(cause),
              }),
            ),
            Effect.repeat(Schedule.spaced(reconciliationInterval)),
          ),
        );
      });

    return { start, reconcile } satisfies CapabilityPauseReactorShape;
  });

export const CapabilityPauseReactorLive = Layer.effect(
  CapabilityPauseReactor,
  makeCapabilityPauseReactor(),
);
