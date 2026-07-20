import {
  CommandId,
  PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS,
  ProjectContextRunGitObjectId,
  ProjectContextRunId,
  ProjectContextRunPath,
  type OrchestrationProjectContextRun,
  type OrchestrationCommand,
  type ProjectContextRunBaselineManifest,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";

import { VcsProcess, type VcsProcessShape } from "../../vcs/VcsProcess.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { ProjectContextSnapshot } from "../../project/ProjectContext.ts";
import {
  captureProjectContextRunGitState,
  captureProjectContextWorkspaceStatus,
  sameProjectContextRunGitState,
  type ProjectContextWorkspaceStatusBaseline,
} from "../../project/ProjectContextRunChanges.ts";
import {
  ProjectContextScanner,
  type ProjectContextScannerShape,
} from "../../project/Services/ProjectContextScanner.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import { withProjectContextRunLifecycleLock } from "../projectContextRunLifecycleCoordinator.ts";
import {
  commitProjectContextRunReview,
  discardProjectContextRunReview,
  inspectProjectContextRunReview,
  ProjectContextRunReviewError,
  projectContextRunReviewPresentation,
} from "../projectContextRunReview.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProjectContextRunCoordinator,
  type ProjectContextRunCoordinatorShape,
  type ProjectContextRunRequestResult,
  type RequestProjectContextRunInput,
} from "../Services/ProjectContextRunCoordinator.ts";

type ProjectContextRunRequestCommand = Extract<
  OrchestrationCommand,
  { type: "project.context.run.request" }
>;

type DispatchProjectContextRunCommand = (
  command: ProjectContextRunRequestCommand,
) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError>;

export class ProjectContextRunCoordinatorError extends Data.TaggedError(
  "ProjectContextRunCoordinatorError",
)<{
  readonly projectId: RequestProjectContextRunInput["projectId"];
  readonly reason:
    | "project-not-found"
    | "project-deleted"
    | "workspace-changed-during-capture"
    | "symlinked-context-path";
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface ProjectContextRunCoordinatorServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly scanner: Pick<ProjectContextScannerShape, "scan">;
  readonly vcsProcess: Pick<VcsProcessShape, "run">;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}

export interface ProjectContextRunCoordinatorRuntime {
  readonly projectContextRunId: Effect.Effect<
    ProjectContextRunRequestResult["projectContextRunId"],
    PlatformError.PlatformError
  >;
  readonly commandId: Effect.Effect<
    ProjectContextRunRequestCommand["commandId"],
    PlatformError.PlatformError
  >;
  readonly createdAt: Effect.Effect<ProjectContextRunRequestCommand["createdAt"]>;
  readonly dispatch: DispatchProjectContextRunCommand;
}

const sameWorkspaceStatus = (
  before: ProjectContextWorkspaceStatusBaseline,
  after: ProjectContextWorkspaceStatusBaseline,
): boolean =>
  before.length === after.length &&
  before.every((entry, index) => {
    const current = after[index];
    return (
      current !== undefined &&
      entry.relativePath === current.relativePath &&
      entry.porcelainStatus === current.porcelainStatus &&
      entry.contentDigest === current.contentDigest
    );
  });

export const projectContextBaselineManifest = (
  snapshot: ProjectContextSnapshot,
): ProjectContextRunBaselineManifest =>
  snapshot.ownershipBaseline.files.map((file) => ({
    path: ProjectContextRunPath.make(file.relativePath),
    rawContent: file.state.presence === "present" ? file.state.content : null,
  }));

const rejectSymlinkedContextBaselinePaths = Effect.fn(
  "ProjectContextRunCoordinator.rejectSymlinkedContextBaselinePaths",
)(function* (input: {
  readonly projectId: RequestProjectContextRunInput["projectId"];
  readonly workspaceRoot: string;
  readonly snapshot: ProjectContextSnapshot;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}) {
  for (const file of input.snapshot.ownershipBaseline.files) {
    if (file.state.presence !== "present") continue;
    const linkTarget = yield* input.fileSystem
      .readLink(input.path.join(input.workspaceRoot, file.relativePath))
      .pipe(Effect.option);
    if (Option.isSome(linkTarget)) {
      return yield* new ProjectContextRunCoordinatorError({
        projectId: input.projectId,
        reason: "symlinked-context-path",
        detail: `Project context path '${file.relativePath}' is a symbolic link and cannot be edited safely.`,
      });
    }
  }
});

/**
 * Request a context run from facts captured exclusively by the server.
 *
 * The before/after Git-visible manifests make a scanner race fail closed:
 * even a change to an otherwise allowed context file rejects the request,
 * rather than persisting a baseline from an indeterminate point in time.
 */
