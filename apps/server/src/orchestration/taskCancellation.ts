import {
  CommandId,
  OrchestrationCancelTaskError,
  OrchestrationDispatchCommandError,
  type DispatchResult,
  type OrchestrationCommand,
  type TaskId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import type { ProviderServiceError } from "../provider/Errors.ts";
import type { TerminalError } from "../terminal/Services/Manager.ts";
import type { OrchestrationDispatchError } from "./Errors.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "./Services/ProjectionSnapshotQuery.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../provider/Services/ProviderService.ts";
import { TerminalManager, type TerminalManagerShape } from "../terminal/Services/Manager.ts";

type CancelOrchestrationTaskError =
  | OrchestrationCancelTaskError
  | OrchestrationDispatchCommandError
  | OrchestrationDispatchError
  | PlatformError.PlatformError
  | ProjectionRepositoryError
  | ProviderServiceError
  | TerminalError;

type DispatchTaskAbandon = (
  command: Extract<OrchestrationCommand, { type: "task.abandon" }>,
) => Effect.Effect<DispatchResult, CancelOrchestrationTaskError>;

export interface CancelOrchestrationTaskServices {
  readonly snapshotQuery: ProjectionSnapshotQueryShape;
  readonly providerService: ProviderServiceShape;
  readonly terminalManager: TerminalManagerShape;
}

export interface CancelOrchestrationTaskInput {
  readonly taskId: TaskId;
  readonly commandId: Effect.Effect<CommandId, CancelOrchestrationTaskError>;
  readonly createdAt: Effect.Effect<string, CancelOrchestrationTaskError>;
  readonly dispatch: DispatchTaskAbandon;
}

const shutdownFailure = (input: {
  readonly taskId: TaskId;
  readonly phase: OrchestrationCancelTaskError["phase"];
  readonly cause: Cause.Cause<unknown>;
}): OrchestrationCancelTaskError =>
  new OrchestrationCancelTaskError({
    taskId: input.taskId,
    phase: input.phase,
    message: `Failed to cancel task '${input.taskId}' during ${input.phase}.`,
    cause: Cause.pretty(input.cause),
  });

export const cancelOrchestrationTaskWithServices = Effect.fn("cancelOrchestrationTaskWithServices")(
  function* (services: CancelOrchestrationTaskServices, input: CancelOrchestrationTaskInput) {
    const readModel = yield* services.snapshotQuery.getCommandReadModel().pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationCancelTaskError({
            taskId: input.taskId,
            phase: "read-task",
            message: `Failed to read task '${input.taskId}' before cancellation.`,
            cause,
          }),
      ),
    );
    const task = readModel.tasks.find((entry) => entry.id === input.taskId);
    if (task?.status === "abandoned") {
      return { sequence: readModel.snapshotSequence };
    }

    const stageThreadId = task?.currentStageThreadId ?? null;
    if (stageThreadId !== null) {
      const thread = readModel.threads.find((entry) => entry.id === stageThreadId);
      const latestTurn = thread?.latestTurn ?? null;
      if (latestTurn?.state === "running") {
        yield* services.providerService
          .interruptTurn({
            threadId: stageThreadId,
            turnId: latestTurn.turnId,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.fail(
                shutdownFailure({
                  taskId: input.taskId,
                  phase: "interrupt-turn",
                  cause,
                }),
              ),
            ),
          );
      }

      yield* services.providerService.stopSession({ threadId: stageThreadId }).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            shutdownFailure({
              taskId: input.taskId,
              phase: "stop-session",
              cause,
            }),
          ),
        ),
      );
      yield* services.terminalManager.close({ threadId: stageThreadId, deleteHistory: true }).pipe(
        Effect.catchCause((cause) =>
          Effect.fail(
            shutdownFailure({
              taskId: input.taskId,
              phase: "close-terminals",
              cause,
            }),
          ),
        ),
      );
    }

    const commandId = yield* input.commandId;
    const createdAt = yield* input.createdAt;
    return yield* input.dispatch({
      type: "task.abandon",
      commandId,
      taskId: input.taskId,
      createdAt,
    });
  },
);

export const cancelOrchestrationTask = Effect.fn("cancelOrchestrationTask")(function* (
  input: CancelOrchestrationTaskInput,
) {
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const terminalManager = yield* TerminalManager;
  return yield* cancelOrchestrationTaskWithServices(
    { snapshotQuery, providerService, terminalManager },
    input,
  );
});
