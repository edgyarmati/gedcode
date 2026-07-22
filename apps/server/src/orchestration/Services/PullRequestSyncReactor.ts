/**
 * Polls the provider-neutral source-control boundary for the small durable set
 * of task pull requests that are still open.
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface PullRequestSyncReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class PullRequestSyncReactor extends Context.Service<
  PullRequestSyncReactor,
  PullRequestSyncReactorShape
>()("gedcode/orchestration/Services/PullRequestSyncReactor") {}
