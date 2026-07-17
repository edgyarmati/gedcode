import {
  EventId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationProject,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RuntimeItemId,
  RuntimeRequestId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderSessionStartInput,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import type * as CodexSchema from "effect-codex-app-server/schema";
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
import type { PmRuntimeError } from "../pm/Errors.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "../pm/PmEventProjection.ts";
import { makeDriverPmAdapter, type DriverPmProviderAdapter } from "./DriverPmAdapter.ts";
import { ORCHESTRATION_MCP_SERVER_NAME, orchestrationMcpToolId } from "./pmMcpServer.ts";
import type { AgentHarnessEvent } from "./pmHarness.ts";

const provider = ProviderDriverKind.make("claudeAgent");
const codexProvider = ProviderDriverKind.make("codex");
const projectId = ProjectId.make("project-1");
const claudeInstanceId = ProviderInstanceId.make("claudeAgent");
const codexInstanceId = ProviderInstanceId.make("codex");
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
  input: {
    readonly provider?: ProviderDriverKind;
    readonly providerInstanceId?: ProviderInstanceId;
    readonly model?: string;
  } = {},
): ProviderSession => ({
  provider: input.provider ?? provider,
  providerInstanceId: input.providerInstanceId ?? claudeInstanceId,
  status: "ready",
  runtimeMode: "approval-required",
  cwd: project.workspaceRoot,
  model: input.model ?? modelSelection.model,
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

const emptyDirectoryLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () => Effect.succeed(provider),
  getBinding: () => Effect.succeed(Option.none()),
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

type CodexStartedMcpToolCall = Extract<
  CodexSchema.V2ItemStartedNotification["item"],
  { readonly type: "mcpToolCall" }
>;

const codexStartedNotification = (
  item: CodexStartedMcpToolCall,
): CodexSchema.V2ItemStartedNotification => ({
  item,
  startedAtMs: 0,
  threadId: "codex-thread",
  turnId: "codex-turn",
});

const codexCompletedNotification = (
  item: CodexSchema.V2ItemCompletedNotification["item"],
): CodexSchema.V2ItemCompletedNotification => ({
  completedAtMs: 1,
  item,
  threadId: "codex-thread",
  turnId: "codex-turn",
});

const collectBridgedEvents = (
  runtimeEventInputs: ReadonlyArray<ProviderRuntimeEvent>,
  count: number,
): Effect.Effect<ReadonlyArray<AgentHarnessEvent>, PmRuntimeError, never> =>
  Effect.gen(function* () {
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const threadId = pmThreadIdForProject(project);
    const providerAdapter: DriverPmProviderAdapter = {
      provider,
      startSession: () => Effect.succeed(providerSession(threadId)),
      sendTurn: () => Effect.succeed({ threadId, turnId: TurnId.make("turn-bridged") }),
      interruptTurn: () => Effect.void,
      stopSession: () => Effect.void,
      listSessions: () => Effect.succeed([]),
      hasSession: () => Effect.succeed(true),
    };

    const adapter = yield* makeDriverPmAdapter({
      project,
      driverKind: provider,
      providerAdapter,
      runtimeEvents: Stream.fromQueue(runtimeEvents),
      modelSelection,
    }).pipe(Effect.provide(emptyDirectoryLayer));

    const bridgedEventsFiber = yield* Stream.runCollect(Stream.take(adapter.events, count)).pipe(
      Effect.map((chunk) => Array.from(chunk)),
      Effect.forkChild,
    );
    for (const event of runtimeEventInputs) {
      yield* Queue.offer(runtimeEvents, event);
    }
    const bridgedEvents = yield* Fiber.join(bridgedEventsFiber);
    yield* adapter.abort;
    return bridgedEvents;
  });

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

      const providerAdapter: DriverPmProviderAdapter = {
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
              runtimeMode: "approval-required",
            }),
          ),
        listThreadIds: () => Effect.succeed([threadId]),
        listBindings: () => Effect.succeed([]),
      });

      const adapter = yield* makeDriverPmAdapter({
        project,
        driverKind: provider,
        providerAdapter,
        runtimeEvents: Stream.fromQueue(runtimeEvents),
        modelSelection,
        systemPrompt: "PM system prompt",
      }).pipe(Effect.provide(directoryLayer));

      const commands: OrchestrationCommand[] = [];
      const projection = yield* makePmEventProjectionRuntime({
        project,
        providerName: provider,
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
          eventId: "event-approval-requested",
          type: "request.opened",
          turnId,
          requestId: RuntimeRequestId.make("req-approval-1"),
          payload: {
            requestType: "file_change_approval",
            detail: "Update a project file",
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          eventId: "event-approval-resolved",
          type: "request.resolved",
          turnId,
          requestId: RuntimeRequestId.make("req-approval-1"),
          payload: {
            requestType: "file_change_approval",
            decision: "accept",
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          eventId: "event-user-input-requested",
          type: "user-input.requested",
          turnId,
          requestId: RuntimeRequestId.make("req-user-input-1"),
          payload: {
            questions: [
              {
                id: "scope",
                header: "Scope",
                question: "Which scope should the PM use?",
                options: [
                  {
                    label: "Small",
                    description: "Keep the plan narrow.",
                  },
                ],
                multiSelect: false,
              },
            ],
          },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          eventId: "event-user-input-resolved",
          type: "user-input.resolved",
          turnId,
          requestId: RuntimeRequestId.make("req-user-input-1"),
          payload: {
            answers: {
              scope: "Small",
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
        "thread.activity.append",
        "thread.activity.append",
        "thread.activity.append",
        "thread.activity.append",
        "thread.message.assistant.complete",
      ]);

      const toolActivities = commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append",
      );
      assert.strictEqual(toolActivities[0]?.activity.kind, "tool.started");
      assert.strictEqual(toolActivities[1]?.activity.kind, "tool.completed");
      assert.strictEqual(toolActivities[2]?.activity.kind, "approval.requested");
      assert.strictEqual(toolActivities[3]?.activity.kind, "approval.resolved");
      assert.strictEqual(toolActivities[4]?.activity.kind, "user-input.requested");
      assert.strictEqual(toolActivities[5]?.activity.kind, "user-input.resolved");
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

  it.effect("stamps Codex provider bindings and assistant envelopes from driverKind", () =>
    Effect.gen(function* () {
      const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sendTurnCalled = yield* Deferred.make<void>();
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-codex-pm");
      const assistantItemId = RuntimeItemId.make("assistant-codex-pm");
      const codexSelection: ModelSelection = {
        instanceId: codexInstanceId,
        model: "gpt-5-codex",
      };
      const startInputs: ProviderSessionStartInput[] = [];
      const upserts: ProviderRuntimeBinding[] = [];
      let started = false;

      const providerAdapter: DriverPmProviderAdapter = {
        provider: codexProvider,
        startSession: (input) =>
          Effect.sync(() => {
            started = true;
            startInputs.push(input);
            return providerSession(
              threadId,
              { resume: "codex-started" },
              {
                provider: codexProvider,
                providerInstanceId: codexInstanceId,
                model: codexSelection.model,
              },
            );
          }),
        sendTurn: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(sendTurnCalled, undefined);
            return { threadId, turnId, resumeCursor: { threadId: "codex-thread" } };
          }),
        interruptTurn: () => Effect.void,
        stopSession: () =>
          Effect.sync(() => {
            started = false;
          }),
        listSessions: () =>
          Effect.succeed(
            started
              ? [
                  providerSession(
                    threadId,
                    { threadId: "codex-thread-after-turn" },
                    {
                      provider: codexProvider,
                      providerInstanceId: codexInstanceId,
                      model: codexSelection.model,
                    },
                  ),
                ]
              : [],
          ),
        hasSession: () => Effect.succeed(started),
      };

      const adapter = yield* makeDriverPmAdapter({
        project,
        driverKind: codexProvider,
        providerAdapter,
        runtimeEvents: Stream.fromQueue(runtimeEvents),
        modelSelection: codexSelection,
      }).pipe(
        Effect.provide(
          Layer.succeed(ProviderSessionDirectory, {
            upsert: (binding: ProviderRuntimeBinding) =>
              Effect.sync(() => {
                upserts.push(binding);
              }),
            getProvider: () => Effect.succeed(codexProvider),
            getBinding: () => Effect.succeed(Option.none()),
            listThreadIds: () => Effect.succeed([]),
            listBindings: () => Effect.succeed([]),
          }),
        ),
      );

      const promptFiber = yield* adapter.prompt("Plan the task.").pipe(Effect.forkChild);
      yield* Deferred.await(sendTurnCalled);
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "turn.started",
          turnId,
          payload: { model: codexSelection.model },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
        makeEvent({
          type: "content.delta",
          turnId,
          itemId: assistantItemId,
          payload: { streamKind: "assistant_text", delta: "Codex PM response." },
        }),
      );
      yield* Queue.offer(
        runtimeEvents,
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

      assert.strictEqual(assistant.api, "codex-app-server");
      assert.strictEqual(assistant.provider, "openai");
      assert.deepStrictEqual(startInputs, [
        {
          threadId,
          provider: codexProvider,
          providerInstanceId: codexInstanceId,
          cwd: project.workspaceRoot,
          modelSelection: codexSelection,
          runtimeMode: "auto-accept-edits",
          approvalReviewer: "auto-review",
          enableOrchestrationTools: true,
        },
      ]);
      assert.deepStrictEqual(
        upserts.map((binding) => binding.provider),
        [codexProvider, codexProvider],
      );
      assert.deepStrictEqual(
        upserts.map((binding) => binding.resumeCursor),
        [{ resume: "codex-started" }, { threadId: "codex-thread-after-turn" }],
      );

      yield* adapter.abort;
      yield* Queue.shutdown(runtimeEvents);
    }).pipe(Effect.scoped),
  );

  it.effect("fails an active prompt when the provider runtime event stream ends", () =>
    Effect.gen(function* () {
      const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const sendTurnCalled = yield* Deferred.make<void>();
      const allowSendTurnReturn = yield* Deferred.make<void>();
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-stream-ended");

      const providerAdapter: DriverPmProviderAdapter = {
        provider,
        startSession: () => Effect.succeed(providerSession(threadId)),
        sendTurn: () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(sendTurnCalled, undefined);
            yield* Deferred.await(allowSendTurnReturn);
            return { threadId, turnId };
          }),
        interruptTurn: () => Effect.void,
        stopSession: () => Effect.void,
        listSessions: () => Effect.succeed([]),
        hasSession: () => Effect.succeed(true),
      };

      const adapter = yield* makeDriverPmAdapter({
        project,
        driverKind: provider,
        providerAdapter,
        runtimeEvents: Stream.fromQueue(runtimeEvents),
        modelSelection,
      }).pipe(Effect.provide(emptyDirectoryLayer));

      const eventsFiber = yield* Stream.runCollect(Stream.take(adapter.events, 3)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
        Effect.forkChild,
      );
      const promptFiber = yield* adapter
        .prompt("Plan the task.")
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(sendTurnCalled);
      yield* Deferred.succeed(allowSendTurnReturn, undefined);
      yield* Effect.yieldNow;

      yield* Queue.shutdown(runtimeEvents);

      const error = yield* Fiber.join(promptFiber);
      assert.strictEqual(error.operation, "DriverPmAdapter.prompt");
      assert.strictEqual(
        error.detail,
        "Driver PM event stream ended before the active turn completed.",
      );
      const events = yield* Fiber.join(eventsFiber);
      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["before_agent_start", "provider_runtime_turn_abnormal_end", "settled"],
      );
      const abnormalEnd = events[1];
      assert.ok(abnormalEnd);
      assert.strictEqual(abnormalEnd.type, "provider_runtime_turn_abnormal_end");
      if (abnormalEnd.type === "provider_runtime_turn_abnormal_end") {
        assert.strictEqual(
          abnormalEnd.reason,
          "Driver PM event stream ended before the active turn completed.",
        );
      }
      assert.strictEqual(yield* adapter.isIdle, true);

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

      const providerAdapter: DriverPmProviderAdapter = {
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
        driverKind: provider,
        providerAdapter,
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
        providerName: provider,
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

  it.effect("bridges Codex orchestration MCP tool lifecycle items with result details", () =>
    Effect.gen(function* () {
      const turnId = TurnId.make("turn-codex-orchestration-tool");
      const toolItemId = RuntimeItemId.make("codex-tool-call-1");
      const result = {
        content: [{ type: "text", text: "Started worker task." }],
        structuredContent: { stageThreadId: "stage-thread-1" },
      };

      const bridgedEvents = yield* collectBridgedEvents(
        [
          makeEvent({
            type: "item.started",
            turnId,
            itemId: toolItemId,
            payload: {
              itemType: "mcp_tool_call",
              status: "inProgress",
              title: "MCP tool call",
              data: codexStartedNotification({
                arguments: { taskId: "task-1", role: "work" },
                id: String(toolItemId),
                server: ORCHESTRATION_MCP_SERVER_NAME,
                status: "inProgress",
                tool: "handoffWorker",
                type: "mcpToolCall",
              }),
            },
          }),
          makeEvent({
            type: "item.completed",
            turnId,
            itemId: toolItemId,
            payload: {
              itemType: "mcp_tool_call",
              status: "completed",
              title: "MCP tool call",
              data: codexCompletedNotification({
                arguments: { taskId: "task-1", role: "work" },
                id: String(toolItemId),
                result,
                server: ORCHESTRATION_MCP_SERVER_NAME,
                status: "completed",
                tool: "handoffWorker",
                type: "mcpToolCall",
              }),
            },
          }),
        ],
        2,
      );

      const toolCall = bridgedEvents[0];
      const toolResult = bridgedEvents[1];
      assert.strictEqual(toolCall?.type, "tool_call");
      if (toolCall?.type === "tool_call") {
        assert.strictEqual(toolCall.toolName, "handoffWorker");
        assert.deepStrictEqual(toolCall.input, { taskId: "task-1", role: "work" });
      }
      assert.strictEqual(toolResult?.type, "tool_result");
      if (toolResult?.type === "tool_result") {
        assert.strictEqual(toolResult.toolName, "handoffWorker");
        assert.deepStrictEqual(toolResult.input, { taskId: "task-1", role: "work" });
        assert.deepStrictEqual(toolResult.content, [
          { type: "text", text: "Started worker task." },
        ]);
        assert.deepStrictEqual(toolResult.details, result);
        assert.strictEqual(toolResult.isError, false);
      }
    }),
  );

  it.effect("bridges Codex non-orchestration MCP tool lifecycle items without details", () =>
    Effect.gen(function* () {
      const turnId = TurnId.make("turn-codex-external-tool");
      const toolItemId = RuntimeItemId.make("codex-tool-call-external");

      const bridgedEvents = yield* collectBridgedEvents(
        [
          makeEvent({
            type: "item.started",
            turnId,
            itemId: toolItemId,
            payload: {
              itemType: "mcp_tool_call",
              status: "inProgress",
              title: "MCP tool call",
              data: codexStartedNotification({
                arguments: { owner: "openai", repo: "codex" },
                id: String(toolItemId),
                server: "github",
                status: "inProgress",
                tool: "getRepo",
                type: "mcpToolCall",
              }),
            },
          }),
          makeEvent({
            type: "item.completed",
            turnId,
            itemId: toolItemId,
            payload: {
              itemType: "mcp_tool_call",
              status: "completed",
              title: "MCP tool call",
              data: codexCompletedNotification({
                arguments: { owner: "openai", repo: "codex" },
                id: String(toolItemId),
                result: {
                  content: [{ type: "text", text: "Repository details" }],
                  structuredContent: { stars: 1 },
                },
                server: "github",
                status: "completed",
                tool: "getRepo",
                type: "mcpToolCall",
              }),
            },
          }),
        ],
        2,
      );

      const toolCall = bridgedEvents[0];
      const toolResult = bridgedEvents[1];
      assert.strictEqual(toolCall?.type, "tool_call");
      if (toolCall?.type === "tool_call") {
        assert.strictEqual(toolCall.toolName, "getRepo");
        assert.deepStrictEqual(toolCall.input, { owner: "openai", repo: "codex" });
      }
      assert.strictEqual(toolResult?.type, "tool_result");
      if (toolResult?.type === "tool_result") {
        assert.strictEqual(toolResult.toolName, "getRepo");
        assert.deepStrictEqual(toolResult.input, { owner: "openai", repo: "codex" });
        assert.deepStrictEqual(toolResult.content, []);
        assert.strictEqual(toolResult.details, undefined);
        assert.strictEqual(toolResult.isError, false);
      }
    }),
  );

  it.effect("marks failed Codex MCP tool lifecycle items as errors", () =>
    Effect.gen(function* () {
      const turnId = TurnId.make("turn-codex-failed-tool");
      const toolItemId = RuntimeItemId.make("codex-tool-call-failed");
      const error = { message: "Tool failed before producing a result." };

      const bridgedEvents = yield* collectBridgedEvents(
        [
          makeEvent({
            type: "item.started",
            turnId,
            itemId: toolItemId,
            payload: {
              itemType: "mcp_tool_call",
              status: "inProgress",
              title: "MCP tool call",
              data: codexStartedNotification({
                arguments: { taskId: "task-1" },
                id: String(toolItemId),
                server: ORCHESTRATION_MCP_SERVER_NAME,
                status: "inProgress",
                tool: "reviewTask",
                type: "mcpToolCall",
              }),
            },
          }),
          makeEvent({
            type: "item.completed",
            turnId,
            itemId: toolItemId,
            payload: {
              itemType: "mcp_tool_call",
              status: "completed",
              title: "MCP tool call",
              data: codexCompletedNotification({
                arguments: { taskId: "task-1" },
                error,
                id: String(toolItemId),
                server: ORCHESTRATION_MCP_SERVER_NAME,
                status: "failed",
                tool: "reviewTask",
                type: "mcpToolCall",
              }),
            },
          }),
        ],
        2,
      );

      const toolResult = bridgedEvents[1];
      assert.strictEqual(toolResult?.type, "tool_result");
      if (toolResult?.type === "tool_result") {
        assert.strictEqual(toolResult.toolName, "reviewTask");
        assert.deepStrictEqual(toolResult.content, [
          { type: "text", text: "Tool failed before producing a result." },
        ]);
        assert.deepStrictEqual(toolResult.details, error);
        assert.strictEqual(toolResult.isError, true);
      }
    }),
  );

  it.effect("does not treat Codex assistant-message items as tool lifecycle items", () =>
    Effect.gen(function* () {
      const turnId = TurnId.make("turn-codex-assistant-message");
      const assistantItemId = RuntimeItemId.make("codex-assistant-message");

      const bridgedEvents = yield* collectBridgedEvents(
        [
          makeEvent({
            type: "content.delta",
            turnId,
            itemId: assistantItemId,
            payload: { streamKind: "assistant_text", delta: "Codex replied." },
          }),
          makeEvent({
            type: "item.completed",
            turnId,
            itemId: assistantItemId,
            payload: {
              itemType: "assistant_message",
              status: "completed",
              title: "Assistant message",
              data: codexCompletedNotification({
                id: String(assistantItemId),
                text: "Codex replied.",
                type: "agentMessage",
              }),
            },
          }),
        ],
        3,
      );

      assert.deepStrictEqual(
        bridgedEvents.map((event) => event.type),
        ["message_start", "message_update", "message_end"],
      );
      const completed = bridgedEvents[2];
      assert.strictEqual(completed?.type, "message_end");
      if (completed?.type === "message_end" && completed.message.role === "assistant") {
        assert.deepStrictEqual(completed.message.content, [
          { type: "text", text: "Codex replied." },
        ]);
      }
    }),
  );

  it.effect("bridges non-orchestration PM tool lifecycle items without result details", () =>
    Effect.gen(function* () {
      const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const threadId = pmThreadIdForProject(project);
      const turnId = TurnId.make("turn-built-in-tool");
      const toolItemId = RuntimeItemId.make("read-tool-call");

      const providerAdapter: DriverPmProviderAdapter = {
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
        driverKind: provider,
        providerAdapter,
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

      const providerAdapter: DriverPmProviderAdapter = {
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
        driverKind: provider,
        providerAdapter,
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
        providerName: provider,
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
