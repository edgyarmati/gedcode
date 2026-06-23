import {
  ProjectId,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { assert, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { createEmptyReadModel } from "../projector.ts";
import { makePmTools } from "./pmTools.ts";

const now = "2026-06-14T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const stageThreadId = ThreadId.make("stage-thread-1");

const makeReadModel = () => ({
  ...createEmptyReadModel(now),
  tasks: [
    {
      id: taskId,
      projectId,
      type: TaskTypeId.make("feature"),
      title: "Build the thing",
      status: "planning" as const,
      branch: "orchestrator/task-1",
      worktreePath: "/repo/.worktrees/task-1",
      pmMessageId: null,
      stageThreadIds: [stageThreadId],
      currentStageThreadId: stageThreadId,
      roleModelSelections: {
        plan: {
          instanceId: ProviderInstanceId.make("codex_plan"),
          model: "gpt-5-plan",
        },
      },
      playbookVersion: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
});

const makeLayer = (dispatched: OrchestrationCommand[]) =>
  Layer.mergeAll(
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          return { sequence: dispatched.length };
        }),
      streamDomainEvents: Stream.empty,
      streamShellEvents: Stream.empty,
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getCommandReadModel: () => Effect.succeed(makeReadModel()),
      getSnapshot: () => Effect.succeed(makeReadModel()),
      getShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 0,
          projects: [],
          threads: [],
          updatedAt: now,
        }),
      getArchivedShellSnapshot: () =>
        Effect.succeed({
          snapshotSequence: 0,
          projects: [],
          threads: [],
          updatedAt: now,
        }),
      getSnapshotSequence: () => Effect.succeed({ snapshotSequence: 0 }),
      getCounts: () => Effect.succeed({ projectCount: 0, threadCount: 0 }),
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
      getProjectShellById: () => Effect.succeed(Option.none()),
      getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
      getThreadCheckpointContext: () => Effect.succeed(Option.none()),
      getFullThreadDiffContext: () => Effect.succeed(Option.none()),
      getThreadShellById: () => Effect.succeed(Option.none()),
      getThreadDetailById: () => Effect.succeed(Option.none()),
    }),
    NodeServices.layer,
  );

const findTool = (tools: ReadonlyArray<AgentTool>, name: string): AgentTool => {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool);
  return tool;
};

it.effect("handoffWorker dispatches a guarded task.stage.start command and returns a handle", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const handoffWorker = findTool(tools, "handoffWorker");

    const result = yield* Effect.promise(() =>
      handoffWorker.execute("tool-1", {
        taskId,
        role: "plan",
        instructions: "Plan the work.",
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.stage.start");
    assert.deepStrictEqual(result.details, {
      taskId,
      sequence: 1,
      stageThreadId,
      awaitedTurnId: null,
    });
  }),
);

it.effect("handoffWorker accepts verify stage handoffs", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const handoffWorker = findTool(tools, "handoffWorker");

    yield* Effect.promise(() =>
      handoffWorker.execute("tool-verify", {
        taskId,
        role: "verify",
        instructions: "Verify the work.",
      }),
    );

    assert.strictEqual(dispatched[0]?.type, "task.stage.start");
    if (dispatched[0]?.type === "task.stage.start") {
      assert.strictEqual(dispatched[0].role, "verify");
    }
  }),
);

it.effect("requestApproval dispatches a task.gate.request command", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const requestApproval = findTool(tools, "requestApproval");

    const result = yield* Effect.promise(() =>
      requestApproval.execute("tool-2", {
        taskId,
        gate: "plan",
        contentHash: "sha256:abc",
        stageThreadId,
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.gate.request");
    assert.strictEqual(result.details.taskId, taskId);
    assert.strictEqual(result.details.sequence, 1);
  }),
);

it.effect("setTaskBackend dispatches a merged pm-runtime task.role-selections.set command", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const setTaskBackend = findTool(tools, "setTaskBackend");

    const result = yield* Effect.promise(() =>
      setTaskBackend.execute("tool-backend", {
        taskId,
        role: "work",
        instanceId: "codex_work",
        model: "gpt-5-work",
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.role-selections.set");
    if (dispatched[0]?.type === "task.role-selections.set") {
      assert.strictEqual(dispatched[0].origin, "pm-runtime");
      assert.deepStrictEqual(dispatched[0].roleModelSelections, {
        plan: {
          instanceId: ProviderInstanceId.make("codex_plan"),
          model: "gpt-5-plan",
        },
        work: {
          instanceId: ProviderInstanceId.make("codex_work"),
          model: "gpt-5-work",
        },
      });
    }
    assert.deepStrictEqual(result.details, {
      taskId,
      role: "work",
      sequence: 1,
    });
  }),
);

it.effect("classifyRequest snapshots the resolved built-in playbook version", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const classifyRequest = findTool(tools, "classifyRequest");
    const resolved = defaultPlaybookLoader.resolve("feature");

    const result = yield* Effect.promise(() =>
      classifyRequest.execute("tool-classify", {
        taskId,
        taskType: "feature",
        playbookVersion: "pm-supplied-version",
      }),
    );

    assert.ok(resolved);
    assert.match(resolved.playbookVersion, /^builtin:[a-f0-9]{12}$/);
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.classify");
    if (dispatched[0]?.type === "task.classify") {
      assert.strictEqual(dispatched[0].taskType, TaskTypeId.make("feature"));
      assert.strictEqual(dispatched[0].playbookVersion, resolved.playbookVersion);
      assert.notStrictEqual(dispatched[0].playbookVersion, "pm-supplied-version");
    }
    assert.deepStrictEqual(result.details, { taskId, sequence: 1 });
  }),
);

it.effect("classifyRequest snapshots null when the task type has no playbook", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const classifyRequest = findTool(tools, "classifyRequest");

    yield* Effect.promise(() =>
      classifyRequest.execute("tool-classify-unknown", {
        taskId,
        taskType: "unknown",
        playbookVersion: "pm-supplied-version",
      }),
    );

    assert.strictEqual(dispatched[0]?.type, "task.classify");
    if (dispatched[0]?.type === "task.classify") {
      assert.strictEqual(dispatched[0].taskType, TaskTypeId.make("unknown"));
      assert.strictEqual(dispatched[0].playbookVersion, null);
    }
  }),
);
