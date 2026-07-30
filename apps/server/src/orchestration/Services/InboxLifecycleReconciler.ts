import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface InboxLifecycleReconcilerShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly reconcile: () => Effect.Effect<number>;
}

export class InboxLifecycleReconciler extends Context.Service<
  InboxLifecycleReconciler,
  InboxLifecycleReconcilerShape
>()("gedcode/orchestration/Services/InboxLifecycleReconciler") {}
