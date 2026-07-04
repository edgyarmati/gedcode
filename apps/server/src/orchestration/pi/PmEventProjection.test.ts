import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { decideOrchestrationCommand } from "../decider.ts";
import { createEmptyReadModel, projectEvent } from "../projector.ts";
import { makePmEventProjectionRuntime, pmThreadIdForProject } from "./PmEventProjection.ts";

const now = 1_797_209_000_000;
const projectId = ProjectId.make("project-1");
const pmModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.5",
};

const project: OrchestrationProject = {
  id: projectId,
  title: "Project",
  workspaceRoot: "/tmp/project",
  repositoryIdentity: null,
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  roleModelSelections: {},
  orchestratorConfig: {
    enabled: true,
    pmModelSelection,
  },
  scripts: [],
  createdAt: "2026-06-14T10:00:00.000Z",
  updatedAt: "2026-06-14T10:00:00.000Z",
  deletedAt: null,
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const assistantMessage = (text: string): AssistantMessage => ({
  role: "assistant",
  content: text.length > 0 ? [{ type: "text", text }] : [],
  api: "openai-responses",
  provider: "openai",
  model: "gpt-5.5",
  usage,
  stopReason: "stop",
  timestamp: now,
});

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

const toEvents = (result: PlannedEvent | ReadonlyArray<PlannedEvent>): PlannedEvent[] =>
  Array.isArray(result) ? [...(result as ReadonlyArray<PlannedEvent>)] : [result as PlannedEvent];

const makeReadModelRef = () => ({
  current: {
    ...createEmptyReadModel("2026-06-14T10:00:00.000Z"),
    projects: [project],
  },
});

const makeLayer = (
  commands: OrchestrationCommand[],
  readModelRef: { current: OrchestrationReadModel } = makeReadModelRef(),
) =>
  Layer.mergeAll(
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      dispatch: (command: OrchestrationCommand) =>
        Effect.gen(function* () {
          commands.push(command);
          const result = yield* decideOrchestrationCommand({
            readModel: readModelRef.current,
            command,
          });
          let sequence = readModelRef.current.snapshotSequence;
          for (const plannedEvent of toEvents(result)) {
            sequence += 1;
            readModelRef.current = yield* projectEvent(readModelRef.current, {
              ...plannedEvent,
              sequence,
            } as OrchestrationEvent);
          }
          return { sequence: readModelRef.current.snapshotSequence };
        }).pipe(Effect.provide(NodeServices.layer), Effect.orDie),
      streamDomainEvents: Stream.empty,
      streamShellEvents: Stream.empty,
    }),
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadShellById: (threadId: ThreadId) =>
        Effect.succeed(
          readModelRef.current.threads.some((thread) => thread.id === threadId)
            ? Option.some({ id: threadId } as never)
            : Option.none(),
        ),
    } as never),
  );

