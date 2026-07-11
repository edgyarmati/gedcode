/**
 * TaskCancellationReconciler - Startup repair for tasks with a durable
 * cancellation reservation that did not reach abandonment before shutdown.
 *
 * @module TaskCancellationReconciler
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TaskCancellationReconcilerShape {
  /** Resume pending task cancellations. Returns the number settled. */
  readonly reconcile: () => Effect.Effect<number, never>;
}

export class TaskCancellationReconciler extends Context.Service<
  TaskCancellationReconciler,
  TaskCancellationReconcilerShape
>()("gedcode/orchestration/Services/TaskCancellationReconciler") {}
