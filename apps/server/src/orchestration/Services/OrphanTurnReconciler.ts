/**
 * OrphanTurnReconciler - Startup repair for projected running turns with no
 * live provider session.
 *
 * @module OrphanTurnReconciler
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/**
 * OrphanTurnReconcilerShape - Service API for startup reconciliation.
 */
export interface OrphanTurnReconcilerShape {
  /**
   * Repair task stage turns that were projected as running but whose provider
   * process is no longer live. Returns the number of repaired stage turns.
   */
  readonly reconcile: () => Effect.Effect<number, never>;
}

/**
 * OrphanTurnReconciler - Service tag for startup turn-state repair.
 */
export class OrphanTurnReconciler extends Context.Service<
  OrphanTurnReconciler,
  OrphanTurnReconcilerShape
>()("gedcode/orchestration/Services/OrphanTurnReconciler") {}
