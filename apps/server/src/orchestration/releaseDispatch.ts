import {
  type CommandId,
  type DispatchResult,
  type OrchestrationCommand,
  type OrchestrationDispatchCommandError,
  type TaskId,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { createHash } from "node:crypto";

import type * as GitHubCli from "../sourceControl/GitHubCli.ts";
import type * as VcsProcess from "../vcs/VcsProcess.ts";
import type { OrchestrationDispatchError } from "./Errors.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";

export interface ReleaseDispatchParameters {
  readonly workflow: string;
  readonly ref: string;
  readonly inputs: Readonly<Record<string, string>>;
}

export function normalizeReleaseDispatchParameters(
  input: ReleaseDispatchParameters,
): ReleaseDispatchParameters {
  return {
    workflow: input.workflow.trim(),
    ref: input.ref.trim(),
    inputs: Object.fromEntries(
      Object.entries(input.inputs)
        .map(([key, value]) => [key.trim(), value] as const)
        .toSorted(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function releaseDispatchContentHash(input: ReleaseDispatchParameters): string {
  return createHash("sha256")
    .update(JSON.stringify(normalizeReleaseDispatchParameters(input)))
    .digest("hex");
}

export class OrchestrationReleaseDispatchError extends Data.TaggedError(
  "OrchestrationReleaseDispatchError",
)<{
  readonly taskId: TaskId;
  readonly reason:
    | "task-not-found"
    | "project-not-found"
    | "dirty-worktree"
    | "github-unavailable"
    | "dispatch-failed";
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

type ReleaseCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "task.release.dispatch.request"
      | "task.release.dispatch.complete"
      | "task.release.dispatch.fail";
  }
>;

type DispatchReleaseCommand = (
  command: ReleaseCommand,
) => Effect.Effect<DispatchResult, OrchestrationDispatchError | OrchestrationDispatchCommandError>;

export interface ReleaseDispatchServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly process: Pick<VcsProcess.VcsProcessShape, "run">;
  readonly github: Pick<GitHubCli.GitHubCliShape, "execute">;
}

export interface DispatchReleaseInput extends ReleaseDispatchParameters {
  readonly taskId: TaskId;
  readonly commandId: (purpose: string) => Effect.Effect<CommandId, PlatformError.PlatformError>;
  readonly createdAt: Effect.Effect<string, PlatformError.PlatformError>;
  readonly dispatch: DispatchReleaseCommand;
}

export const dispatchReleaseWithServices = Effect.fn("dispatchReleaseWithServices")(function* (
  services: ReleaseDispatchServices,
  rawInput: DispatchReleaseInput,
) {
  return yield* withTaskLifecycleLock(
    rawInput.taskId,
    Effect.gen(function* () {
      const input = { ...rawInput, ...normalizeReleaseDispatchParameters(rawInput) };
      const readModel = yield* services.snapshotQuery.getCommandReadModel();
      const task = readModel.tasks.find((entry) => entry.id === input.taskId);
      if (task === undefined) {
        return yield* new OrchestrationReleaseDispatchError({
          taskId: input.taskId,
          reason: "task-not-found",
          detail: `Task '${input.taskId}' was not found and cannot dispatch a release.`,
        });
      }
      if (task.releaseDispatch != null) {
        return {
          sequence: readModel.snapshotSequence,
          alreadyRequested: true,
          releaseDispatch: task.releaseDispatch,
        };
      }
      const project = readModel.projects.find((entry) => entry.id === task.projectId);
      if (project === undefined) {
        return yield* new OrchestrationReleaseDispatchError({
          taskId: input.taskId,
          reason: "project-not-found",
          detail: `Project '${task.projectId}' was not found for release task '${input.taskId}'.`,
        });
      }

      const clean = yield* services.process.run({
        operation: "OrchestrationReleaseDispatch.preflight",
        command: "git",
        args: ["status", "--porcelain"],
        cwd: project.workspaceRoot,
      });
      if (clean.stdout.trim() !== "") {
        return yield* new OrchestrationReleaseDispatchError({
          taskId: input.taskId,
          reason: "dirty-worktree",
          detail: `Project '${project.workspaceRoot}' has uncommitted changes; release dispatch was refused.`,
        });
      }

      const repository = yield* services.github
        .execute({
          cwd: project.workspaceRoot,
          args: ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestrationReleaseDispatchError({
                taskId: input.taskId,
                reason: "github-unavailable",
                detail: `Could not resolve the GitHub repository for release task '${input.taskId}'.`,
                cause,
              }),
          ),
        );
      const nameWithOwner = repository.stdout.trim();
      if (nameWithOwner.split("/").length !== 2) {
        return yield* new OrchestrationReleaseDispatchError({
          taskId: input.taskId,
          reason: "github-unavailable",
          detail: `GitHub returned an invalid repository identity for release task '${input.taskId}'.`,
        });
      }

      const contentHash = releaseDispatchContentHash(input);
      const requestedAt = yield* input.createdAt;
      const requested = yield* input.dispatch({
        type: "task.release.dispatch.request",
        commandId: yield* input.commandId("release-dispatch-request"),
        taskId: input.taskId,
        workflow: input.workflow,
        ref: input.ref,
        inputs: input.inputs,
        contentHash,
        createdAt: requestedAt,
      });

      const workflowUrl = `https://github.com/${nameWithOwner}/actions/workflows/${encodeURIComponent(input.workflow)}`;
      const args = ["workflow", "run", input.workflow, "--ref", input.ref];
      for (const [key, value] of Object.entries(input.inputs)) {
        args.push("-f", `${key}=${value}`);
      }
      const dispatchResult = yield* services.github
        .execute({ cwd: project.workspaceRoot, args })
        .pipe(Effect.result);
      const completedAt = yield* input.createdAt;
      if (dispatchResult._tag === "Failure") {
        yield* input.dispatch({
          type: "task.release.dispatch.fail",
          commandId: yield* input.commandId("release-dispatch-fail"),
          taskId: input.taskId,
          message: dispatchResult.failure.message || "GitHub workflow dispatch failed.",
          createdAt: completedAt,
        });
        return yield* new OrchestrationReleaseDispatchError({
          taskId: input.taskId,
          reason: "dispatch-failed",
          detail: `GitHub workflow dispatch failed for release task '${input.taskId}'.`,
          cause: dispatchResult.failure,
        });
      }

      const completed = yield* input.dispatch({
        type: "task.release.dispatch.complete",
        commandId: yield* input.commandId("release-dispatch-complete"),
        taskId: input.taskId,
        workflowUrl,
        createdAt: completedAt,
      });
      return {
        sequence: completed.sequence,
        requestedSequence: requested.sequence,
        alreadyRequested: false,
        releaseDispatch: {
          status: "dispatched" as const,
          workflow: input.workflow,
          ref: input.ref,
          inputs: input.inputs,
          contentHash,
          workflowUrl,
          failureMessage: null,
          requestedAt,
          updatedAt: completedAt,
        },
      };
    }),
  );
});
