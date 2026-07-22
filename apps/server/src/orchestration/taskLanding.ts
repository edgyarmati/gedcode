import {
  type CommandId,
  type DispatchResult,
  type GateId,
  type OrchestrationCommand,
  type OrchestrationDispatchCommandError,
  type TaskId,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import type { OrchestrationDispatchError } from "./Errors.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";
import { inspectTaskWorktreeCompletion } from "./worktreeCompletion.ts";

type LandOrchestrationTaskError =
  | OrchestrationLandTaskError
  | OrchestrationDispatchError
  | OrchestrationDispatchCommandError
  | ProjectionRepositoryError
  | PlatformError.PlatformError;

type DispatchLandCommand = (
  command: Extract<
    OrchestrationCommand,
    { type: "task.land" | "task.landing.retry" | "task.land.approve" }
  >,
) => Effect.Effect<DispatchResult, OrchestrationDispatchError | OrchestrationDispatchCommandError>;

export class OrchestrationLandTaskError extends Data.TaggedError("OrchestrationLandTaskError")<{
  readonly taskId: TaskId;
  readonly reason: "task-not-found" | "worktree-unavailable";
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface LandOrchestrationTaskServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly vcsProcess: Pick<VcsProcessShape, "run">;
}

export interface LandOrchestrationTaskInput {
  readonly taskId: TaskId;
  readonly commandId: Effect.Effect<CommandId, LandOrchestrationTaskError>;
  readonly createdAt: Effect.Effect<string, LandOrchestrationTaskError>;
  readonly dispatch: DispatchLandCommand;
}

export interface ApproveOrchestrationLandTaskInput {
  readonly taskId: TaskId;
  readonly gateId: GateId;
  readonly approvedHash: string;
  readonly commandId: Effect.Effect<CommandId, LandOrchestrationTaskError>;
  readonly createdAt: Effect.Effect<string, LandOrchestrationTaskError>;
  readonly dispatch: DispatchLandCommand;
}

export const landOrchestrationTaskWithServices = Effect.fn("landOrchestrationTaskWithServices")(
  function* (services: LandOrchestrationTaskServices, input: LandOrchestrationTaskInput) {
    return yield* withTaskLifecycleLock(
      input.taskId,
      Effect.gen(function* () {
        const readModel = yield* services.snapshotQuery.getCommandReadModel();
        const task = readModel.tasks.find((entry) => entry.id === input.taskId);
        if (task === undefined) {
          return yield* new OrchestrationLandTaskError({
            taskId: input.taskId,
            reason: "task-not-found",
            detail: `Task '${input.taskId}' was not found and cannot be landed.`,
          });
        }
        if (task.worktreePath === null) {
          return yield* new OrchestrationLandTaskError({
            taskId: input.taskId,
            reason: "worktree-unavailable",
            detail: `Task '${input.taskId}' does not have an owned worktree to inspect before landing.`,
          });
        }
        if (task.prUrl !== null || task.landing?.status === "completed") {
          return {
            sequence: readModel.snapshotSequence,
            alreadyLanded: true,
            alreadyInProgress: false,
          };
        }
        if (task.landing?.status === "opening-pr") {
          return {
            sequence: readModel.snapshotSequence,
            alreadyLanded: false,
            alreadyInProgress: true,
          };
        }
        if (task.landing?.status === "failed") {
          const worktreeCompletion = yield* inspectTaskWorktreeCompletion({
            worktreePath: task.worktreePath,
            process: services.vcsProcess,
          });
          const result = yield* input.dispatch({
            type: "task.landing.retry",
            commandId: yield* input.commandId,
            taskId: input.taskId,
            worktreeCompletion,
            createdAt: yield* input.createdAt,
          });
          return { ...result, alreadyLanded: false, alreadyInProgress: false };
        }

        const worktreeCompletion = yield* inspectTaskWorktreeCompletion({
          worktreePath: task.worktreePath,
          process: services.vcsProcess,
        });
        const result = yield* input.dispatch({
          type: "task.land",
          commandId: yield* input.commandId,
          taskId: input.taskId,
          worktreeCompletion,
          createdAt: yield* input.createdAt,
        });
        return { ...result, alreadyLanded: false, alreadyInProgress: false };
      }),
    );
  },
);

/**
 * Treat a human land-gate approval as the landing actuator itself. The decider
 * appends both `task.gate-resolved` and `task.landed` in one command, while
 * this service supplies the server-observed worktree state needed to preserve
 * exact-HEAD verification.
 */
export const approveOrchestrationLandTaskWithServices = Effect.fn(
  "approveOrchestrationLandTaskWithServices",
)(function* (services: LandOrchestrationTaskServices, input: ApproveOrchestrationLandTaskInput) {
  return yield* withTaskLifecycleLock(
    input.taskId,
    Effect.gen(function* () {
      const readModel = yield* services.snapshotQuery.getCommandReadModel();
      const task = readModel.tasks.find((entry) => entry.id === input.taskId);
      if (task === undefined) {
        return yield* new OrchestrationLandTaskError({
          taskId: input.taskId,
          reason: "task-not-found",
          detail: `Task '${input.taskId}' was not found and cannot be approved for landing.`,
        });
      }
      if (task.worktreePath === null) {
        return yield* new OrchestrationLandTaskError({
          taskId: input.taskId,
          reason: "worktree-unavailable",
          detail: `Task '${input.taskId}' does not have an owned worktree to inspect before landing approval.`,
        });
      }
      if (task.prUrl !== null || task.landing?.status === "completed") {
        return {
          sequence: readModel.snapshotSequence,
          alreadyLanded: true,
          alreadyInProgress: false,
        };
      }
      if (task.landing?.status === "opening-pr") {
        return {
          sequence: readModel.snapshotSequence,
          alreadyLanded: false,
          alreadyInProgress: true,
        };
      }

      const worktreeCompletion = yield* inspectTaskWorktreeCompletion({
        worktreePath: task.worktreePath,
        process: services.vcsProcess,
      });
      const result = yield* input.dispatch({
        type: "task.land.approve",
        commandId: yield* input.commandId,
        taskId: input.taskId,
        gateId: input.gateId,
        approvedHash: input.approvedHash,
        worktreeCompletion,
        createdAt: yield* input.createdAt,
      });
      return { ...result, alreadyLanded: false, alreadyInProgress: false };
    }),
  );
});
