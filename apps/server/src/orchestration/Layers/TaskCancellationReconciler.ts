import { CommandId, type OrchestrationTask } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { cancelOrchestrationTaskWithServices } from "../taskCancellation.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TaskCancellationReconciler,
  type TaskCancellationReconcilerShape,
} from "../Services/TaskCancellationReconciler.ts";

const isPendingCancellation = (task: OrchestrationTask): boolean =>
  task.cancellation !== null && task.status !== "landed" && task.status !== "abandoned";

export const findPendingTaskCancellations = (
  tasks: ReadonlyArray<OrchestrationTask>,
): ReadonlyArray<OrchestrationTask> => tasks.filter(isPendingCancellation);

interface TaskCancellationReconcilerOptions {
  readonly maxAttempts?: number;
  readonly retryDelayMs?: number;
}

const make = (options?: TaskCancellationReconcilerOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const providerService = yield* ProviderService;
    const terminalManager = yield* TerminalManager;
    const crypto = yield* Crypto.Crypto;

    const reconcileOnce = Effect.fn("TaskCancellationReconciler.reconcileOnce")(function* () {
      const readModel = yield* snapshotQuery.getCommandReadModel();
      const pendingTasks = findPendingTaskCancellations(readModel.tasks);
      if (pendingTasks.length === 0) {
        return { pendingCount: 0, reconciledCount: 0 };
      }

      const liveProviderThreadIds = new Set(
        (yield* providerService.listSessions()).map((session) => String(session.threadId)),
      );
      const results = yield* Effect.forEach(
        pendingTasks,
        (task) =>
          cancelOrchestrationTaskWithServices(
            { snapshotQuery, providerService, terminalManager },
            {
              taskId: task.id,
              commandId: crypto.randomUUIDv4.pipe(
                Effect.map((uuid) =>
                  CommandId.make(`server:task-cancellation-reconcile:${String(task.id)}:${uuid}`),
                ),
              ),
              createdAt: DateTime.now.pipe(Effect.map(DateTime.formatIso)),
              dispatch: orchestrationEngine.dispatch,
              liveProviderThreadIds,
            },
          ).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.logWarning("task cancellation reconciliation failed", {
                taskId: task.id,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(false)),
            ),
          ),
        { concurrency: 4 },
      );
      const reconciledCount = results.filter(Boolean).length;
      yield* Effect.logInfo("task cancellation reconciler settled pending tasks", {
        pendingCount: pendingTasks.length,
        reconciledCount,
      });
      return { pendingCount: pendingTasks.length, reconciledCount };
    });

    const reconcile: TaskCancellationReconcilerShape["reconcile"] = () =>
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
            yield* Effect.logWarning("task cancellation reconciliation attempt failed", {
              attempt,
              maxAttempts,
              cause: Cause.pretty(outcome.cause),
            });
          }

          if (attempt < maxAttempts) {
            yield* Effect.sleep(retryDelay);
          }
        }

        yield* Effect.logWarning("task cancellation reconciliation exhausted startup retries", {
          maxAttempts,
        });
        return totalReconciled;
      });

    return { reconcile } satisfies TaskCancellationReconcilerShape;
  });

export const makeTaskCancellationReconcilerLive = (options?: TaskCancellationReconcilerOptions) =>
  Layer.effect(TaskCancellationReconciler, make(options));

export const TaskCancellationReconcilerLive = makeTaskCancellationReconcilerLive();
