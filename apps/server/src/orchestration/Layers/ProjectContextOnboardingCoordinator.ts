import {
  CommandId,
  type OrchestrationCommand,
  type OrchestratorGetProjectContextOnboardingInput,
  type OrchestratorGetProjectContextOnboardingResult,
  type ProjectContextResolution,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  shouldPromptForProjectContext,
  type ProjectContextSnapshot,
} from "../../project/ProjectContext.ts";
import { ProjectContextScanner } from "../../project/Services/ProjectContextScanner.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProjectContextOnboardingCoordinator,
  type ProjectContextOnboardingCoordinatorShape,
} from "../Services/ProjectContextOnboardingCoordinator.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const ACTIVE_CONTEXT_RUN_STATUSES = new Set(["pending", "running", "pending-review"]);

type ProjectContextResolveCommand = Extract<
  OrchestrationCommand,
  { type: "project.context.resolve" }
>;

export class ProjectContextOnboardingCoordinatorError extends Data.TaggedError(
  "ProjectContextOnboardingCoordinatorError",
)<{
  readonly projectId: OrchestratorGetProjectContextOnboardingInput["projectId"];
  readonly reason: "project-not-found" | "project-deleted" | "project-changed" | "stale-context";
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

const presentation = (input: {
  readonly projectId: OrchestratorGetProjectContextOnboardingInput["projectId"];
  readonly snapshot: ProjectContextSnapshot;
  readonly resolution: ProjectContextResolution | null;
  readonly hasActiveRunForSnapshot: boolean;
}): OrchestratorGetProjectContextOnboardingResult => ({
  projectId: input.projectId,
  schemaVersion: input.snapshot.schemaVersion,
  fingerprint: input.snapshot.fingerprint,
  promptKind: input.snapshot.promptKind,
  files: input.snapshot.files.map((file) => ({
    path: file.relativePath,
    classification: file.classification,
  })),
  shouldPrompt:
    !input.hasActiveRunForSnapshot &&
    shouldPromptForProjectContext(input.snapshot, input.resolution),
});

export const makeProjectContextOnboardingCoordinator = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const scanner = yield* ProjectContextScanner;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const readLiveProject = (projectId: OrchestratorGetProjectContextOnboardingInput["projectId"]) =>
    snapshotQuery.getCommandReadModel().pipe(
      Effect.flatMap((readModel) => {
        const project = readModel.projects.find((candidate) => candidate.id === projectId);
        if (project === undefined) {
          return Effect.fail(
            new ProjectContextOnboardingCoordinatorError({
              projectId,
              reason: "project-not-found",
              detail: `Project '${projectId}' was not found while checking project context.`,
            }),
          );
        }
        if (project.deletedAt !== null) {
          return Effect.fail(
            new ProjectContextOnboardingCoordinatorError({
              projectId,
              reason: "project-deleted",
              detail: `Project '${projectId}' was deleted and cannot use project context onboarding.`,
            }),
          );
        }
        return Effect.succeed({ readModel, project });
      }),
    );

  const get: ProjectContextOnboardingCoordinatorShape["get"] = (input) =>
    Effect.gen(function* () {
      const before = yield* readLiveProject(input.projectId);
      const snapshot = yield* scanner.scan(before.project.workspaceRoot);
      const after = yield* readLiveProject(input.projectId);
      if (after.project.workspaceRoot !== before.project.workspaceRoot) {
        return yield* new ProjectContextOnboardingCoordinatorError({
          projectId: input.projectId,
          reason: "project-changed",
          detail: `Project '${input.projectId}' changed workspace while scanning project context; retry.`,
        });
      }
      return presentation({
        projectId: input.projectId,
        snapshot,
        resolution: after.project.projectContextResolution ?? null,
        hasActiveRunForSnapshot: after.readModel.projectContextRuns.some(
          (run) =>
            run.projectId === input.projectId &&
            run.schemaVersion === snapshot.schemaVersion &&
            run.fingerprint === snapshot.fingerprint &&
            ACTIVE_CONTEXT_RUN_STATUSES.has(run.status),
        ),
      });
    });

  const dismiss: ProjectContextOnboardingCoordinatorShape["dismiss"] = (input) =>
    Effect.gen(function* () {
      const before = yield* readLiveProject(input.projectId);
      const snapshot = yield* scanner.scan(before.project.workspaceRoot);
      const after = yield* readLiveProject(input.projectId);
      if (after.project.workspaceRoot !== before.project.workspaceRoot) {
        return yield* new ProjectContextOnboardingCoordinatorError({
          projectId: input.projectId,
          reason: "project-changed",
          detail: `Project '${input.projectId}' changed workspace while scanning project context; retry.`,
        });
      }
      if (
        snapshot.schemaVersion !== input.schemaVersion ||
        snapshot.fingerprint !== input.fingerprint
      ) {
        return yield* new ProjectContextOnboardingCoordinatorError({
          projectId: input.projectId,
          reason: "stale-context",
          detail:
            "Project context changed since this prompt was shown; review the current context instead.",
        });
      }
      const result = yield* engine.dispatch({
        type: "project.context.resolve",
        commandId: yield* crypto.randomUUIDv4.pipe(
          Effect.map((uuid) => CommandId.make(`server:project-context-dismiss:${uuid}`)),
        ),
        projectId: input.projectId,
        schemaVersion: input.schemaVersion,
        fingerprint: input.fingerprint,
        outcome: "dismissed",
        resolvedAt: yield* DateTime.now.pipe(Effect.map(DateTime.formatIso)),
      } satisfies ProjectContextResolveCommand);
      return { sequence: result.sequence };
    });

  return { get, dismiss } satisfies ProjectContextOnboardingCoordinatorShape;
});

export const ProjectContextOnboardingCoordinatorLive = Layer.effect(
  ProjectContextOnboardingCoordinator,
  makeProjectContextOnboardingCoordinator,
);
