/**
 * OrphanTurnReconciler - Startup + periodic repair for projected running turns
 * with no live provider session.
 *
 * @module OrphanTurnReconciler
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

/**
 * OrphanTurnReconcilerShape - Service API for turn-state repair.
 */
export interface OrphanTurnReconcilerShape {
  /**
   * Repair task stage turns that were projected as running but whose provider
   * process is no longer live. Returns the number of repaired stage turns.
   */
  readonly reconcile: () => Effect.Effect<number, never>;

  /**
   * Run one reconciliation pass, then keep reconciling on an interval so a
   * provider death at any time settles its stuck stage within one tick instead
   * of only at the next startup. Must run in a scope so the interval fiber is
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

/**
 * OrphanTurnReconciler - Service tag for startup turn-state repair.
 */
export class OrphanTurnReconciler extends Context.Service<
  OrphanTurnReconciler,
  OrphanTurnReconcilerShape
>()("gedcode/orchestration/Services/OrphanTurnReconciler") {}
