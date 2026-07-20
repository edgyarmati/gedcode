import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface ProjectContextRunReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly reconcile: Effect.Effect<void>;
  readonly drain: Effect.Effect<void>;
}

export class ProjectContextRunReactor extends Context.Service<
  ProjectContextRunReactor,
  ProjectContextRunReactorShape
>()("gedcode/orchestration/Services/ProjectContextRunReactor") {}
