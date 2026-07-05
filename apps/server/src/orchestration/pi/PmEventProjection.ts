import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationProject,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { CLAUDE_PM_DRIVER } from "../claude/constants.ts";
import type { AgentHarnessEvent, AssistantMessage, TextContent } from "../claude/pmHarness.ts";

export const pmThreadIdForProject = (project: Pick<OrchestrationProject, "id">): ThreadId =>
  ThreadId.make(`pm:${project.id}`);

export const isPmThreadId = (threadId: ThreadId): boolean => {
  const rawThreadId = String(threadId);
  if (!rawThreadId.startsWith("pm:") || rawThreadId.length <= "pm:".length) {
    return false;
  }
  return !rawThreadId.slice("pm:".length).includes(":");
};

const textContent = (message: AssistantMessage): string =>
  message.content
    .filter((content): content is TextContent => content.type === "text")
    .map((content) => content.text)
    .join("");

const toolActivityPayload = (input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly status: "running" | "completed" | "failed";
  readonly details?: unknown;
}): Record<string, unknown> => ({
  itemType: "dynamic_tool_call",
  toolCallId: input.toolCallId,
  toolName: input.toolName,
  title: input.toolName,
  status: input.status,
  input: input.input,
  ...(input.details !== undefined ? { details: input.details } : {}),
});

type PmEventProjectionRuntimeInputBase = {
  readonly project: OrchestrationProject;
  readonly pmModelSelection: ModelSelection;
  readonly events: Stream.Stream<AgentHarnessEvent>;
};

export type PmEventProjectionEvent = AgentHarnessEvent;

type PmEventProjectionRuntimeInputWithNonce = PmEventProjectionRuntimeInputBase & {
  readonly incarnationNonce: string;
};

type PmEventProjectionRuntimeInputWithoutNonce = PmEventProjectionRuntimeInputBase & {
  readonly incarnationNonce?: string;
};

