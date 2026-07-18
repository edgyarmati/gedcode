import {
  HelperRunId,
  OrchestrationHelperRun,
  ProjectId,
  TaskId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionHelperRun = OrchestrationHelperRun;
export type ProjectionHelperRun = typeof ProjectionHelperRun.Type;

export const GetProjectionHelperRunInput = Schema.Struct({ helperRunId: HelperRunId });
export const ListProjectionHelperRunsByProjectInput = Schema.Struct({ projectId: ProjectId });
export const ListProjectionHelperRunsByTaskInput = Schema.Struct({ taskId: TaskId });
export const ListProjectionHelperRunsByThreadInput = Schema.Struct({ threadId: ThreadId });

export interface ProjectionHelperRunRepositoryShape {
  readonly upsert: (run: ProjectionHelperRun) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: typeof GetProjectionHelperRunInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionHelperRun>, ProjectionRepositoryError>;
  readonly listByProjectId: (
    input: typeof ListProjectionHelperRunsByProjectInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionHelperRun>, ProjectionRepositoryError>;
  readonly listByTaskId: (
    input: typeof ListProjectionHelperRunsByTaskInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionHelperRun>, ProjectionRepositoryError>;
  readonly listByThreadId: (
    input: typeof ListProjectionHelperRunsByThreadInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionHelperRun>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionHelperRun>,
    ProjectionRepositoryError
  >;
}

export class ProjectionHelperRunRepository extends Context.Service<
  ProjectionHelperRunRepository,
  ProjectionHelperRunRepositoryShape
>()("gedcode/persistence/Services/ProjectionHelperRuns/ProjectionHelperRunRepository") {}
