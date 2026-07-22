/** Durable expiry reconciliation for worker capability pauses. */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface CapabilityPauseReactorShape {
  /** Starts startup and periodic expiry reconciliation. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /** Exposed for deterministic startup/expiry verification. */
  readonly reconcile: () => Effect.Effect<number, never>;
}

export class CapabilityPauseReactor extends Context.Service<
  CapabilityPauseReactor,
  CapabilityPauseReactorShape
>()("gedcode/orchestration/Services/CapabilityPauseReactor") {}
