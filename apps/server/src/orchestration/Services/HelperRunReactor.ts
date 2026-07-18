import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface HelperRunReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly reconcile: Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

export class HelperRunReactor extends Context.Service<HelperRunReactor, HelperRunReactorShape>()(
  "gedcode/orchestration/Services/HelperRunReactor",
) {}
