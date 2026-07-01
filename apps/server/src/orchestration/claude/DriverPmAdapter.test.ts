import {
  EventId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationProject,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { ClaudeAdapterShape } from "../../provider/Services/ClaudeAdapter.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../../provider/Services/ProviderSessionDirectory.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "../pi/PmEventProjection.ts";
import { makeDriverPmAdapter } from "./DriverPmAdapter.ts";
import { orchestrationMcpToolId } from "./pmMcpServer.ts";

const provider = ProviderDriverKind.make("claudeAgent");
const projectId = ProjectId.make("project-1");
const claudeInstanceId = ProviderInstanceId.make("claudeAgent");
const modelSelection: ModelSelection = {
  instanceId: claudeInstanceId,
  model: "claude-sonnet-4-6",
};
const now = "2026-06-14T10:00:00.000Z";

const project: OrchestrationProject = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/tmp/project",
  repositoryIdentity: null,
  defaultModelSelection: modelSelection,
  roleModelSelections: {},
  orchestratorConfig: {
    enabled: true,
    pmModelSelection: modelSelection,
  },
  scripts: [],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const makeEvent = (
  input: Omit<ProviderRuntimeEvent, "eventId" | "provider" | "createdAt" | "threadId"> & {
    readonly eventId?: string;
    readonly threadId?: ThreadId;
  },
): ProviderRuntimeEvent =>
  ({
    eventId: EventId.make(input.eventId ?? `event-${input.type}`),
    provider,
    createdAt: now,
    threadId: input.threadId ?? pmThreadIdForProject(project),
    ...input,
  }) as ProviderRuntimeEvent;

const providerSession = (
  threadId: ThreadId,
  resumeCursor: unknown = { resume: "resume-started" },
): ProviderSession => ({
  provider,
  providerInstanceId: claudeInstanceId,
  status: "ready",
  runtimeMode: "approval-required",
  cwd: project.workspaceRoot,
  model: modelSelection.model,
  threadId,
  resumeCursor,
  createdAt: now,
  updatedAt: now,
});

const makeProjectionLayer = (commands: OrchestrationCommand[]) =>
  Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
      streamDomainEvents: Stream.empty,
      streamShellEvents: Stream.empty,
    }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: (threadId: ThreadId) =>
        Effect.succeed(
          commands.some(
            (command) => command.type === "thread.create" && command.threadId === threadId,
          )
            ? Option.some({ id: threadId } as never)
            : Option.none(),
        ),
    } as never),
  );

