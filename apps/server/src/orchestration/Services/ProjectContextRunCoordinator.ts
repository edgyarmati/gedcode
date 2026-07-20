import {
  type OrchestrationCapabilityTier,
  type ProjectContextRunId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface RequestProjectContextRunInput {
  readonly projectId: ProjectId;
  readonly tier?: OrchestrationCapabilityTier;
}

export interface ProjectContextRunRequestResult {
  readonly sequence: number;
  readonly projectContextRunId: ProjectContextRunId;
}

export interface ProjectContextRunCoordinatorShape {
  /**
   * Capture the server-owned project-context baseline and request one durable
   * context run. The caller cannot provide workspace paths or baseline data.
   */
  readonly request: (
    input: RequestProjectContextRunInput,
  ) => Effect.Effect<ProjectContextRunRequestResult, unknown>;
}

export class ProjectContextRunCoordinator extends Context.Service<
  ProjectContextRunCoordinator,
  ProjectContextRunCoordinatorShape
>()("gedcode/orchestration/Services/ProjectContextRunCoordinator") {}
