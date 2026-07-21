import type { OrchestrationReadModel, ProjectContextRunId, ProjectId } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { GedSchemaInspection } from "../project/GedManifest.ts";
import type { GedManifestManagerShape } from "../project/Services/GedManifest.ts";

export type GedManifestBeforePmTurnState =
  | { readonly status: "ready" }
  | { readonly status: "maintenance-active"; readonly projectContextRunId: ProjectContextRunId }
  | { readonly status: "maintenance-started"; readonly projectContextRunId: ProjectContextRunId };

export class GedManifestMaintenanceError extends Data.TaggedError("GedManifestMaintenanceError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export const toGedManifestMaintenanceError = (cause: unknown): GedManifestMaintenanceError =>
  cause instanceof GedManifestMaintenanceError
    ? cause
    : new GedManifestMaintenanceError({
        detail: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

export interface GedManifestBeforePmTurnServices {
  readonly readModel: Effect.Effect<OrchestrationReadModel, GedManifestMaintenanceError>;
  readonly manifests: {
    readonly inspect: (
      workspaceRoot: string,
    ) => Effect.Effect<GedSchemaInspection, GedManifestMaintenanceError>;
    readonly adoptLegacy: (
      input: Parameters<GedManifestManagerShape["adoptLegacy"]>[0],
    ) => Effect.Effect<GedSchemaInspection, GedManifestMaintenanceError>;
  };
  readonly request: (
    projectId: ProjectId,
  ) => Effect.Effect<
    { readonly projectContextRunId: ProjectContextRunId },
    GedManifestMaintenanceError
  >;
  readonly now: Effect.Effect<string, GedManifestMaintenanceError>;
  readonly generatedBy: Effect.Effect<string, GedManifestMaintenanceError>;
}

export const ensureGedManifestBeforePmTurnWithServices = Effect.fn(
  "ensureGedManifestBeforePmTurnWithServices",
)(function* (services: GedManifestBeforePmTurnServices, projectId: ProjectId) {
  const readModel = yield* services.readModel;
  const project = readModel.projects.find((candidate) => candidate.id === projectId);
  if (project === undefined || project.deletedAt !== null) {
    return yield* new GedManifestMaintenanceError({
      detail: `Project '${projectId}' is unavailable for GED manifest maintenance.`,
    });
  }
  const active = readModel.projectContextRuns.find(
    (run) =>
      run.projectId === projectId &&
      (run.status === "pending" || run.status === "running" || run.status === "pending-review"),
  );
  if (active !== undefined) {
    return { status: "maintenance-active", projectContextRunId: active.id } as const;
  }
  const inspection = yield* services.manifests.inspect(project.workspaceRoot);
  if (inspection.status === "current") return { status: "ready" } as const;
  if (inspection.status === "newer") {
    return yield* new GedManifestMaintenanceError({
      detail: `Project context requires a newer GedCode version (schema ${inspection.sourceSchemaVersion}).`,
    });
  }
  if (inspection.status === "legacy") {
    yield* services.manifests.adoptLegacy({
      workspaceRoot: project.workspaceRoot,
      now: yield* services.now,
      generatedBy: yield* services.generatedBy,
    });
    return { status: "ready" } as const;
  }
  const result = yield* services.request(projectId);
  return {
    status: "maintenance-started",
    projectContextRunId: result.projectContextRunId,
  } as const;
});
