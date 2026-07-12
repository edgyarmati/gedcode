import {
  OrchestrationInterruptStageError,
  type CommandId,
  type DispatchResult,
  type OrchestrationCommand,
  type OrchestrationDispatchCommandError,
  type TaskId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import type { OrchestrationDispatchError } from "./Errors.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";

type InterruptOrchestrationStageError =
  | OrchestrationInterruptStageError
  | OrchestrationDispatchError
  | OrchestrationDispatchCommandError
  | ProjectionRepositoryError
  | PlatformError.PlatformError;

type DispatchInterruptCommand = (
  command: Extract<OrchestrationCommand, { type: "thread.turn.interrupt" }>,
) => Effect.Effect<
  number | DispatchResult,
  OrchestrationDispatchError | OrchestrationDispatchCommandError
>;

export interface InterruptOrchestrationStageServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
}

export interface InterruptOrchestrationStageInput {
  readonly taskId: TaskId;
  readonly stageThreadId?: ThreadId;
  readonly commandId: Effect.Effect<CommandId, InterruptOrchestrationStageError>;
  readonly createdAt: Effect.Effect<string, InterruptOrchestrationStageError>;
  readonly dispatch: DispatchInterruptCommand;
}

const interruptError = (
  taskId: TaskId,
  reason: OrchestrationInterruptStageError["reason"],
  message: string,
) => new OrchestrationInterruptStageError({ taskId, reason, message });

export const interruptOrchestrationStageWithServices = Effect.fn(
  "interruptOrchestrationStageWithServices",
)(function* (
  services: InterruptOrchestrationStageServices,
  input: InterruptOrchestrationStageInput,
) {
  return yield* withTaskLifecycleLock(
    input.taskId,
    Effect.gen(function* () {
      const readModel = yield* services.snapshotQuery.getCommandReadModel();
      const task = readModel.tasks.find((entry) => entry.id === input.taskId);
      if (task === undefined) {
        return yield* interruptError(
          input.taskId,
          "task-not-found",
          `Task '${input.taskId}' was not found and cannot be interrupted.`,
        );
      }

      const stageThreadId = input.stageThreadId ?? task.currentStageThreadId;
      if (stageThreadId === null) {
        return yield* interruptError(
          input.taskId,
          "no-active-stage",
          `Task '${input.taskId}' has no active stage to interrupt.`,
        );
      }
      if (stageThreadId !== task.currentStageThreadId) {
        return yield* interruptError(
          input.taskId,
          "no-active-stage",
          `Stage thread '${stageThreadId}' is not the active stage for task '${input.taskId}'.`,
        );
      }

      const thread = readModel.threads.find((entry) => entry.id === stageThreadId);
      if (thread === undefined) {
        return yield* interruptError(
          input.taskId,
          "stage-thread-not-found",
          `Active stage thread '${stageThreadId}' was not found.`,
        );
      }
      if (thread.latestTurn?.state !== "running") {
        return yield* interruptError(
          input.taskId,
          "not-running",
          `Stage thread '${stageThreadId}' has no running turn to interrupt.`,
        );
      }

      const result = yield* input.dispatch({
        type: "thread.turn.interrupt",
        commandId: yield* input.commandId,
        threadId: stageThreadId,
        ...(thread.latestTurn.turnId === null ? {} : { turnId: thread.latestTurn.turnId }),
        createdAt: yield* input.createdAt,
      });
      return {
        taskId: input.taskId,
        stageThreadId,
        sequence: typeof result === "number" ? result : result.sequence,
        status: "requested" as const,
      };
    }),
  );
});
