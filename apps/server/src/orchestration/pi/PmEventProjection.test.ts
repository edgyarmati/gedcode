import type { AgentHarnessEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type OrchestrationCommand,
  type OrchestrationProject,
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

const makeLayer = (commands: OrchestrationCommand[]) =>
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

describe("PmEventProjection", () => {
  it.effect("projects the PM prompt as a user message before agent output", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
      });

      yield* runtime.project({
        type: "before_agent_start",
        prompt: "Please split this into tasks.",
      } as AgentHarnessEvent);

      assert.deepStrictEqual(
        commands.map((command) => command.type),
        ["thread.create", "thread.message.user.append"],
      );

      const userMessageCommand = commands[1];
      assert.strictEqual(userMessageCommand?.type, "thread.message.user.append");
      if (userMessageCommand?.type === "thread.message.user.append") {
        assert.strictEqual(userMessageCommand.threadId, runtime.pmThreadId);
        assert.strictEqual(userMessageCommand.text, "Please split this into tasks.");
      }
    }).pipe(Effect.provide(makeLayer(commands)), Effect.scoped);
  });

  it.effect("projects pi assistant deltas onto the deterministic PM thread", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
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

  it.effect("projects pi tool calls onto PM thread activities", () => {
    const commands: OrchestrationCommand[] = [];
    return Effect.gen(function* () {
      const runtime = yield* makePmEventProjectionRuntime({
        project,
        pmModelSelection,
        events: Stream.empty,
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
        ["thread.create", "thread.activity.append", "thread.activity.append"],
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
