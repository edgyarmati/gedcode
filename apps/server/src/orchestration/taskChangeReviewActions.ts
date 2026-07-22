import {
  type CommandId,
  type DispatchResult,
  type OrchestrationCapabilityTier,
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
import {
  commitTaskWorktreeChanges,
  discardTaskWorktreeChanges,
  inspectTaskWorktreeChanges,
  type TaskWorktreeChanges,
} from "./taskChangeReview.ts";
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";
import { inspectTaskNoChangeEvidence } from "./taskNoChange.ts";

type ChangeReviewCommand = Extract<
  OrchestrationCommand,
  {
    type:
      | "task.change-review.resolve"
      | "task.change-review.request"
      | "task.stage.start"
      | "task.no-changes-needed";
  }
>;

type DispatchChangeReviewCommand = (
  command: ChangeReviewCommand,
) => Effect.Effect<DispatchResult, OrchestrationDispatchError | OrchestrationDispatchCommandError>;

type TaskChangeReviewActionError =
  | OrchestrationTaskChangeReviewActionError
  | OrchestrationDispatchError
  | OrchestrationDispatchCommandError
  | ProjectionRepositoryError
  | PlatformError.PlatformError;

export class OrchestrationTaskChangeReviewActionError extends Data.TaggedError(
  "OrchestrationTaskChangeReviewActionError",
)<{
  readonly taskId: TaskId;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface TaskChangeReviewActionServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly vcsProcess: Pick<VcsProcessShape, "run">;
}

export interface TaskChangeReviewActionInput {
  readonly taskId: TaskId;
  readonly commandId: (tag: string) => Effect.Effect<CommandId, TaskChangeReviewActionError>;
  readonly createdAt: Effect.Effect<string, TaskChangeReviewActionError>;
  readonly dispatch: DispatchChangeReviewCommand;
}

const actionError = (taskId: TaskId, detail: string) =>
  new OrchestrationTaskChangeReviewActionError({ taskId, detail });

const loadPendingChangeReview = Effect.fn("loadPendingChangeReview")(function* (
  services: TaskChangeReviewActionServices,
  taskId: TaskId,
) {
  const readModel = yield* services.snapshotQuery.getCommandReadModel();
  const task = readModel.tasks.find((entry) => entry.id === taskId);
  if (task === undefined) {
    return yield* actionError(taskId, `Task '${taskId}' was not found.`);
  }
  if (task.worktreePath === null) {
    return yield* actionError(taskId, `Task '${taskId}' does not own a worktree.`);
  }
  if (task.status !== "change-review" || task.changeReview?.status !== "pending") {
    return yield* actionError(taskId, `Task '${taskId}' does not have a pending change review.`);
  }
  return task;
});

const settleOrRefresh = Effect.fn("settleOrRefreshTaskChangeReview")(function* (
  services: TaskChangeReviewActionServices,
  input: TaskChangeReviewActionInput & {
    readonly changes: TaskWorktreeChanges;
    readonly resolution: "committed" | "discarded";
  },
) {
  const task = yield* loadPendingChangeReview(services, input.taskId);
  const workStageThreadId = task.changeReview?.workStageThreadId;
  if (workStageThreadId === undefined) {
    return yield* actionError(
      input.taskId,
      `Task '${input.taskId}' lost its change-review context.`,
    );
  }
  const stageRole = task.changeReview?.stageRole ?? "work";
  let result = yield* input.dispatch({
    type: "task.change-review.resolve",
    commandId: yield* input.commandId(`change-review-${input.resolution}`),
    taskId: input.taskId,
    resolution: input.resolution,
    createdAt: yield* input.createdAt,
  });
  if (input.changes.dirty) {
    result = yield* input.dispatch({
      type: "task.change-review.request",
      commandId: yield* input.commandId("change-review-remaining"),
      taskId: input.taskId,
      stageRole,
      ...(task.changeReview?.finalizationError === undefined
        ? {}
        : { finalizationError: task.changeReview.finalizationError }),
      workStageThreadId,
      detectedHead: input.changes.head,
      createdAt: yield* input.createdAt,
    });
  }
  return result;
});

export const inspectOrchestratorTaskChanges = Effect.fn("inspectOrchestratorTaskChanges")(
  function* (services: TaskChangeReviewActionServices, taskId: TaskId) {
    const task = yield* loadPendingChangeReview(services, taskId);
    return yield* inspectTaskWorktreeChanges({
      worktreePath: task.worktreePath as string,
      process: services.vcsProcess,
    });
  },
);

export const commitOrchestratorTaskChanges = Effect.fn("commitOrchestratorTaskChanges")(function* (
  services: TaskChangeReviewActionServices,
  input: TaskChangeReviewActionInput & {
    readonly paths?: ReadonlyArray<string>;
    readonly patch?: string;
    readonly message: string;
  },
) {
  return yield* withTaskLifecycleLock(
    input.taskId,
    Effect.gen(function* () {
      const task = yield* loadPendingChangeReview(services, input.taskId);
      const result = yield* commitTaskWorktreeChanges({
        worktreePath: task.worktreePath as string,
        process: services.vcsProcess,
        ...(input.paths === undefined ? {} : { paths: input.paths }),
        ...(input.patch === undefined ? {} : { patch: input.patch }),
        message: input.message,
      });
      const settled = yield* settleOrRefresh(services, {
        ...input,
        changes: result.changes,
        resolution: "committed",
      });
      return { ...result, sequence: settled.sequence };
    }),
  );
});

export const discardOrchestratorTaskChanges = Effect.fn("discardOrchestratorTaskChanges")(
  function* (
    services: TaskChangeReviewActionServices,
    input: TaskChangeReviewActionInput & { readonly paths: ReadonlyArray<string> },
  ) {
    return yield* withTaskLifecycleLock(
      input.taskId,
      Effect.gen(function* () {
        const task = yield* loadPendingChangeReview(services, input.taskId);
        const result = yield* discardTaskWorktreeChanges({
          worktreePath: task.worktreePath as string,
          process: services.vcsProcess,
          paths: input.paths,
        });
        const settled = yield* settleOrRefresh(services, {
          ...input,
          changes: result.changes,
          resolution: "discarded",
        });
        return { ...result, sequence: settled.sequence };
      }),
    );
  },
);

export const returnOrchestratorTaskChanges = Effect.fn("returnOrchestratorTaskChanges")(function* (
  services: TaskChangeReviewActionServices,
  input: TaskChangeReviewActionInput & {
    readonly instructions: string;
    readonly capabilityTier?: OrchestrationCapabilityTier;
  },
) {
  return yield* withTaskLifecycleLock(
    input.taskId,
    Effect.gen(function* () {
      const pendingTask = yield* loadPendingChangeReview(services, input.taskId);
      const stageRole = pendingTask.changeReview?.stageRole ?? "work";
      const previousStageTier = pendingTask.changeReview
        ? (yield* services.snapshotQuery.getCommandReadModel()).stageHistory[
            pendingTask.changeReview.workStageThreadId
          ]?.capabilityTier
        : null;
      const capabilityTier =
        input.capabilityTier ??
        pendingTask.roleCapabilityTiers?.[stageRole] ??
        previousStageTier ??
        "smart";
      const started = yield* input.dispatch({
        type: "task.stage.start",
        commandId: yield* input.commandId("return-task-changes"),
        taskId: input.taskId,
        role: stageRole,
        capabilityTier,
        instructions: input.instructions.trim(),
        createdAt: yield* input.createdAt,
      });
      const readModel = yield* services.snapshotQuery.getCommandReadModel();
      const task = readModel.tasks.find((entry) => entry.id === input.taskId);
      yield* input.dispatch({
        type: "task.change-review.resolve",
        commandId: yield* input.commandId("change-review-returned"),
        taskId: input.taskId,
        resolution: "returned",
        createdAt: yield* input.createdAt,
      });
      return {
        sequence: started.sequence,
        stageThreadId: task?.stageThreadIds.at(-1) ?? null,
      };
    }),
  );
});

export const completeOrchestratorTaskWithoutChanges = Effect.fn(
  "completeOrchestratorTaskWithoutChanges",
)(function* (services: TaskChangeReviewActionServices, input: TaskChangeReviewActionInput) {
  return yield* withTaskLifecycleLock(
    input.taskId,
    Effect.gen(function* () {
      const readModel = yield* services.snapshotQuery.getCommandReadModel();
      const task = readModel.tasks.find((entry) => entry.id === input.taskId);
      const reviewCompletion = task?.status === "review" && task.worktreePath !== null;
      const legacyLandedRepair = task?.status === "landed" && task.prUrl === null;
      if (
        task === undefined ||
        (!reviewCompletion && !legacyLandedRepair) ||
        task.currentStageThreadId !== null ||
        task.branch === null
      ) {
        return yield* actionError(
          input.taskId,
          `Task '${input.taskId}' must have settled work in review or be a landed task without a PR before it can complete without changes.`,
        );
      }
      const project = readModel.projects.find((entry) => entry.id === task.projectId);
      if (project === undefined) {
        return yield* actionError(
          input.taskId,
          `Project '${task.projectId}' for task '${input.taskId}' was not found.`,
        );
      }
      const evidence = yield* inspectTaskNoChangeEvidence({
        repositoryPath: project.workspaceRoot,
        branch: task.branch,
        ...(task.worktreePath === null ? {} : { worktreePath: task.worktreePath }),
        process: services.vcsProcess,
      });
      const result = yield* input.dispatch({
        type: "task.no-changes-needed",
        commandId: yield* input.commandId("complete-task-without-changes"),
        taskId: input.taskId,
        baseHead: evidence.baseHead,
        head: evidence.head,
        worktreeCompletion: { head: evidence.head, dirty: evidence.dirty },
        createdAt: yield* input.createdAt,
      });
      return { ...evidence, sequence: result.sequence };
    }),
  );
});