describe("DriverPmAdapter", () => {
  it.effect("bridges Claude PM events into the PI PM adapter shape", () =>
    Effect.gen(function* () {
      const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sendTurnCalled = yield* Deferred.make<void>();
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-1");
      const toolItemId = RuntimeItemId.make("tool-call-1");
      const persistedResumeCursor = {
        threadId,
        resume: "resume-persisted",
        resumeSessionAt: "assistant-previous",
        turnCount: 7,
      };
      const startInputs: ProviderSessionStartInput[] = [];
      const upserts: ProviderRuntimeBinding[] = [];
      let started = false;

      const claudeAdapter: ClaudeAdapterShape = {
        provider,
        capabilities: { sessionModelSwitch: "in-session" },
        streamEvents: Stream.fromQueue(runtimeEvents),
        startSession: (input) =>
          Effect.sync(() => {
            started = true;
            startInputs.push(input);
            return providerSession(threadId, { resume: "resume-active" });
          }),
        sendTurn: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(sendTurnCalled, undefined);
            return { threadId, turnId, resumeCursor: { resume: "resume-active" } };
          }),
        interruptTurn: () => Effect.void,
        respondToRequest: () => Effect.void,
        respondToUserInput: () => Effect.void,
        stopSession: () =>
          Effect.sync(() => {
            started = false;
          }),
        listSessions: () =>
          Effect.succeed(
            started ? [providerSession(threadId, { resume: "resume-after-turn" })] : [],
          ),
        hasSession: () => Effect.succeed(started),
        readThread: () => Effect.succeed({ threadId, turns: [] }),
        rollbackThread: () => Effect.succeed({ threadId, turns: [] }),
        stopAll: () => Effect.void,
      };

      const directoryLayer = Layer.succeed(ProviderSessionDirectory, {
        upsert: (binding: ProviderRuntimeBinding) =>
          Effect.sync(() => {
            upserts.push(binding);
          }),
        getProvider: () => Effect.succeed(provider),
        getBinding: () =>
          Effect.succeed(
            Option.some({
              threadId,
              provider,
              providerInstanceId: claudeInstanceId,
              resumeCursor: persistedResumeCursor,
              runtimeMode: "approval-required",
            }),
          ),
        listThreadIds: () => Effect.succeed([threadId]),
        listBindings: () => Effect.succeed([]),
      });

      const adapter = yield* makeDriverPmAdapter({
        project,
        claudeAdapter,
        modelSelection,
        systemPrompt: "PM system prompt",
      }).pipe(Effect.provide(directoryLayer));

      const commands: OrchestrationCommand[] = [];
      const projection = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection: modelSelection,
        events: adapter.events,
      }).pipe(Effect.provide(makeProjectionLayer(commands)));

      const promptFiber = yield* adapter.prompt("Create the task.").pipe(Effect.forkChild);
      yield* Deferred.await(sendTurnCalled);

      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "turn.started",
          turnId,
          payload: { model: modelSelection.model },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "content.delta",
          turnId,
          itemId: RuntimeItemId.make("assistant-1"),
          payload: { streamKind: "assistant_text", delta: "I'll " },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "item.started",
          turnId,
          itemId: toolItemId,
          payload: {
            itemType: "mcp_tool_call",
            status: "inProgress",
            title: "MCP tool",
            data: {
              toolName: orchestrationMcpToolId("handoffWorker"),
              input: { taskId: "task-1", role: "work" },
            },
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "item.completed",
          turnId,
          itemId: toolItemId,
          payload: {
            itemType: "mcp_tool_call",
            status: "completed",
            title: "MCP tool",
            data: {
              toolName: orchestrationMcpToolId("handoffWorker"),
              input: { taskId: "task-1", role: "work" },
              result: { stageThreadId: "stage-thread-1" },
            },
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "content.delta",
          turnId,
          itemId: RuntimeItemId.make("assistant-1"),
          payload: { streamKind: "assistant_text", delta: "start the worker." },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "thread.token-usage.updated",
          turnId,
          payload: {
            usage: {
              usedTokens: 42,
              inputTokens: 20,
              outputTokens: 22,
            },
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "item.completed",
          turnId,
          itemId: RuntimeItemId.make("assistant-1"),
          payload: {
            itemType: "assistant_message",
            status: "completed",
            title: "Assistant message",
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "turn.completed",
          turnId,
          payload: {
            state: "completed",
            stopReason: "stop",
          },
        }),
      );

      const assistant = yield* Fiber.join(promptFiber);
      yield* projection.drain;

      assert.strictEqual(assistant.role, "assistant");
      assert.deepStrictEqual(
        assistant.content
          .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
          .map((entry) => entry.text),
        ["I'll start the worker."],
      );
      assert.deepStrictEqual(startInputs, [
        {
          threadId,
          provider,
          providerInstanceId: claudeInstanceId,
          cwd: project.workspaceRoot,
          modelSelection,
          runtimeMode: "approval-required",
          readOnly: true,
          enableOrchestrationTools: true,
          systemPromptAppend: "PM system prompt",
          resumeCursor: persistedResumeCursor,
        },
      ]);
      assert.deepStrictEqual(
        upserts.map((binding) => binding.resumeCursor),
        [{ resume: "resume-active" }, { resume: "resume-after-turn" }],
      );

      const commandTypes = commands.map((command) => command.type);
      assert.deepStrictEqual(commandTypes, [
        "thread.create",
        "thread.message.assistant.delta",
        "thread.activity.append",
        "thread.activity.append",
        "thread.message.assistant.delta",
        "thread.message.assistant.complete",
      ]);

      const toolActivities = commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append",
      );
      assert.strictEqual(toolActivities[0]?.activity.kind, "tool.started");
      assert.strictEqual(toolActivities[1]?.activity.kind, "tool.completed");
      assert.deepStrictEqual(toolActivities[1]?.activity.payload, {
        itemType: "dynamic_tool_call",
        toolCallId: "tool-call-1",
        toolName: "handoffWorker",
        title: "handoffWorker",
        status: "completed",
        input: { taskId: "task-1", role: "work" },
        details: { stageThreadId: "stage-thread-1" },
      });

      assert.deepStrictEqual(yield* adapter.latestAssistantUsage, {
        input: 20,
        output: 22,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 42,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      });

      yield* adapter.abort;
    }).pipe(Effect.scoped),
  );
});
