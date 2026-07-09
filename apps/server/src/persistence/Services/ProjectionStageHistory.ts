import { OrchestrationStageHistoryEntry, ProjectId, TaskId, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionStageHistoryEntry = OrchestrationStageHistoryEntry;
export type ProjectionStageHistoryEntry = typeof ProjectionStageHistoryEntry.Type;

export const GetProjectionStageHistoryInput = Schema.Struct({
  stageThreadId: ThreadId,
});
export type GetProjectionStageHistoryInput = typeof GetProjectionStageHistoryInput.Type;

export const ListProjectionStageHistoryByProjectInput = Schema.Struct({
  projectId: ProjectId,
});
export type ListProjectionStageHistoryByProjectInput =
  typeof ListProjectionStageHistoryByProjectInput.Type;

export const ListProjectionStageHistoryByTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type ListProjectionStageHistoryByTaskInput =
  typeof ListProjectionStageHistoryByTaskInput.Type;

export interface ProjectionStageHistoryRepositoryShape {
  readonly upsert: (
    row: ProjectionStageHistoryEntry,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly getByStageThreadId: (
    input: GetProjectionStageHistoryInput,
  ) => Effect.Effect<Option.Option<ProjectionStageHistoryEntry>, ProjectionRepositoryError>;

  readonly listByProjectId: (
    input: ListProjectionStageHistoryByProjectInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionStageHistoryEntry>, ProjectionRepositoryError>;

  readonly listByTaskId: (
    input: ListProjectionStageHistoryByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionStageHistoryEntry>, ProjectionRepositoryError>;

  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionStageHistoryEntry>,
    ProjectionRepositoryError
  >;
}

export class ProjectionStageHistoryRepository extends Context.Service<
  ProjectionStageHistoryRepository,
  ProjectionStageHistoryRepositoryShape
>()("gedcode/persistence/Services/ProjectionStageHistory/ProjectionStageHistoryRepository") {}
