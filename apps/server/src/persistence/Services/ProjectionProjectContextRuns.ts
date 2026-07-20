import { OrchestrationProjectContextRun, ProjectContextRunId, ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionProjectContextRun = OrchestrationProjectContextRun;
export type ProjectionProjectContextRun = typeof ProjectionProjectContextRun.Type;

export const GetProjectionProjectContextRunInput = Schema.Struct({
  projectContextRunId: ProjectContextRunId,
});
export const ListProjectionProjectContextRunsByProjectInput = Schema.Struct({
  projectId: ProjectId,
});

export interface ProjectionProjectContextRunRepositoryShape {
  readonly upsert: (
    run: ProjectionProjectContextRun,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: typeof GetProjectionProjectContextRunInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionProjectContextRun>, ProjectionRepositoryError>;
  readonly listByProjectId: (
    input: typeof ListProjectionProjectContextRunsByProjectInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionProjectContextRun>, ProjectionRepositoryError>;
  readonly listActiveByProjectId: (
    input: typeof ListProjectionProjectContextRunsByProjectInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionProjectContextRun>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionProjectContextRun>,
    ProjectionRepositoryError
  >;
}

export class ProjectionProjectContextRunRepository extends Context.Service<
  ProjectionProjectContextRunRepository,
  ProjectionProjectContextRunRepositoryShape
>()(
  "gedcode/persistence/Services/ProjectionProjectContextRuns/ProjectionProjectContextRunRepository",
) {}
