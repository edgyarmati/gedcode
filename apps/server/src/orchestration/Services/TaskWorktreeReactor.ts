/**
 * TaskWorktreeReactor - Task worktree cleanup reactor service interface.
 *
 * Owns best-effort cleanup for task-scoped Git worktrees after terminal task
 * events and during startup reconciliation.
 *
 * @module TaskWorktreeReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface TaskWorktreeReactorShape {
  /**
   * Start reacting to terminal task orchestration events.
   *
   * The returned effect must be run in a scope so the worker fiber is finalized
   * on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for test use to replace timing-sensitive sleeps.
   */
  readonly drain: Effect.Effect<void>;
}

export class TaskWorktreeReactor extends Context.Service<
  TaskWorktreeReactor,
  TaskWorktreeReactorShape
>()("gedcode/orchestration/Services/TaskWorktreeReactor") {}
