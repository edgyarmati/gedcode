import {
  OrchestrationQuotaBlockedStage,
  OrchestrationStageRole,
  ProviderInstanceId,
  TaskId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionQuotaBlockedStage = OrchestrationQuotaBlockedStage;
export type ProjectionQuotaBlockedStage = typeof ProjectionQuotaBlockedStage.Type;

export const ListProjectionQuotaBlockedStagesByTaskInput = Schema.Struct({
  taskId: TaskId,
});
export type ListProjectionQuotaBlockedStagesByTaskInput =
  typeof ListProjectionQuotaBlockedStagesByTaskInput.Type;

export const ListProjectionQuotaBlockedStagesByProviderInput = Schema.Struct({
  providerInstanceId: ProviderInstanceId,
});
export type ListProjectionQuotaBlockedStagesByProviderInput =
  typeof ListProjectionQuotaBlockedStagesByProviderInput.Type;

export const CountProjectionQuotaBlockedStagesByTaskRoleInput = Schema.Struct({
  taskId: TaskId,
  role: OrchestrationStageRole,
});
export type CountProjectionQuotaBlockedStagesByTaskRoleInput =
  typeof CountProjectionQuotaBlockedStagesByTaskRoleInput.Type;

export interface ProjectionQuotaBlockedStageRepositoryShape {
  readonly upsert: (
    row: ProjectionQuotaBlockedStage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;

  readonly listByTaskId: (
    input: ListProjectionQuotaBlockedStagesByTaskInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionQuotaBlockedStage>, ProjectionRepositoryError>;

  readonly listBlockedByProviderInstanceId: (
    input: ListProjectionQuotaBlockedStagesByProviderInput,
  ) => Effect.Effect<ReadonlyArray<ProjectionQuotaBlockedStage>, ProjectionRepositoryError>;

  readonly listBlocked: () => Effect.Effect<
    ReadonlyArray<ProjectionQuotaBlockedStage>,
    ProjectionRepositoryError
  >;

  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionQuotaBlockedStage>,
    ProjectionRepositoryError
  >;
}

export class ProjectionQuotaBlockedStageRepository extends Context.Service<
  ProjectionQuotaBlockedStageRepository,
  ProjectionQuotaBlockedStageRepositoryShape
>()(
  "gedcode/persistence/Services/ProjectionQuotaBlockedStages/ProjectionQuotaBlockedStageRepository",
) {}
