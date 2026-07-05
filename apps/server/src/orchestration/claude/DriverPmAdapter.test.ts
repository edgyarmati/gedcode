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
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../../provider/Services/ProviderSessionDirectory.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "../pi/PmEventProjection.ts";
import { makeDriverPmAdapter, type DriverPmClaudeAdapter } from "./DriverPmAdapter.ts";
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
  runtimeMode: "full-access",
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

      const claudeAdapter: DriverPmClaudeAdapter = {
        provider,
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
        stopSession: () =>
          Effect.sync(() => {
            started = false;
          }),
        listSessions: () =>
          Effect.succeed(
            started ? [providerSession(threadId, { resume: "resume-after-turn" })] : [],
          ),
        hasSession: () => Effect.succeed(started),
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
              runtimeMode: "full-access",
            }),
          ),
        listThreadIds: () => Effect.succeed([threadId]),
        listBindings: () => Effect.succeed([]),
      });

      const adapter = yield* makeDriverPmAdapter({
        project,
        claudeAdapter,
        runtimeEvents: Stream.fromQueue(runtimeEvents),
        modelSelection,
        systemPrompt: "PM system prompt",
      }).pipe(Effect.provide(directoryLayer));

      const commands: OrchestrationCommand[] = [];
      const projection = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection: modelSelection,
        events: adapter.events,
        incarnationNonce: "test-nonce",
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
          runtimeMode: "full-access",
          enableOrchestrationTools: true,
          systemPromptAppend: "PM system prompt",
          resumeCursor: persistedResumeCursor,
        },
      ]);
      assert.strictEqual("readOnly" in startInputs[0]!, false);
      assert.deepStrictEqual(
        upserts.map((binding) => binding.resumeCursor),
        [{ resume: "resume-active" }, { resume: "resume-after-turn" }],
      );

      const commandTypes = commands
        .map((command) => command.type)
        .filter((type) => type !== "thread.session.set");
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

  it.effect("preserves every PM text delta when another consumer reads the runtime bus", () =>
    Effect.gen(function* () {
      const runtimeEventBus = yield* PubSub.unbounded<ProviderRuntimeEvent>();
      const runtimeEvents = Stream.fromPubSub(runtimeEventBus);
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-delta-integrity");
      const assistantItemId = RuntimeItemId.make("assistant-delta-integrity");
      const deltaTexts = ["Plan ", "the ", "work ", "without ", "gaps."];
      const sendTurnCalled = yield* Deferred.make<void>();

      const claudeAdapter: DriverPmClaudeAdapter = {
        provider,
        startSession: () => Effect.succeed(providerSession(threadId)),
        sendTurn: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(sendTurnCalled, undefined);
            return { threadId, turnId };
          }),
        interruptTurn: () => Effect.void,
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(true),
      };

      const adapter = yield* makeDriverPmAdapter({
        project,
        claudeAdapter,
        runtimeEvents,
        modelSelection,
      }).pipe(
        Effect.provide(
          Layer.succeed(ProviderSessionDirectory, {
            upsert: () => Effect.void,
            getProvider: () => Effect.succeed(provider),
            getBinding: () => Effect.succeed(Option.none()),
            listThreadIds: () => Effect.succeed([]),
            listBindings: () => Effect.succeed([]),
          }),
        ),
      );

      const commands: OrchestrationCommand[] = [];
      const projection = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection: modelSelection,
        events: adapter.events,
        incarnationNonce: "delta-integrity",
      }).pipe(Effect.provide(makeProjectionLayer(commands)));

      const independentConsumer = yield* runtimeEvents.pipe(
        Stream.filter((event) => event.threadId === threadId && event.type === "content.delta"),
        Stream.take(deltaTexts.length),
        Stream.runCollect,
        Effect.map((chunk) => Array.from(chunk)),
        Effect.forkChild,
      );

      const promptFiber = yield* adapter.prompt("Create the task.").pipe(Effect.forkChild);
      yield* Deferred.await(sendTurnCalled);
      yield* Effect.yieldNow;

      yield* PubSub.publish(
        runtimeEventBus,
        makeEvent({
          type: "turn.started",
          turnId,
          payload: { model: modelSelection.model },
        }),
      );
      for (let index = 0; index < deltaTexts.length; index += 1) {
        yield* PubSub.publish(
          runtimeEventBus,
          makeEvent({
            eventId: `event-delta-integrity-${index}`,
            type: "content.delta",
            turnId,
            itemId: assistantItemId,
            payload: { streamKind: "assistant_text", delta: deltaTexts[index] ?? "" },
          }),
        );
      }
      yield* PubSub.publish(
        runtimeEventBus,
        makeEvent({
          type: "item.completed",
          turnId,
          itemId: assistantItemId,
          payload: {
            itemType: "assistant_message",
            status: "completed",
            title: "Assistant message",
          },
        }),
      );
      yield* PubSub.publish(
        runtimeEventBus,
        makeEvent({
          type: "turn.completed",
          turnId,
          payload: {
            state: "completed",
            stopReason: "stop",
          },
        }),
      );

      const independentlySeen = yield* Fiber.join(independentConsumer);
      const assistant = yield* Fiber.join(promptFiber);
      yield* projection.drain;

      assert.deepStrictEqual(
        independentlySeen.map((event) =>
          event.type === "content.delta" ? event.payload.delta : "",
        ),
        deltaTexts,
      );
      assert.deepStrictEqual(
        assistant.content
          .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
          .map((entry) => entry.text),
        [deltaTexts.join("")],
      );
      assert.deepStrictEqual(
        commands
          .filter(
            (
              command,
            ): command is Extract<
              OrchestrationCommand,
              { type: "thread.message.assistant.delta" }
            > => command.type === "thread.message.assistant.delta",
          )
          .map((command) => command.delta),
        deltaTexts,
      );

      yield* adapter.abort;
    }).pipe(Effect.scoped),
  );

  it.effect("bridges non-orchestration PM tool lifecycle items without result details", () =>
    Effect.gen(function* () {
      const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-built-in-tool");
      const toolItemId = RuntimeItemId.make("read-tool-call");

      const claudeAdapter: DriverPmClaudeAdapter = {
        provider,
        startSession: () => Effect.succeed(providerSession(threadId)),
        sendTurn: () => Effect.succeed({ threadId, turnId }),
        interruptTurn: () => Effect.void,
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(true),
      };

      const adapter = yield* makeDriverPmAdapter({
        project,
        claudeAdapter,
        runtimeEvents: Stream.fromQueue(runtimeEvents),
        modelSelection,
      }).pipe(
        Effect.provide(
          Layer.succeed(ProviderSessionDirectory, {
            upsert: () => Effect.void,
            getProvider: () => Effect.succeed(provider),
            getBinding: () => Effect.succeed(Option.none()),
            listThreadIds: () => Effect.succeed([]),
            listBindings: () => Effect.succeed([]),
          }),
        ),
      );

      const bridgedEventsFiber = yield* Stream.runCollect(Stream.take(adapter.events, 2)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
        Effect.forkChild,
      );

      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "item.started",
          turnId,
          itemId: toolItemId,
          payload: {
            itemType: "dynamic_tool_call",
            status: "inProgress",
            title: "Read",
            data: {
              toolName: "Read",
              input: { file_path: "/tmp/project/src/index.ts" },
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
            itemType: "dynamic_tool_call",
            status: "completed",
            title: "Read",
            data: {
              toolName: "Read",
              input: { file_path: "/tmp/project/src/index.ts" },
              result: {
                content: [{ type: "text", text: "large file contents" }],
              },
            },
          },
        }),
      );

      const bridgedEvents = yield* Fiber.join(bridgedEventsFiber);
      const toolCall = bridgedEvents[0];
      const toolResult = bridgedEvents[1];

      assert.strictEqual(toolCall?.type, "tool_call");
      if (toolCall?.type === "tool_call") {
        assert.strictEqual(toolCall.toolCallId, "read-tool-call");
        assert.strictEqual(toolCall.toolName, "Read");
        assert.deepStrictEqual(toolCall.input, { file_path: "/tmp/project/src/index.ts" });
      }

      assert.strictEqual(toolResult?.type, "tool_result");
      if (toolResult?.type === "tool_result") {
        assert.strictEqual(toolResult.toolCallId, "read-tool-call");
        assert.strictEqual(toolResult.toolName, "Read");
        assert.deepStrictEqual(toolResult.input, { file_path: "/tmp/project/src/index.ts" });
        assert.deepStrictEqual(toolResult.content, []);
        assert.strictEqual(toolResult.details, undefined);
        assert.strictEqual(toolResult.isError, false);
      }

      yield* adapter.abort;
    }).pipe(Effect.scoped),
  );

  it.effect("settles the projected PM turn when Claude aborts without turn.completed", () =>
    Effect.gen(function* () {
      const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sendTurnCalled = yield* Deferred.make<void>();
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-aborted");

      const claudeAdapter: DriverPmClaudeAdapter = {
        provider,
        startSession: () => Effect.succeed(providerSession(threadId)),
        sendTurn: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(sendTurnCalled, undefined);
            return { threadId, turnId };
          }),
        interruptTurn: () => Effect.void,
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(false),
      };

      const adapter = yield* makeDriverPmAdapter({
        project,
        claudeAdapter,
        runtimeEvents: Stream.fromQueue(runtimeEvents),
        modelSelection,
      }).pipe(
        Effect.provide(
          Layer.succeed(ProviderSessionDirectory, {
            upsert: () => Effect.void,
            getProvider: () => Effect.succeed(provider),
            getBinding: () => Effect.succeed(Option.none()),
            listThreadIds: () => Effect.succeed([]),
            listBindings: () => Effect.succeed([]),
          }),
        ),
      );

      const commands: OrchestrationCommand[] = [];
      const projection = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection: modelSelection,
        events: adapter.events,
        incarnationNonce: "test-nonce",
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
          type: "turn.aborted",
          turnId,
          payload: { reason: "operator interrupted the PM turn" },
        }),
      );

      const error = yield* Fiber.join(promptFiber).pipe(Effect.flip);
      yield* projection.drain;

      assert.match(error.detail, /operator interrupted/);
      const sessionCommands = commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.session.set" }> =>
          command.type === "thread.session.set",
      );
      assert.deepStrictEqual(
        sessionCommands.map((command) => command.session.status),
        ["running", "ready"],
      );
    }).pipe(Effect.scoped),
  );
});