const makePmEventProjectionRuntimeWithNonce = (input: PmEventProjectionRuntimeInputWithNonce) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const pmThreadId = pmThreadIdForProject(input.project);
    const incarnationNonce = input.incarnationNonce;
    let pmThreadEnsured = false;
    let nextLocalId = 0;
    let activePmTurnId: TurnId | null = null;
    let activeAssistantMessageId: MessageId | null = null;
    let activeAssistantTextLength = 0;
    const pendingUserInputRequestIds = new Set<string>();

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const nextCommandId = (tag: string): CommandId => {
      nextLocalId += 1;
      return CommandId.make(
        `pm-projection:${input.project.id}:${incarnationNonce}:${tag}:${nextLocalId}`,
      );
    };
    const nextMessageId = (): MessageId => {
      nextLocalId += 1;
      return MessageId.make(`pm:${input.project.id}:${incarnationNonce}:assistant:${nextLocalId}`);
    };
    const nextUserMessageId = (): MessageId => {
      nextLocalId += 1;
      return MessageId.make(`pm:${input.project.id}:${incarnationNonce}:user:${nextLocalId}`);
    };
    const nextTurnId = (): TurnId => {
      nextLocalId += 1;
      return TurnId.make(`pm:${input.project.id}:${incarnationNonce}:turn:${nextLocalId}`);
    };
    const activityId = (tag: string, toolCallId: string): EventId =>
      EventId.make(`pm:${input.project.id}:${tag}:${toolCallId}`);
    const nextActivityId = (tag: string): EventId => {
      nextLocalId += 1;
      return EventId.make(
        `pm:${input.project.id}:${incarnationNonce}:activity:${tag}:${nextLocalId}`,
      );
    };

    const ensurePmThread = Effect.fn("PmEventProjection.ensurePmThread")(function* () {
      if (pmThreadEnsured) {
        return;
      }

      const existingThread = yield* snapshotQuery
        .getThreadShellById(pmThreadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (existingThread === undefined) {
        const createdAt = yield* nowIso;
        yield* engine.dispatch({
          type: "thread.create",
          commandId: nextCommandId("thread-create"),
          threadId: pmThreadId,
          projectId: input.project.id,
          title: `${input.project.title} PM`,
          modelSelection: input.pmModelSelection,
          gedWorkflowEnabled: false,
          runtimeMode: "full-access",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: input.project.workspaceRoot,
          createdAt,
        });
      }

      pmThreadEnsured = true;
    });

    const ensureAssistantMessage = (): MessageId => {
      activeAssistantMessageId ??= nextMessageId();
      return activeAssistantMessageId;
    };

    const dispatchUserMessage = Effect.fn("PmEventProjection.dispatchUserMessage")(function* (
      text: string,
    ) {
      if (text.length === 0) {
        return;
      }
      yield* ensurePmThread();
      const createdAt = yield* nowIso;
      yield* engine.dispatch({
        type: "thread.message.user.append",
        commandId: nextCommandId("user-message"),
        threadId: pmThreadId,
        messageId: nextUserMessageId(),
        text,
        createdAt,
      });
    });

    const dispatchAssistantDelta = Effect.fn("PmEventProjection.dispatchAssistantDelta")(function* (
      delta: string,
    ) {
      if (delta.length === 0) {
        return;
      }
      yield* ensurePmThread();
      const createdAt = yield* nowIso;
      yield* engine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: nextCommandId("assistant-delta"),
        threadId: pmThreadId,
        messageId: ensureAssistantMessage(),
        delta,
        ...(activePmTurnId !== null ? { turnId: activePmTurnId } : {}),
        createdAt,
      });
      activeAssistantTextLength += delta.length;
    });

    const dispatchAssistantComplete = Effect.fn("PmEventProjection.dispatchAssistantComplete")(
      function* () {
        if (activeAssistantMessageId === null) {
          return;
        }
        yield* ensurePmThread();
        const createdAt = yield* nowIso;
        yield* engine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: nextCommandId("assistant-complete"),
          threadId: pmThreadId,
          messageId: activeAssistantMessageId,
          ...(activePmTurnId !== null ? { turnId: activePmTurnId } : {}),
          createdAt,
        });
        activeAssistantMessageId = null;
        activeAssistantTextLength = 0;
      },
    );

    const dispatchActivity = Effect.fn("PmEventProjection.dispatchActivity")(function* (
      activity: OrchestrationThreadActivity,
    ) {
      yield* ensurePmThread();
      yield* engine.dispatch({
        type: "thread.activity.append",
        commandId: nextCommandId(activity.kind),
        threadId: pmThreadId,
        activity,
        createdAt: activity.createdAt,
      });
    });

    const dispatchSession = Effect.fn("PmEventProjection.dispatchSession")(function* (
      status: "running" | "ready",
      turnId: TurnId | null,
    ) {
      yield* ensurePmThread();
      const createdAt = yield* nowIso;
      yield* engine.dispatch({
        type: "thread.session.set",
        commandId: nextCommandId(`session-${status}`),
        threadId: pmThreadId,
        session: {
          threadId: pmThreadId,
          status,
          providerName: CLAUDE_PM_DRIVER,
          providerInstanceId: input.pmModelSelection.instanceId,
          runtimeMode: "full-access",
          activeTurnId: status === "running" ? turnId : null,
          lastError: null,
          updatedAt: createdAt,
        },
        createdAt,
      });
    });

    const startTurn = Effect.fn("PmEventProjection.startTurn")(function* () {
      if (activePmTurnId !== null) {
        return activePmTurnId;
      }
      activePmTurnId = nextTurnId();
      yield* dispatchSession("running", activePmTurnId);
      return activePmTurnId;
    });

    const completeTurn = Effect.fn("PmEventProjection.completeTurn")(function* () {
      if (activePmTurnId === null) {
        return;
      }
      yield* dispatchSession("ready", null);
      activePmTurnId = null;
    });

    const dispatchPendingUserInputClear = Effect.fn(
      "PmEventProjection.dispatchPendingUserInputClear",
    )(function* (input: {
      readonly requestId: string;
      readonly createdAt: string;
      readonly reason: string;
    }) {
      pendingUserInputRequestIds.delete(input.requestId);
      yield* dispatchActivity({
        id: nextActivityId("user-input-resolved"),
        tone: "info",
        kind: "user-input.resolved",
        summary: "User input request cleared",
        payload: {
          requestId: input.requestId,
          answers: {},
          detail: input.reason,
        },
        turnId: activePmTurnId,
        createdAt: input.createdAt,
      });
    });

    const clearPendingUserInputs = Effect.fn("PmEventProjection.clearPendingUserInputs")(
      function* (input: { readonly reason: string; readonly createdAt?: string }) {
        if (pendingUserInputRequestIds.size === 0) {
          return;
        }
        const createdAt = input.createdAt ?? (yield* nowIso);
        const requestIds = Array.from(pendingUserInputRequestIds);
        for (const requestId of requestIds) {
          yield* dispatchPendingUserInputClear({ requestId, createdAt, reason: input.reason });
        }
      },
    );

    yield* Effect.addFinalizer(() =>
      clearPendingUserInputs({
        reason: "PM projection stopped before the user-input request resolved.",
      }).pipe(
        Effect.andThen(completeTurn()),
        Effect.catchCause((cause) =>
          Effect.logWarning("PM event projection teardown failed to complete active turn", {
            projectId: String(input.project.id),
            cause: Cause.pretty(cause),
          }),
        ),
      ),
    );

    const processEvent = Effect.fn("PmEventProjection.processEvent")(function* (
      event: PmEventProjectionEvent,
    ) {
      switch (event.type) {
        case "provider_runtime_user_input_requested": {
          const requestId = event.event.requestId ? String(event.event.requestId) : null;
          if (requestId === null) {
            return;
          }
          yield* startTurn();
          pendingUserInputRequestIds.add(requestId);
          yield* dispatchActivity({
            id: event.event.eventId,
            tone: "info",
            kind: "user-input.requested",
            summary: "User input requested",
            payload: {
              requestId,
              questions: event.event.payload.questions,
            },
            turnId: activePmTurnId,
            createdAt: event.event.createdAt,
          });
          return;
        }

        case "provider_runtime_user_input_resolved": {
          const requestId = event.event.requestId ? String(event.event.requestId) : null;
          if (requestId === null) {
            return;
          }
          pendingUserInputRequestIds.delete(requestId);
          yield* dispatchActivity({
            id: event.event.eventId,
            tone: "info",
            kind: "user-input.resolved",
            summary: "User input submitted",
            payload: {
              requestId,
              answers: event.event.payload.answers,
            },
            turnId: activePmTurnId,
            createdAt: event.event.createdAt,
          });
          return;
        }

        case "provider_runtime_turn_abnormal_end": {
          yield* clearPendingUserInputs({
            reason: event.reason,
            createdAt: event.createdAt,
          });
          return;
        }

        case "before_agent_start": {
          yield* startTurn();
          return;
        }

        case "message_start": {
          if (event.message.role !== "assistant") {
            return;
          }
          yield* startTurn();
          activeAssistantMessageId = nextMessageId();
          activeAssistantTextLength = 0;
          yield* dispatchAssistantDelta(textContent(event.message));
          return;
        }

        case "message_update": {
          if (event.message.role !== "assistant") {
            return;
          }
          if (event.assistantMessageEvent.type === "text_delta") {
            yield* dispatchAssistantDelta(event.assistantMessageEvent.delta);
          }
          return;
        }

        case "message_end": {
          if (event.message.role !== "assistant") {
            return;
          }
          if (activeAssistantTextLength === 0) {
            const finalText = textContent(event.message);
            if (finalText.length === 0) {
              activeAssistantMessageId = null;
              return;
            }
            yield* dispatchAssistantDelta(finalText);
          }
          yield* dispatchAssistantComplete();
          return;
        }

        case "tool_call": {
          yield* startTurn();
          const createdAt = yield* nowIso;
          yield* dispatchActivity({
            id: activityId("tool-started", event.toolCallId),
            tone: "tool",
            kind: "tool.started",
            summary: `PM tool ${event.toolName} started`,
            payload: toolActivityPayload({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              status: "running",
            }),
            turnId: activePmTurnId,
            createdAt,
          });
          return;
        }

        case "tool_result": {
          yield* startTurn();
          const createdAt = yield* nowIso;
          yield* dispatchActivity({
            id: activityId("tool-completed", event.toolCallId),
            tone: event.isError ? "error" : "tool",
            kind: "tool.completed",
            summary: event.isError
              ? `PM tool ${event.toolName} failed`
              : `PM tool ${event.toolName} completed`,
            payload: toolActivityPayload({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
              status: event.isError ? "failed" : "completed",
              details: event.details,
            }),
            turnId: activePmTurnId,
            createdAt,
          });
          return;
        }

        case "turn_end":
        case "agent_end":
        case "settled": {
          yield* completeTurn();
          return;
        }

        default:
          return;
      }
    });

    const processEventSafely = (event: AgentHarnessEvent) =>
      processEvent(event).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("PM event projection failed", {
            eventType: event.type,
            projectId: String(input.project.id),
            cause: Cause.pretty(cause),
          });
        }),
      );

    const worker = yield* makeDrainableWorker(processEventSafely);
    yield* input.events.pipe(Stream.runForEach(worker.enqueue), Effect.forkScoped);

    return {
      pmThreadId,
      dispatchUserMessage,
      dispatchActivity,
      project: processEvent,
      enqueue: worker.enqueue,
      drain: worker.drain,
    };
  });

type PmEventProjectionRuntimeEffect = ReturnType<typeof makePmEventProjectionRuntimeWithNonce>;

export function makePmEventProjectionRuntime(
  input: PmEventProjectionRuntimeInputWithNonce,
): PmEventProjectionRuntimeEffect;
export function makePmEventProjectionRuntime(
  input: PmEventProjectionRuntimeInputWithoutNonce,
): Effect.Effect<
  Effect.Success<PmEventProjectionRuntimeEffect>,
  Effect.Error<PmEventProjectionRuntimeEffect>,
  Effect.Services<PmEventProjectionRuntimeEffect> | Crypto.Crypto
>;
export function makePmEventProjectionRuntime(
  input: PmEventProjectionRuntimeInputWithNonce | PmEventProjectionRuntimeInputWithoutNonce,
) {
  if (input.incarnationNonce !== undefined) {
    return makePmEventProjectionRuntimeWithNonce(input as PmEventProjectionRuntimeInputWithNonce);
  }

  return Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const incarnationNonce = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    return yield* makePmEventProjectionRuntimeWithNonce({
      ...input,
      incarnationNonce,
    });
  });
}