describe("PmEventProjection", () => {
  it.effect("uses per-incarnation nonces for command, message, and turn ids", () => {
    const runIncarnation = (incarnationNonce: string, commands: OrchestrationCommand[]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makePmEventProjectionRuntime({
            project,
            pmModelSelection,
            events: Stream.empty,
            incarnationNonce,
          });

          yield* runtime.dispatchUserMessage("Human message.");
          yield* runtime.project({
            type: "before_agent_start",
            prompt: "Create a task.",
          } as AgentHarnessEvent);
          yield* runtime.project({
            type: "message_start",
            message: assistantMessage("Assistant message."),
          } satisfies AgentHarnessEvent);
        }),
      ).pipe(Effect.provide(makeLayer(commands)));

    const projectionIds = (commands: ReadonlyArray<OrchestrationCommand>) => {
      const threadCreateCommand = commands.find((command) => command.type === "thread.create");
      const userCommand = commands.find(
        (
          command,
        ): command is Extract<OrchestrationCommand, { type: "thread.message.user.append" }> =>
          command.type === "thread.message.user.append",
      );
      const sessionCommand = commands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.session.set" }> =>
          command.type === "thread.session.set",
      );
      const assistantCommand = commands.find(
        (
          command,
        ): command is Extract<OrchestrationCommand, { type: "thread.message.assistant.delta" }> =>
          command.type === "thread.message.assistant.delta",
      );

      assert.ok(threadCreateCommand);
      assert.ok(userCommand);
      assert.ok(sessionCommand);
      assert.ok(assistantCommand);

      return {
        threadCreateCommandId: String(threadCreateCommand.commandId),
        userCommandId: String(userCommand.commandId),
        userMessageId: String(userCommand.messageId),
        sessionCommandId: String(sessionCommand.commandId),
        turnId: String(sessionCommand.session.activeTurnId),
        assistantCommandId: String(assistantCommand.commandId),
        assistantMessageId: String(assistantCommand.messageId),
      };
    };

    const firstCommands: OrchestrationCommand[] = [];
    const secondCommands: OrchestrationCommand[] = [];

    return Effect.gen(function* () {
      yield* runIncarnation("incarnation-a", firstCommands);
      yield* runIncarnation("incarnation-b", secondCommands);

      const firstIds = projectionIds(firstCommands);
      const secondIds = projectionIds(secondCommands);

      assert.deepStrictEqual(firstIds, {
        threadCreateCommandId: "pm-projection:project-1:incarnation-a:thread-create:1",
        userCommandId: "pm-projection:project-1:incarnation-a:user-message:2",
        userMessageId: "pm:project-1:incarnation-a:user:3",
        sessionCommandId: "pm-projection:project-1:incarnation-a:session-running:5",
        turnId: "pm:project-1:incarnation-a:turn:4",
        assistantCommandId: "pm-projection:project-1:incarnation-a:assistant-delta:7",
        assistantMessageId: "pm:project-1:incarnation-a:assistant:6",
      });
      assert.deepStrictEqual(secondIds, {
        threadCreateCommandId: "pm-projection:project-1:incarnation-b:thread-create:1",
        userCommandId: "pm-projection:project-1:incarnation-b:user-message:2",
        userMessageId: "pm:project-1:incarnation-b:user:3",
        sessionCommandId: "pm-projection:project-1:incarnation-b:session-running:5",
        turnId: "pm:project-1:incarnation-b:turn:4",
        assistantCommandId: "pm-projection:project-1:incarnation-b:assistant-delta:7",
        assistantMessageId: "pm:project-1:incarnation-b:assistant:6",
      });
      assert.deepStrictEqual(
        Object.values(firstIds).filter((id) => Object.values(secondIds).includes(id)),
        [],
      );
    });
  });

  it.effect("surfaces explicit human PM messages in order before PM output", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.dispatchUserMessage("First human message.");
      yield* runtime.dispatchUserMessage("Second human message.");
      yield* runtime.project({
        type: "message_start",
        message: assistantMessage("PM output"),
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "message_end",
        message: assistantMessage("PM output"),
      } satisfies AgentHarnessEvent);

      assert.deepStrictEqual(
        commands.map((command) => command.type),
        [
          "thread.create",
          "thread.message.user.append",
          "thread.message.user.append",
          "thread.session.set",
          "thread.message.assistant.delta",
          "thread.message.assistant.complete",
        ],
      );

      const userMessageCommands = commands.filter(
        (
          command,
        ): command is Extract<OrchestrationCommand, { type: "thread.message.user.append" }> =>
          command.type === "thread.message.user.append",
      );
      assert.deepStrictEqual(
        userMessageCommands.map((command) => command.text),
        ["First human message.", "Second human message."],
      );
      assert.ok(userMessageCommands.every((command) => command.threadId === runtime.pmThreadId));

      const assistantDeltaCommand = commands.find(
        (command) => command.type === "thread.message.assistant.delta",
      );
      assert.strictEqual(assistantDeltaCommand?.type, "thread.message.assistant.delta");
      if (assistantDeltaCommand?.type === "thread.message.assistant.delta") {
        assert.strictEqual(assistantDeltaCommand.threadId, runtime.pmThreadId);
        assert.strictEqual(assistantDeltaCommand.delta, "PM output");
      }
    }).pipe(Effect.provide(makeLayer(commands)), Effect.scoped);
  });

  it.effect("does not surface pi before_agent_start prompts as user messages", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "before_agent_start",
        prompt: "Settlement re-entry context should not render as a human message.",
      } as AgentHarnessEvent);

      assert.deepStrictEqual(
        commands.filter((command) => command.type === "thread.message.user.append"),
        [],
      );
    }).pipe(Effect.provide(makeLayer(commands)), Effect.scoped);
  });

  it.effect("marks the PM turn ready when a terminal agent_end arrives without turn_end", () => {
    const commands: OrchestrationCommand[] = [];
    const readModelRef = makeReadModelRef();
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "before_agent_start",
        prompt: "Create a task.",
      } as AgentHarnessEvent);
      yield* runtime.project({
        type: "agent_end",
        messages: [],
      } satisfies AgentHarnessEvent);

      const sessionCommands = commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.session.set" }> =>
          command.type === "thread.session.set",
      );
      assert.deepStrictEqual(
        sessionCommands.map((command) => command.session.status),
        ["running", "ready"],
      );

      const pmThread = readModelRef.current.threads.find(
        (thread) => thread.id === runtime.pmThreadId,
      );
      assert.ok(pmThread);
      assert.strictEqual(pmThread.session?.status, "ready");
      assert.strictEqual(pmThread.latestTurn?.state, "completed");
    }).pipe(Effect.provide(makeLayer(commands, readModelRef)), Effect.scoped);
  });

  it.effect("dispatches Claude driver kind as providerName for PM sessions", () => {
    const commands: OrchestrationCommand[] = [];
    const claudeWorkSelection = {
      instanceId: ProviderInstanceId.make("claude_work"),
      model: "claude-sonnet-4-6",
    };
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection: claudeWorkSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "before_agent_start",
        prompt: "Create a task.",
      } as AgentHarnessEvent);

      const sessionCommand = commands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.session.set" }> =>
          command.type === "thread.session.set",
      );
      assert.ok(sessionCommand);
      assert.strictEqual(sessionCommand.session.providerName, "claudeAgent");
      assert.strictEqual(sessionCommand.session.providerInstanceId, claudeWorkSelection.instanceId);
    }).pipe(Effect.provide(makeLayer(commands)), Effect.scoped);
  });

  it.effect("settles an active PM turn when the projection scope is torn down", () => {
    const commands: OrchestrationCommand[] = [];
    const readModelRef = makeReadModelRef();
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makePmEventProjectionRuntime({
            project,
            pmModelSelection,
            events: Stream.empty,
            incarnationNonce: "test-nonce",
          });

          yield* runtime.project({
            type: "before_agent_start",
            prompt: "Create a task.",
          } as AgentHarnessEvent);
        }),
      ).pipe(Effect.provide(makeLayer(commands, readModelRef)));

      const sessionCommands = commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.session.set" }> =>
          command.type === "thread.session.set",
      );
      assert.deepStrictEqual(
        sessionCommands.map((command) => command.session.status),
        ["running", "ready"],
      );

      const pmThread = readModelRef.current.threads.find(
        (thread) => thread.id === pmThreadIdForProject(project),
      );
      assert.ok(pmThread);
      assert.strictEqual(pmThread.session?.status, "ready");
      assert.strictEqual(pmThread.latestTurn?.state, "completed");
    });
  });

  it.effect("projects pi assistant deltas onto the deterministic PM thread", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "message_start",
        message: assistantMessage(""),
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "message_update",
        message: assistantMessage("Hello "),
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "Hello ",
          partial: assistantMessage("Hello "),
        },
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "message_update",
        message: assistantMessage("Hello world"),
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "world",
          partial: assistantMessage("Hello world"),
        },
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "message_end",
        message: assistantMessage("Hello world"),
      } satisfies AgentHarnessEvent);

      assert.strictEqual(runtime.pmThreadId, pmThreadIdForProject(project));
      assert.deepStrictEqual(
        commands.map((command) => command.type),
        [
          "thread.create",
          "thread.session.set",
          "thread.message.assistant.delta",
          "thread.message.assistant.delta",
          "thread.message.assistant.complete",
        ],
      );
      assert.strictEqual(commands[0]?.type, "thread.create");
      if (commands[0]?.type === "thread.create") {
        assert.strictEqual(commands[0].threadId, runtime.pmThreadId);
        assert.strictEqual(commands[0].gedWorkflowEnabled, false);
        assert.deepStrictEqual(commands[0].modelSelection, pmModelSelection);
      }

      const deltaCommands = commands.filter(
        (
          command,
        ): command is Extract<OrchestrationCommand, { type: "thread.message.assistant.delta" }> =>
          command.type === "thread.message.assistant.delta",
      );
      assert.deepStrictEqual(
        deltaCommands.map((command) => command.delta),
        ["Hello ", "world"],
      );
      assert.strictEqual(deltaCommands[0]?.messageId, deltaCommands[1]?.messageId);

      const completeCommand = commands.at(-1);
      assert.strictEqual(completeCommand?.type, "thread.message.assistant.complete");
      if (completeCommand?.type === "thread.message.assistant.complete") {
        assert.strictEqual(completeCommand.messageId, deltaCommands[0]?.messageId);
        assert.strictEqual(completeCommand.threadId, runtime.pmThreadId);
      }
    }).pipe(Effect.provide(makeLayer(commands)), Effect.scoped);
  });

  it.effect("does not complete an assistant message for a tool-only PM turn", () => {
    const commands: OrchestrationCommand[] = [];
    const readModelRef = makeReadModelRef();
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "message_start",
        message: assistantMessage(""),
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "tool_call",
        toolCallId: "tool-call-1",
        toolName: "handoffWorker",
        input: { taskId: "task-1", role: "work" },
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "tool_result",
        toolCallId: "tool-call-1",
        toolName: "handoffWorker",
        input: { taskId: "task-1", role: "work" },
        content: [{ type: "text", text: "Started worker." }],
        details: { stageThreadId: "stage-1" },
        isError: false,
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "message_end",
        message: assistantMessage(""),
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "turn_end",
        message: assistantMessage(""),
        toolResults: [],
      } satisfies AgentHarnessEvent);

      assert.deepStrictEqual(
        commands.map((command) => command.type),
        [
          "thread.create",
          "thread.session.set",
          "thread.activity.append",
          "thread.activity.append",
          "thread.session.set",
        ],
      );
      assert.ok(!commands.some((command) => command.type === "thread.message.assistant.delta"));
      assert.ok(!commands.some((command) => command.type === "thread.message.assistant.complete"));

      const pmThread = readModelRef.current.threads.find(
        (thread) => thread.id === runtime.pmThreadId,
      );
      assert.ok(pmThread);
      assert.deepStrictEqual(pmThread.messages, []);
      assert.deepStrictEqual(pmThread.activities.map((activity) => activity.kind).toSorted(), [
        "tool.completed",
        "tool.started",
      ]);
      assert.strictEqual(pmThread.latestTurn?.state, "completed");
    }).pipe(Effect.provide(makeLayer(commands, readModelRef)), Effect.scoped);
  });

  it.effect("still emits one assistant message when final PM text arrives at message end", () => {
    const commands: OrchestrationCommand[] = [];
    const readModelRef = makeReadModelRef();
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "message_start",
        message: assistantMessage(""),
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "message_end",
        message: assistantMessage("Final answer."),
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "turn_end",
        message: assistantMessage("Final answer."),
        toolResults: [],
      } satisfies AgentHarnessEvent);

      const assistantCommands = commands.filter(
        (command) =>
          command.type === "thread.message.assistant.delta" ||
          command.type === "thread.message.assistant.complete",
      );
      assert.deepStrictEqual(
        assistantCommands.map((command) => command.type),
        ["thread.message.assistant.delta", "thread.message.assistant.complete"],
      );
      const deltaCommand = assistantCommands[0];
      const completeCommand = assistantCommands[1];
      assert.strictEqual(deltaCommand?.type, "thread.message.assistant.delta");
      assert.strictEqual(completeCommand?.type, "thread.message.assistant.complete");
      if (
        deltaCommand?.type === "thread.message.assistant.delta" &&
        completeCommand?.type === "thread.message.assistant.complete"
      ) {
        assert.strictEqual(deltaCommand.delta, "Final answer.");
        assert.strictEqual(deltaCommand.messageId, completeCommand.messageId);
      }

      const pmThread = readModelRef.current.threads.find(
        (thread) => thread.id === runtime.pmThreadId,
      );
      assert.ok(pmThread);
      assert.strictEqual(pmThread.messages.length, 1);
      const message = pmThread.messages[0];
      assert.ok(message);
      if (deltaCommand?.type === "thread.message.assistant.delta") {
        assert.strictEqual(message.id, deltaCommand.messageId);
      }
      assert.strictEqual(message.role, "assistant");
      assert.strictEqual(message.text, "Final answer.");
      assert.strictEqual(message.turnId, pmThread.latestTurn?.turnId);
      assert.strictEqual(message.streaming, false);
      assert.strictEqual(pmThread.latestTurn?.state, "completed");
    }).pipe(Effect.provide(makeLayer(commands, readModelRef)), Effect.scoped);
  });

  it.effect("projects pi tool calls onto PM thread activities", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
        incarnationNonce: "test-nonce",
      });

      yield* runtime.project({
        type: "tool_call",
        toolCallId: "tool-call-1",
        toolName: "handoffWorker",
        input: { taskId: "task-1" },
      } satisfies AgentHarnessEvent);
      yield* runtime.project({
        type: "tool_result",
        toolCallId: "tool-call-1",
        toolName: "handoffWorker",
        input: { taskId: "task-1" },
        content: [{ type: "text", text: "Started worker." }],
        details: { stageThreadId: "stage-1" },
        isError: false,
      } satisfies AgentHarnessEvent);

      assert.deepStrictEqual(
        commands.map((command) => command.type),
        ["thread.create", "thread.session.set", "thread.activity.append", "thread.activity.append"],
      );

      const activityCommands = commands.filter(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append",
      );
      assert.strictEqual(activityCommands[0]?.activity.kind, "tool.started");
      assert.strictEqual(activityCommands[0]?.activity.tone, "tool");
      assert.strictEqual(activityCommands[1]?.activity.kind, "tool.completed");
      assert.strictEqual(activityCommands[1]?.activity.tone, "tool");
      assert.deepStrictEqual(activityCommands[1]?.activity.payload, {
        itemType: "dynamic_tool_call",
        toolCallId: "tool-call-1",
        toolName: "handoffWorker",
        title: "handoffWorker",
        status: "completed",
        input: { taskId: "task-1" },
        details: { stageThreadId: "stage-1" },
      });
    }).pipe(Effect.provide(makeLayer(commands)), Effect.scoped);
  });
});
