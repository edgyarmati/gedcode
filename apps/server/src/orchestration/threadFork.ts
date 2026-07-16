import {
  type CommandId,
  type MessageId,
  OrchestrationForkThreadError,
  type OrchestrationForkThreadInput,
  type OrchestrationForkThreadResult,
  type OrchestrationSession,
  type ProviderSession,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { OrchestrationDispatchError } from "./Errors.ts";
import type { ProjectionSnapshotQueryShape } from "./Services/ProjectionSnapshotQuery.ts";
import type { ProviderServiceShape } from "../provider/Services/ProviderService.ts";

type ForkThreadCommand = Extract<
  import("@t3tools/contracts").OrchestrationCommand,
  { type: "thread.fork" }
>;

export interface ForkOrchestrationThreadServices {
  readonly snapshotQuery: Pick<ProjectionSnapshotQueryShape, "getCommandReadModel">;
  readonly providerService: Pick<
    ProviderServiceShape,
    "forkConversation" | "getInstanceInfo" | "rollbackConversation" | "stopSession"
  >;
}

export interface ForkOrchestrationThreadRuntime {
  readonly newThreadId: Effect.Effect<ThreadId, OrchestrationForkThreadError>;
  readonly newMessageId: Effect.Effect<MessageId, OrchestrationForkThreadError>;
  readonly commandId: Effect.Effect<CommandId, OrchestrationForkThreadError>;
  readonly createdAt: Effect.Effect<string, OrchestrationForkThreadError>;
  readonly dispatch: (
    command: ForkThreadCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError>;
}

const forkError = (
  input: OrchestrationForkThreadInput,
  reason: OrchestrationForkThreadError["reason"],
  message: string,
  cause?: unknown,
) =>
  new OrchestrationForkThreadError({
    sourceThreadId: input.sourceThreadId,
    sourceMessageId: input.sourceMessageId,
    reason,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

function toOrchestrationSession(session: ProviderSession): OrchestrationSession {
  const status =
    session.status === "connecting"
      ? "starting"
      : session.status === "running"
        ? "running"
        : session.status === "error"
          ? "error"
          : session.status === "closed"
            ? "stopped"
            : "ready";
  return {
    threadId: session.threadId,
    status,
    providerName: session.provider,
    ...(session.providerInstanceId === undefined
      ? {}
      : { providerInstanceId: session.providerInstanceId }),
    runtimeMode: session.runtimeMode,
    activeTurnId: null,
    lastError: session.lastError ?? null,
    updatedAt: session.updatedAt,
  };
}

export const forkOrchestrationThreadWithServices = Effect.fn("forkOrchestrationThreadWithServices")(
  function* (
    services: ForkOrchestrationThreadServices,
    runtime: ForkOrchestrationThreadRuntime,
    input: OrchestrationForkThreadInput,
  ): Effect.fn.Return<OrchestrationForkThreadResult, OrchestrationForkThreadError> {
    const readModel = yield* services.snapshotQuery
      .getCommandReadModel()
      .pipe(
        Effect.mapError((cause) =>
          forkError(input, "thread-not-found", "Could not read the source thread.", cause),
        ),
      );
    const source = readModel.threads.find((thread) => thread.id === input.sourceThreadId);
    if (!source) {
      return yield* forkError(
        input,
        "thread-not-found",
        `Thread '${input.sourceThreadId}' was not found.`,
      );
    }
    if (source.latestTurn?.state === "running") {
      return yield* forkError(
        input,
        "thread-busy",
        `Thread '${source.id}' has a running turn and cannot be forked.`,
      );
    }
    const boundaryIndex = source.messages.findIndex(
      (message) => message.id === input.sourceMessageId,
    );
    if (boundaryIndex < 0) {
      return yield* forkError(
        input,
        "message-not-found",
        `Message '${input.sourceMessageId}' was not found in thread '${source.id}'.`,
      );
    }
    const boundary = source.messages[boundaryIndex]!;
    if (boundary.role !== "assistant" || boundary.streaming) {
      return yield* forkError(
        input,
        "invalid-boundary",
        "Only completed assistant messages can be continued in a new task.",
      );
    }

    const targetThreadId = yield* runtime.newThreadId;
    const targetMessageIds = yield* Effect.forEach(
      source.messages.slice(0, boundaryIndex + 1),
      () => runtime.newMessageId,
    );
    const laterAssistantTurns = source.messages
      .slice(boundaryIndex + 1)
      .filter((message) => message.role === "assistant" && !message.streaming);
    const hasUnaddressableLaterTurn = laterAssistantTurns.some(
      (message) => message.turnId === null,
    );
    const rollbackTurnIds = new Set(
      laterAssistantTurns.flatMap((message) => (message.turnId === null ? [] : [message.turnId])),
    );
    const instanceInfo = yield* services.providerService
      .getInstanceInfo(source.modelSelection.instanceId)
      .pipe(
        Effect.mapError((cause) =>
          forkError(input, "provider-fork-failed", "Could not resolve the source provider.", cause),
        ),
      );
    const useNativeFork =
      instanceInfo.driverKind === "codex" &&
      source.session !== null &&
      boundary.turnId !== null &&
      !hasUnaddressableLaterTurn;
    let nativeSession: ProviderSession | undefined;

    if (useNativeFork) {
      const cwd =
        source.worktreePath ??
        readModel.projects.find((project) => project.id === source.projectId)?.workspaceRoot;
      nativeSession = yield* services.providerService
        .forkConversation({
          sourceThreadId: source.id,
          target: {
            threadId: targetThreadId,
            provider: instanceInfo.driverKind,
            providerInstanceId: source.modelSelection.instanceId,
            ...(cwd === undefined ? {} : { cwd }),
            modelSelection: source.modelSelection,
            runtimeMode: source.runtimeMode,
          },
        })
        .pipe(
          Effect.mapError((cause) =>
            forkError(
              input,
              "provider-fork-failed",
              "The provider could not fork this task.",
              cause,
            ),
          ),
        );
      if (rollbackTurnIds.size > 0) {
        yield* services.providerService
          .rollbackConversation({
            threadId: targetThreadId,
            numTurns: rollbackTurnIds.size,
          })
          .pipe(
            Effect.mapError((cause) =>
              forkError(
                input,
                "provider-fork-failed",
                "The fork was created but could not be rolled back to the selected message.",
                cause,
              ),
            ),
          );
      }
    }

    const command: ForkThreadCommand = {
      type: "thread.fork",
      commandId: yield* runtime.commandId,
      sourceThreadId: source.id,
      sourceMessageId: input.sourceMessageId,
      targetThreadId,
      targetMessageIds,
      ...(nativeSession === undefined ? {} : { session: toOrchestrationSession(nativeSession) }),
      createdAt: yield* runtime.createdAt,
    };
    const result = yield* runtime.dispatch(command).pipe(
      Effect.mapError((cause) =>
        forkError(input, "dispatch-failed", "The forked task could not be recorded.", cause),
      ),
      Effect.onError(() =>
        nativeSession === undefined
          ? Effect.void
          : services.providerService
              .stopSession({ threadId: targetThreadId })
              .pipe(Effect.ignoreCause({ log: true })),
      ),
    );
    return {
      threadId: targetThreadId,
      strategy: nativeSession === undefined ? "copied-history" : "provider-native",
      filesystem: "current-state",
      sequence: result.sequence,
    };
  },
);
