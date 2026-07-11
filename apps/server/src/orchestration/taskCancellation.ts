import {
  CommandId,
  OrchestrationCancelTaskError,
  OrchestrationDispatchCommandError,
  type DispatchResult,
  type OrchestrationCommand,
  type OrchestrationTask,
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
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";

type CancelOrchestrationTaskError =
  | OrchestrationCancelTaskError
  | OrchestrationDispatchCommandError
  | OrchestrationDispatchError
  | PlatformError.PlatformError
  | ProjectionRepositoryError
  | ProviderServiceError
  | TerminalError;

type DispatchCancellationCommand = (
  command:
    | Extract<OrchestrationCommand, { type: "task.cancellation.request" }>
    | Extract<OrchestrationCommand, { type: "task.cancellation.fail" }>
    | Extract<OrchestrationCommand, { type: "task.cancellation.phase.complete" }>
    | Extract<OrchestrationCommand, { type: "task.abandon" }>,
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
  readonly dispatch: DispatchCancellationCommand;
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

const isTerminalTaskStatus = (status: OrchestrationTask["status"]): boolean =>
  status === "landed" || status === "abandoned";

const cancelOrchestrationTaskUnlocked = Effect.fn("cancelOrchestrationTaskUnlocked")(function* (
  services: CancelOrchestrationTaskServices,
  input: CancelOrchestrationTaskInput,
) {
  const readTask = () =>
    services.snapshotQuery.getCommandReadModel().pipe(
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
  let readModel = yield* readTask();
  const task = readModel.tasks.find((entry) => entry.id === input.taskId);
  if (task !== undefined && isTerminalTaskStatus(task.status)) {
    return { sequence: readModel.snapshotSequence };
  }

  let reservationFailure: CancelOrchestrationTaskError | undefined;
  if (task?.cancellation == null) {
    const reservation = yield* Effect.all({
      commandId: input.commandId,
      createdAt: input.createdAt,
    });
    const reservationAttempt = yield* Effect.result(
      input.dispatch({
        type: "task.cancellation.request",
        ...reservation,
        taskId: input.taskId,
      }),
    );
    if (reservationAttempt._tag === "Failure") {
      reservationFailure = reservationAttempt.failure;
    }
  }

  // The reservation may have serialized after a stage start that followed
  // our initial read. Refresh both task and thread state before deciding what
  // provider work must be interrupted.
  readModel = yield* readTask();
  const reservedTask = readModel.tasks.find((entry) => entry.id === input.taskId);
  if (reservedTask !== undefined && isTerminalTaskStatus(reservedTask.status)) {
    return { sequence: readModel.snapshotSequence };
  }
  if (reservedTask?.cancellation == null) {
    if (reservationFailure !== undefined) {
      return yield* reservationFailure;
    }
    return yield* new OrchestrationCancelTaskError({
      taskId: input.taskId,
      phase: "read-task",
      message: `Task '${input.taskId}' has no cancellation reservation after reservation dispatch.`,
    });
  }

  const recordShutdownFailure = (error: OrchestrationCancelTaskError) =>
    Effect.gen(function* () {
      const phase = error.phase;
      if (phase === "read-task") return yield* error;
      const failure = yield* Effect.all({
        commandId: input.commandId,
        createdAt: input.createdAt,
      });
      yield* input
        .dispatch({
          type: "task.cancellation.fail",
          ...failure,
          taskId: input.taskId,
          phase,
          message: error.message,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("failed to persist orchestration cancellation failure", {
              taskId: input.taskId,
              phase: error.phase,
              cause: Cause.pretty(cause),
            }),
          ),
        );
      return yield* error;
    });

  const completedPhases = new Set(reservedTask.cancellation.completedPhases ?? []);
  const runShutdownPhase = Effect.fn("runCancellationShutdownPhase")(function* (
    phase: "interrupt-turn" | "stop-session" | "close-terminals",
    operation: Effect.Effect<void, CancelOrchestrationTaskError>,
  ) {
    if (completedPhases.has(phase)) return;
    yield* operation.pipe(
      Effect.catchCause((cause) =>
        recordShutdownFailure(shutdownFailure({ taskId: input.taskId, phase, cause })),
      ),
    );
    const completion = yield* Effect.all({
      commandId: input.commandId,
      createdAt: input.createdAt,
    });
    yield* input
      .dispatch({
        type: "task.cancellation.phase.complete",
        ...completion,
        taskId: input.taskId,
        phase,
      })
      .pipe(
        Effect.catchCause((cause) =>
          recordShutdownFailure(shutdownFailure({ taskId: input.taskId, phase, cause })),
        ),
      );
    completedPhases.add(phase);
  });

  const stageThreadId = reservedTask.currentStageThreadId;
  if (stageThreadId !== null) {
    const thread = readModel.threads.find((entry) => entry.id === stageThreadId);
    const latestTurn = thread?.latestTurn ?? null;
    if (latestTurn?.state === "running") {
      yield* runShutdownPhase(
        "interrupt-turn",
        services.providerService.interruptTurn({
          threadId: stageThreadId,
          turnId: latestTurn.turnId,
        }),
      );
    } else {
      yield* runShutdownPhase("interrupt-turn", Effect.void);
    }

    yield* runShutdownPhase(
      "stop-session",
      services.providerService.stopSession({ threadId: stageThreadId }),
    );
    yield* runShutdownPhase(
      "close-terminals",
      services.terminalManager.close({ threadId: stageThreadId, deleteHistory: true }),
    );
  }

  const commandId = yield* input.commandId;
  const createdAt = yield* input.createdAt;
  return yield* input
    .dispatch({
      type: "task.abandon",
      commandId,
      taskId: input.taskId,
      createdAt,
    })
    .pipe(
      Effect.catchCause((cause) =>
        recordShutdownFailure(
          shutdownFailure({
            taskId: input.taskId,
            phase: "abandon",
            cause,
          }),
        ),
      ),
    );
});

export const cancelOrchestrationTaskWithServices = Effect.fn("cancelOrchestrationTaskWithServices")(
  function* (services: CancelOrchestrationTaskServices, input: CancelOrchestrationTaskInput) {
    return yield* withTaskLifecycleLock(
      input.taskId,
      cancelOrchestrationTaskUnlocked(services, input),
    );
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
