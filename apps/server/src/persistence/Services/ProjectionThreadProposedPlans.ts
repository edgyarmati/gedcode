import {
  IsoDateTime,
  OrchestrationProposedPlanId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadProposedPlan = Schema.Struct({
  planId: OrchestrationProposedPlanId,
  threadId: ThreadId,
  turnId: Schema.NullOr(TurnId),
  planMarkdown: TrimmedNonEmptyString,
  implementedAt: Schema.NullOr(IsoDateTime),
  implementationThreadId: Schema.NullOr(ThreadId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionThreadProposedPlan = typeof ProjectionThreadProposedPlan.Type;

export const ListProjectionThreadProposedPlansInput = Schema.Struct({
  threadId: ThreadId,
});
export type ListProjectionThreadProposedPlansInput =
  typeof ListProjectionThreadProposedPlansInput.Type;

export const DeleteProjectionThreadProposedPlansInput = Schema.Struct({
  threadId: ThreadId,
});
export type DeleteProjectionThreadProposedPlansInput =
  typeof DeleteProjectionThreadProposedPlansInput.Type;

export interface HasActionableProposedPlanInput {
  readonly threadId: ThreadId;
  readonly latestTurnId: string | null;
}

export interface ProjectionThreadProposedPlanRepositoryShape {
  readonly upsert: (
    proposedPlan: ProjectionThreadProposedPlan,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: ListProjectionThreadProposedPlansInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionThreadProposedPlan>, ProjectionRepositoryError>;
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadProposedPlansInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  /**
   * Determine whether the thread has an actionable (unimplemented) proposed
   * plan. Prefers the latest plan scoped to `latestTurnId` when provided;
   * falls back to the overall latest plan.
   */
  readonly hasActionableProposedPlan: (
    input: HasActionableProposedPlanInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
}

export class ProjectionThreadProposedPlanRepository extends Context.Service<
  ProjectionThreadProposedPlanRepository,
  ProjectionThreadProposedPlanRepositoryShape
>()(
  "gedcode/persistence/Services/ProjectionThreadProposedPlans/ProjectionThreadProposedPlanRepository",
) {}