export const requestProjectContextRunWithServices = Effect.fn(
  "requestProjectContextRunWithServices",
)(function* (
  services: ProjectContextRunCoordinatorServices,
  runtime: ProjectContextRunCoordinatorRuntime,
  input: RequestProjectContextRunInput,
) {
  const readModel = yield* services.snapshotQuery.getCommandReadModel();
  const project = readModel.projects.find((candidate) => candidate.id === input.projectId);
  if (project === undefined) {
    return yield* new ProjectContextRunCoordinatorError({
      projectId: input.projectId,
      reason: "project-not-found",
      detail: `Project '${input.projectId}' was not found and cannot start a project-context run.`,
    });
  }
  if (project.deletedAt !== null) {
    return yield* new ProjectContextRunCoordinatorError({
      projectId: input.projectId,
      reason: "project-deleted",
      detail: `Project '${input.projectId}' was deleted and cannot start a project-context run.`,
    });
  }

  const captureWorkspaceStatus = () =>
    captureProjectContextWorkspaceStatus({
      workspaceRoot: project.workspaceRoot,
      process: services.vcsProcess,
      fileSystem: services.fileSystem,
      path: services.path,
    });
  const workspaceStatusManifest = yield* captureWorkspaceStatus();
  const gitState = yield* captureProjectContextRunGitState({
    workspaceRoot: project.workspaceRoot,
    process: services.vcsProcess,
    fileSystem: services.fileSystem,
    path: services.path,
  });
  const snapshot = yield* services.scanner.scan(project.workspaceRoot);
  yield* rejectSymlinkedContextBaselinePaths({
    projectId: input.projectId,
    workspaceRoot: project.workspaceRoot,
    snapshot,
    fileSystem: services.fileSystem,
    path: services.path,
  });
  const workspaceStatusAfterScan = yield* captureWorkspaceStatus();
  const gitStateAfterScan = yield* captureProjectContextRunGitState({
    workspaceRoot: project.workspaceRoot,
    process: services.vcsProcess,
    fileSystem: services.fileSystem,
    path: services.path,
  });
  if (
    !sameWorkspaceStatus(workspaceStatusManifest, workspaceStatusAfterScan) ||
    !sameProjectContextRunGitState(gitState, gitStateAfterScan)
  ) {
    return yield* new ProjectContextRunCoordinatorError({
      projectId: input.projectId,
      reason: "workspace-changed-during-capture",
      detail:
        "Project workspace changed while capturing the project-context baseline; retry after the workspace is stable.",
    });
  }

  const projectContextRunId = yield* runtime.projectContextRunId;
  const result = yield* runtime.dispatch({
    type: "project.context.run.request",
    commandId: yield* runtime.commandId,
    projectContextRunId,
    projectId: input.projectId,
    expectedPrimaryCheckoutPath: project.workspaceRoot,
    mode: snapshot.promptKind,
    ...(input.tier === undefined ? {} : { tier: input.tier }),
    schemaVersion: snapshot.schemaVersion,
    fingerprint: snapshot.fingerprint,
    baselineManifest: projectContextBaselineManifest(snapshot),
    workspaceStatusManifest,
    gitState,
    createdAt: yield* runtime.createdAt,
  });
  return {
    ...result,
    projectContextRunId,
  } satisfies ProjectContextRunRequestResult;
});

