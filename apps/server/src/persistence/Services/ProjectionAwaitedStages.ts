/**
 * ProjectionAwaitedStageRepository - Projection repository for awaited stages.
 *
 * Owns persistence operations for the `projection_awaited_stages`
 * reconciliation source (migration 034). One row per dispatched-but-unsettled
 * stage: a `task.stage-started` (with a non-null `awaitedTurnId`) opens a row
 * (`awaited`); the matching `task.stage-completed` settles it (`completed`).
 *
 * Projector-owned and derived purely from the `task.*` event log (Plan 018
 * WP-D / WP-H durability barrier) — the PM never writes it directly.
 *
 * @module ProjectionAwaitedStageRepository
 */
import { IsoDateTime, OrchestrationStageRole, TaskId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

/**
 * Lifecycle of an awaited stage row. `awaited` while the PM is blocked on the
 * worker turn; `completed` once the matching `task.stage-completed` lands.
 */
export const ProjectionAwaitedStageStatus = Schema.Literals(["awaited", "completed"]);
export type ProjectionAwaitedStageStatus = typeof ProjectionAwaitedStageStatus.Type;

export const ProjectionAwaitedStage = Schema.Struct({
  taskId: TaskId,
  stageThreadId: ThreadId,
  role: OrchestrationStageRole,
  awaitedTurnId: Schema.NullOr(TurnId),
  status: ProjectionAwaitedStageStatus,
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionAwaitedStage = typeof ProjectionAwaitedStage.Type;

export const ListProjectionAwaitedStagesByTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type ListProjectionAwaitedStagesByTaskInput =
  typeof ListProjectionAwaitedStagesByTaskInput.Type;

export const GetProjectionAwaitedStageInput = Schema.Struct({
  taskId: TaskId,
  stageThreadId: ThreadId,
});
export type GetProjectionAwaitedStageInput = typeof GetProjectionAwaitedStageInput.Type;

/**
 * ProjectionAwaitedStageRepositoryShape - Service API for awaited stages.
 */
export interface ProjectionAwaitedStageRepositoryShape {
  /**
   * Insert or replace an awaited-stage row. Upserts by `(taskId,
   * stageThreadId)`.
   */
  readonly upsert: (row: ProjectionAwaitedStage) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * List awaited-stage rows for a task, in stage-start order.
   */
  readonly listByTaskId: (
    input: ListProjectionAwaitedStagesByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionAwaitedStage>, ProjectionRepositoryError>;
}

/**
 * ProjectionAwaitedStageRepository - Service tag for awaited-stage persistence.
 */
export class ProjectionAwaitedStageRepository extends Context.Service<
  ProjectionAwaitedStageRepository,
  ProjectionAwaitedStageRepositoryShape
>()("gedcode/persistence/Services/ProjectionAwaitedStages/ProjectionAwaitedStageRepository") {}
