import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationProject,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

export const pmThreadIdForProject = (project: Pick<OrchestrationProject, "id">): ThreadId =>
  ThreadId.make(`pm:${project.id}`);

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

export const makePmEventProjectionRuntime = (input: {
  readonly project: OrchestrationProject;
  readonly pmModelSelection: ModelSelection;
  readonly events: Stream.Stream<AgentHarnessEvent>;
}) =>
  Effect.gen(function* () {
    const engine = yield* OrchestrationEngineService;
    const snapshotQuery = yield* ProjectionSnapshotQuery;
    const pmThreadId = pmThreadIdForProject(input.project);
    let pmThreadEnsured = false;
    let nextLocalId = 0;
    let activeAssistantMessageId: MessageId | null = null;
    let activeAssistantTextLength = 0;

    const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const nextCommandId = (tag: string): CommandId => {
      nextLocalId += 1;
      return CommandId.make(`pm-projection:${input.project.id}:${tag}:${nextLocalId}`);
    };
    const nextMessageId = (): MessageId => {
      nextLocalId += 1;
      return MessageId.make(`pm:${input.project.id}:assistant:${nextLocalId}`);
    };
    const nextUserMessageId = (): MessageId => {
      nextLocalId += 1;
      return MessageId.make(`pm:${input.project.id}:user:${nextLocalId}`);
    };
    const activityId = (tag: string, toolCallId: string): EventId =>
      EventId.make(`pm:${input.project.id}:${tag}:${toolCallId}`);

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
          runtimeMode: "approval-required",
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
          createdAt,
        });
        activeAssistantMessageId = null;
        activeAssistantTextLength = 0;
      },
    );

    const dispatchToolActivity = Effect.fn("PmEventProjection.dispatchToolActivity")(function* (
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

    const processEvent = Effect.fn("PmEventProjection.processEvent")(function* (
      event: AgentHarnessEvent,
    ) {
      switch (event.type) {
        case "before_agent_start": {
          return;
        }

        case "message_start": {
          if (event.message.role !== "assistant") {
            return;
          }
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
          if (activeAssistantMessageId === null) {
            activeAssistantMessageId = nextMessageId();
          }
          if (activeAssistantTextLength === 0) {
            yield* dispatchAssistantDelta(textContent(event.message));
          }
          yield* dispatchAssistantComplete();
          return;
        }

        case "tool_call": {
          const createdAt = yield* nowIso;
          yield* dispatchToolActivity({
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
            turnId: null,
            createdAt,
          });
          return;
        }

        case "tool_result": {
          const createdAt = yield* nowIso;
          yield* dispatchToolActivity({
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
            turnId: null,
            createdAt,
          });
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
      project: processEvent,
      enqueue: worker.enqueue,
      drain: worker.drain,
    };
  });
