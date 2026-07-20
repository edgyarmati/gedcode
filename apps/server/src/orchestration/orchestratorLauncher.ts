// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import {
  OrchestratorLaunchError,
  type OrchestrationReadModel,
  type OrchestratorLaunchCapabilities,
  type OrchestratorLaunchInput,
  type OrchestratorLaunchResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import type { ExternalLauncherShape } from "../process/externalLauncher.ts";
import { resolveExternalLauncherAvailability } from "../process/externalLauncher.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { isDeterministicTaskWorktreePath, taskOwnsWorktree } from "./taskWorktreeLease.ts";

type OrchestratorLauncherServices = {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly externalLauncher: ExternalLauncherShape;
  readonly getCapabilities: () => OrchestratorLaunchCapabilities;
};

const launchError = (reason: OrchestratorLaunchError["reason"], message: string, cause?: unknown) =>
  new OrchestratorLaunchError({ reason, message, ...(cause === undefined ? {} : { cause }) });

export function getOrchestratorLaunchCapabilities(): OrchestratorLaunchCapabilities {
  const available = resolveExternalLauncherAvailability();
  return {
    editors: [...available.editors],
    reveal: available.fileManager,
    terminal: available.terminal,
  };
}

export const resolveOwnedOrchestratorLaunchTarget = Effect.fn(
  "resolveOwnedOrchestratorLaunchTarget",
)(function* (input: OrchestratorLaunchInput, readModel: OrchestrationReadModel) {
  const target = input.target;
  if (target.kind === "project-root") {
    const project = readModel.projects.find((candidate) => candidate.id === target.projectId);
    if (!project) {
      return yield* launchError(
        "project-not-found",
        `Project '${target.projectId}' was not found.`,
      );
    }
    return path.resolve(project.workspaceRoot);
  }

  const task = readModel.tasks.find((candidate) => candidate.id === target.taskId);
  if (!task) {
    return yield* launchError("task-not-found", `Task '${target.taskId}' was not found.`);
  }
  if (task.projectId !== target.projectId) {
    return yield* launchError(
      "project-mismatch",
      `Task '${task.id}' does not belong to project '${target.projectId}'.`,
    );
  }
  const project = readModel.projects.find((candidate) => candidate.id === target.projectId);
  if (!project) {
    return yield* launchError("project-not-found", `Project '${target.projectId}' was not found.`);
  }
  if (task.worktreePath === null || !taskOwnsWorktree(task)) {
    return yield* launchError(
      "worktree-unavailable",
      `Task '${task.id}' does not own an available worktree.`,
    );
  }
  if (
    !isDeterministicTaskWorktreePath({
      workspaceRoot: project.workspaceRoot,
      taskId: String(task.id),
      worktreePath: task.worktreePath,
    })
  ) {
    return yield* launchError(
      "target-not-owned",
      `Task '${task.id}' worktree is outside its managed project path.`,
    );
  }
  return path.resolve(task.worktreePath);
});

export const launchOwnedOrchestratorTarget = Effect.fn("launchOwnedOrchestratorTarget")(function* (
  input: OrchestratorLaunchInput,
  services: OrchestratorLauncherServices,
): Effect.fn.Return<OrchestratorLaunchResult, OrchestratorLaunchError, FileSystem.FileSystem> {
  const fileSystem = yield* FileSystem.FileSystem;
  const readModel = yield* services.snapshotQuery
    .getCommandReadModel()
    .pipe(
      Effect.mapError((cause) =>
        launchError(
          "projection-unavailable",
          "Could not load Orchestrator launch ownership.",
          cause,
        ),
      ),
    );
  const targetPath = yield* resolveOwnedOrchestratorLaunchTarget(input, readModel);
  const targetInfo = yield* fileSystem
    .stat(targetPath)
    .pipe(
      Effect.mapError((cause) =>
        launchError("target-unavailable", "The launch target no longer exists.", cause),
      ),
    );
  if (targetInfo.type !== "Directory") {
    return yield* launchError("target-unavailable", "The launch target is not a directory.");
  }

  const capabilities = services.getCapabilities();
  switch (input.operation.kind) {
    case "editor":
      if (!capabilities.editors.includes(input.operation.editor)) {
        return yield* launchError(
          "capability-unavailable",
          `Editor '${input.operation.editor}' is not available in this environment.`,
        );
      }
      yield* services.externalLauncher
        .launchEditor({ cwd: targetPath, editor: input.operation.editor })
        .pipe(
          Effect.mapError((cause) =>
            launchError(
              "launcher-failed",
              "The external application could not be launched.",
              cause,
            ),
          ),
        );
      break;
    case "reveal":
      if (!capabilities.reveal) {
        return yield* launchError(
          "capability-unavailable",
          "File manager launch is not available in this environment.",
        );
      }
      yield* services.externalLauncher
        .launchFileManager(targetPath)
        .pipe(
          Effect.mapError((cause) =>
            launchError(
              "launcher-failed",
              "The external application could not be launched.",
              cause,
            ),
          ),
        );
      break;
    case "terminal":
      if (!capabilities.terminal) {
        return yield* launchError(
          "capability-unavailable",
          "Terminal launch is not available in this environment.",
        );
      }
      yield* services.externalLauncher
        .launchTerminal(targetPath)
        .pipe(
          Effect.mapError((cause) =>
            launchError(
              "launcher-failed",
              "The external application could not be launched.",
              cause,
            ),
          ),
        );
      break;
  }

  return { launched: true, target: input.target, operation: input.operation };
});