export const makeProjectContextRunCoordinator = Effect.gen(function* () {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const scanner = yield* ProjectContextScanner;
  const vcsProcess = yield* VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const serverSettings = yield* ServerSettingsService;

  const reviewServices = (run: OrchestrationProjectContextRun) => ({
    scan: (workspaceRoot: string) =>
      scanner.scan(workspaceRoot).pipe(
        Effect.mapError(
          (error) =>
            new ProjectContextRunReviewError({
              projectContextRunId: run.id,
              detail: error.message,
            }),
        ),
      ),
    vcsProcess,
    fileSystem,
    path,
  });

  const loadPendingReview = Effect.fn("ProjectContextRunCoordinator.loadPendingReview")(function* (
    runId: ProjectContextRunId,
  ) {
    const readModel = yield* snapshotQuery.getCommandReadModel();
    const run = readModel.projectContextRuns.find((candidate) => candidate.id === runId);
    if (run === undefined) {
      return yield* new ProjectContextRunReviewError({
        projectContextRunId: runId,
        detail: `Project-context run '${runId}' was not found.`,
      });
    }
    if (run.status !== "pending-review") {
      return yield* new ProjectContextRunReviewError({
        projectContextRunId: runId,
        detail: `Project-context run '${runId}' does not have a pending review.`,
      });
    }
    const project = readModel.projects.find((candidate) => candidate.id === run.projectId);
    if (
      project === undefined ||
      project.deletedAt !== null ||
      project.workspaceRoot !== run.primaryCheckoutPath
    ) {
      return yield* new ProjectContextRunReviewError({
        projectContextRunId: runId,
        detail:
          "The project primary checkout changed or became unavailable after this context run.",
      });
    }
    return run;
  });

  const commandId = (kind: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:project-context-run-${kind}:${uuid}`)),
    );

  const createdAt = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const request = (input: RequestProjectContextRunInput) =>
    Effect.gen(function* () {
      const currentSettings = yield* serverSettings.getSettings;
      const tier = input.tier ?? currentSettings.orchestratorDefaults.projectContextDefaultTier;

      // A picker selection is a durable global preference, not a transient
      // client hint. Save it before dispatching the run so reconnects and the
      // other surface resolve the same default. A failed run does not erase a
      // deliberate preference selection.
      if (
        input.tier !== undefined &&
        input.tier !== currentSettings.orchestratorDefaults.projectContextDefaultTier
      ) {
        yield* serverSettings.updateSettings({
          orchestratorDefaults: {
            ...currentSettings.orchestratorDefaults,
            projectContextDefaultTier: input.tier,
          },
        });
      }

      return yield* requestProjectContextRunWithServices(
        { snapshotQuery, scanner, vcsProcess, fileSystem, path },
        {
          projectContextRunId: crypto.randomUUIDv4.pipe(Effect.map(ProjectContextRunId.make)),
          commandId: crypto.randomUUIDv4.pipe(
            Effect.map((uuid) => CommandId.make(`server:project-context-run-request:${uuid}`)),
          ),
          createdAt: DateTime.now.pipe(Effect.map(DateTime.formatIso)),
          dispatch: engine.dispatch,
        },
        { projectId: input.projectId, tier },
      );
    });

  const getReview: ProjectContextRunCoordinatorShape["getReview"] = (input) =>
    snapshotQuery.getCommandReadModel().pipe(
      Effect.map((readModel) => {
        const run = readModel.projectContextRuns
          .filter(
            (candidate) =>
              candidate.projectId === input.projectId && candidate.status === "pending-review",
          )
          .toSorted(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              String(right.id).localeCompare(String(left.id)),
          )[0];
        return { review: run === undefined ? null : projectContextRunReviewPresentation(run) };
      }),
    );

  const revise: ProjectContextRunCoordinatorShape["revise"] = (input) =>
    withProjectContextRunLifecycleLock(
      input.runId,
      Effect.gen(function* () {
        const run = yield* loadPendingReview(input.runId);
        yield* inspectProjectContextRunReview(reviewServices(run), run);
        const prefix = [
          "Revise the current project-context proposal in the primary checkout.",
          "Keep every edit within the allowed project-context files and do not stage or commit.",
          "Apply this reviewer feedback:",
          "",
        ].join("\n");
        const prompt = `${prefix}${input.instructions.trim()}`.slice(
          0,
          PROJECT_CONTEXT_RUN_PROMPT_MAX_CHARS,
        );
        const result = yield* engine.dispatch({
          type: "project.context.run.revise",
          commandId: yield* commandId("revise"),
          projectContextRunId: run.id,
          prompt,
          createdAt: yield* createdAt,
        });
        return { runId: run.id, sequence: result.sequence };
      }),
    );

  const commit: ProjectContextRunCoordinatorShape["commit"] = (input) =>
    withProjectContextRunLifecycleLock(
      input.runId,
      Effect.gen(function* () {
        const run = yield* loadPendingReview(input.runId);
        const committed = yield* commitProjectContextRunReview(
          reviewServices(run),
          run,
          input.message,
        );
        if (committed.commitSha === null) {
          return yield* new ProjectContextRunReviewError({
            projectContextRunId: run.id,
            detail:
              "This context run has no changes to commit; discard the empty proposal instead.",
          });
        }
        const commitHash = ProjectContextRunGitObjectId.make(committed.commitSha);
        const snapshot = yield* scanner.scan(run.primaryCheckoutPath);
        const result = yield* engine.dispatch({
          type: "project.context.run.commit",
          commandId: yield* commandId("commit"),
          projectContextRunId: run.id,
          commitHash,
          resultSchemaVersion: snapshot.schemaVersion,
          resultFingerprint: snapshot.fingerprint,
          createdAt: yield* createdAt,
        });
        return { runId: run.id, commitHash, sequence: result.sequence };
      }),
    );

  const discard: ProjectContextRunCoordinatorShape["discard"] = (input) =>
    withProjectContextRunLifecycleLock(
      input.runId,
      Effect.gen(function* () {
        const run = yield* loadPendingReview(input.runId);
        yield* discardProjectContextRunReview(reviewServices(run), run);
        const snapshot = yield* scanner.scan(run.primaryCheckoutPath);
        const result = yield* engine.dispatch({
          type: "project.context.run.discard",
          commandId: yield* commandId("discard"),
          projectContextRunId: run.id,
          resultSchemaVersion: snapshot.schemaVersion,
          resultFingerprint: snapshot.fingerprint,
          createdAt: yield* createdAt,
        });
        return { runId: run.id, sequence: result.sequence };
      }),
    );

  return { request, getReview, revise, commit, discard };
});

export const ProjectContextRunCoordinatorLive = Layer.effect(
  ProjectContextRunCoordinator,
  makeProjectContextRunCoordinator,
);
