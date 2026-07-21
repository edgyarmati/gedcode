import {
  type OrchestrationCapabilityTier,
  type OrchestratorResolveProjectContextRunStartInput,
  type OrchestratorResolveProjectContextRunStartResult,
  type OrchestratorCancelProjectContextRunStartInput,
  type OrchestratorCancelProjectContextRunStartResult,
  type OrchestratorGetProjectContextRunReviewInput,
  type OrchestratorGetProjectContextRunReviewResult,
  type OrchestratorResolveProjectContextRunAttentionInput,
  type OrchestratorResolveProjectContextRunAttentionResult,
  type ProjectContextRunId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { GedManifestMaintenanceError } from "../gedManifestMaintenance.ts";

export interface RequestProjectContextRunInput {
  readonly projectId: ProjectId;
  readonly tier?: OrchestrationCapabilityTier;
}

export interface ProjectContextRunRequestResult {
  readonly sequence: number;
  readonly projectContextRunId: ProjectContextRunId;
}

export interface ProjectContextRunCoordinatorShape {
  readonly ensureBeforePmTurn: (
    projectId: ProjectId,
  ) => Effect.Effect<
    | { readonly status: "ready" }
    | { readonly status: "maintenance-active"; readonly projectContextRunId: ProjectContextRunId }
    | { readonly status: "maintenance-started"; readonly projectContextRunId: ProjectContextRunId },
    GedManifestMaintenanceError
  >;
  /**
   * Capture the server-owned project-context baseline and request one durable
   * context run. The caller cannot provide workspace paths or baseline data.
   */
  readonly request: (
    input: RequestProjectContextRunInput,
  ) => Effect.Effect<ProjectContextRunRequestResult, unknown>;
  readonly resolveStart: (
    input: OrchestratorResolveProjectContextRunStartInput,
  ) => Effect.Effect<OrchestratorResolveProjectContextRunStartResult, unknown>;
  readonly cancelStart: (
    input: OrchestratorCancelProjectContextRunStartInput,
  ) => Effect.Effect<OrchestratorCancelProjectContextRunStartResult, unknown>;
  readonly getReview: (
    input: OrchestratorGetProjectContextRunReviewInput,
  ) => Effect.Effect<OrchestratorGetProjectContextRunReviewResult, unknown>;
  readonly resolveAttention: (
    input: OrchestratorResolveProjectContextRunAttentionInput,
  ) => Effect.Effect<OrchestratorResolveProjectContextRunAttentionResult, unknown>;
}

export class ProjectContextRunCoordinator extends Context.Service<
  ProjectContextRunCoordinator,
  ProjectContextRunCoordinatorShape
>()("gedcode/orchestration/Services/ProjectContextRunCoordinator") {}
