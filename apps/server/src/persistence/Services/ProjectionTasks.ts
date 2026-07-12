/**
 * ProjectionTaskRepository - Projection repository interface for tasks.
 *
 * Owns persistence operations for projected task aggregate rows in the
 * orchestration read model (`projection_tasks`, migration 033).
 *
 * `status` is **derived purely from the `task.*` event log** by the projector
 * (Plan 018 WP-D) — there is intentionally no `task.status.set` command and the
 * repository never computes status. Callers pass the already-derived row.
 *
 * @module ProjectionTaskRepository
 */
import {
  GedRoleModelSelections,
  IsoDateTime,
  MessageId,
  OrchestrationTaskCancellation,
  OrchestrationTaskLanding,
  OrchestrationTaskStatus,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTask = Schema.Struct({
  taskId: TaskId,
  projectId: ProjectId,
  type: TaskTypeId,
  title: TrimmedNonEmptyString,
  status: OrchestrationTaskStatus,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  prUrl: Schema.NullOr(TrimmedNonEmptyString),
  pmMessageId: Schema.NullOr(MessageId),
  stageThreadIds: Schema.Array(ThreadId),
  currentStageThreadId: Schema.NullOr(ThreadId),
  cancellation: Schema.NullOr(OrchestrationTaskCancellation),
  landing: Schema.NullOr(OrchestrationTaskLanding),
  roleModelSelections: GedRoleModelSelections,
  playbookVersion: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ProjectionTask = typeof ProjectionTask.Type;

export const GetProjectionTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type GetProjectionTaskInput = typeof GetProjectionTaskInput.Type;

export const ListProjectionTasksByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionTasksByProjectInput = typeof ListProjectionTasksByProjectInput.Type;

/**
 * ProjectionTaskRepositoryShape - Service API for projected task records.
 */
export interface ProjectionTaskRepositoryShape {
  /**
   * Insert or replace a projected task row.
   *
   * Upserts by `taskId`. `status` must already be the value derived from the
   * event log; the repository never derives it.
   */
  readonly upsert: (task: ProjectionTask) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read a projected task row by id.
   */
  readonly getById: (
    input: GetProjectionTaskInput,
  ) => Effect.Effect<Option.Option<ProjectionTask>, ProjectionRepositoryError>;

  /**
   * List projected tasks for a project.
   *
   * Returned in deterministic creation order.
   */
  readonly listByProjectId: (
    input: ListProjectionTasksByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;

  /**
   * List all projected task rows.
   *
   * Returned in deterministic creation order. Used by snapshot reconstruction.
   */
  readonly listAll: () => Effect.Effect<ReadonlyArray<ProjectionTask>, ProjectionRepositoryError>;
}

/**
 * ProjectionTaskRepository - Service tag for task projection persistence.
 */
export class ProjectionTaskRepository extends Context.Service<
  ProjectionTaskRepository,
  ProjectionTaskRepositoryShape
>()("gedcode/persistence/Services/ProjectionTasks/ProjectionTaskRepository") {}
