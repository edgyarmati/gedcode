import {
  type CommandId,
  type DispatchResult,
  type OrchestrationCommand,
  type TaskId,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import type { OrchestrationDispatchError } from "./Errors.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";

type LandOrchestrationTaskError =
  | OrchestrationLandTaskError
  | OrchestrationDispatchError
  | ProjectionRepositoryError
  | PlatformError.PlatformError;

type DispatchLandCommand = (
  command: Extract<OrchestrationCommand, { type: "task.land" }>,
) => Effect.Effect<DispatchResult, OrchestrationDispatchError>;

export class OrchestrationLandTaskError extends Data.TaggedError("OrchestrationLandTaskError")<{
  readonly taskId: TaskId;
  readonly reason: "task-not-found";
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface LandOrchestrationTaskServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
}

export interface LandOrchestrationTaskInput {
  readonly taskId: TaskId;
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
        if (task.status === "landed") {
          return { sequence: readModel.snapshotSequence, alreadyLanded: true };
        }

        const result = yield* input.dispatch({
          type: "task.land",
          commandId: yield* input.commandId,
          taskId: input.taskId,
          createdAt: yield* input.createdAt,
        });
        return { ...result, alreadyLanded: false };
      }),
    );
  },
);
