import {
  ProjectId,
  ProviderInstanceId,
  MessageId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationTask,
  type OrchestrationThread,
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
const laterStageThreadId = ThreadId.make("stage-thread-2");

const makeThread = (
  id: ThreadId = stageThreadId,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread => ({
  id,
  projectId,
  title: `Stage ${id}`,
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
  },
  runtimeMode: "approval-required",
  interactionMode: "default",
  branch: "orchestrator/task-1",
  worktreePath: "/repo/.worktrees/task-1",
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
  ...overrides,
});

const makeTask = (overrides: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id: taskId,
  projectId,
  type: TaskTypeId.make("feature"),
  title: "Build the thing",
  status: "planning" as const,
  branch: "orchestrator/task-1",
  worktreePath: "/repo/.worktrees/task-1",
  prUrl: null,
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
  ...overrides,
});

const makeReadModel = (
  tasks = [makeTask()],
  threads: ReadonlyArray<OrchestrationThread> = tasks.flatMap((task) =>
    task.stageThreadIds.map((threadId) => makeThread(threadId)),
  ),
) => ({
  ...createEmptyReadModel(now),
  threads,
  tasks,
});

const makeLayer = (
  dispatched: OrchestrationCommand[],
  readModel: ReturnType<typeof makeReadModel> = makeReadModel(),
) =>
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
      getCommandReadModel: () => Effect.succeed(readModel),
      getSnapshot: () => Effect.succeed(readModel),
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

it.effect("steerStage dispatches thread.turn.start to an explicit stage thread", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel(
            [
              makeTask({
                stageThreadIds: [stageThreadId, laterStageThreadId],
                currentStageThreadId: laterStageThreadId,
              }),
            ],
            [
              makeThread(stageThreadId, {
                runtimeMode: "approval-required",
                interactionMode: "default",
              }),
              makeThread(laterStageThreadId, {
                runtimeMode: "full-access",
                interactionMode: "plan",
              }),
            ],
          ),
        ),
      ),
    );
    const steerStage = findTool(tools, "steerStage");

    const result = yield* Effect.promise(() =>
      steerStage.execute("tool-steer-explicit", {
        taskId,
        stageThreadId,
        message: "Please keep the change scoped.",
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "thread.turn.start");
    if (dispatched[0]?.type === "thread.turn.start") {
      assert.strictEqual(dispatched[0].threadId, stageThreadId);
      assert.deepStrictEqual(dispatched[0].message, {
        messageId: MessageId.make("pm-tool:tool-steer-explicit"),
        role: "user",
        text: "Please keep the change scoped.",
        attachments: [],
      });
      assert.ok(!("modelSelection" in dispatched[0]));
      assert.strictEqual(dispatched[0].runtimeMode, "approval-required");
      assert.strictEqual(dispatched[0].interactionMode, "default");
    }
    assert.deepStrictEqual(result.details, {
      taskId,
      stageThreadId,
      sequence: 1,
    });
    const firstContent = result.content[0];
    assert.strictEqual(firstContent?.type, "text");
    if (firstContent?.type === "text") {
      assert.match(firstContent.text, /provider behavior matches the human chat path/);
    }
  }),
);

it.effect("steerStage defaults to the latest stage thread", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel(
            [
              makeTask({
                stageThreadIds: [stageThreadId, laterStageThreadId],
                currentStageThreadId: laterStageThreadId,
              }),
            ],
            [
              makeThread(stageThreadId, {
                runtimeMode: "approval-required",
                interactionMode: "default",
              }),
              makeThread(laterStageThreadId, {
                runtimeMode: "full-access",
                interactionMode: "plan",
              }),
            ],
          ),
        ),
      ),
    );
    const steerStage = findTool(tools, "steerStage");

    const result = yield* Effect.promise(() =>
      steerStage.execute("tool-steer-default", {
        taskId,
        message: "Use the latest stage thread.",
      }),
    );

    assert.strictEqual(dispatched[0]?.type, "thread.turn.start");
    if (dispatched[0]?.type === "thread.turn.start") {
      assert.strictEqual(dispatched[0].threadId, laterStageThreadId);
      assert.strictEqual(dispatched[0].runtimeMode, "full-access");
      assert.strictEqual(dispatched[0].interactionMode, "plan");
    }
    assert.deepStrictEqual(result.details, {
      taskId,
      stageThreadId: laterStageThreadId,
      sequence: 1,
    });
  }),
);

it.effect("steerStage rejects a missing task", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, makeReadModel([]))));
    const steerStage = findTool(tools, "steerStage");

    const error = yield* Effect.promise(() =>
      steerStage
        .execute("tool-steer-missing-task", {
          taskId,
          message: "Can you adjust this?",
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /Task 'task-1' was not found/);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("steerStage rejects a stage thread missing from the command read model", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(makeLayer(dispatched, makeReadModel([makeTask()], []))),
    );
    const steerStage = findTool(tools, "steerStage");

    const error = yield* Effect.promise(() =>
      steerStage
        .execute("tool-steer-missing-thread", {
          taskId,
          stageThreadId,
          message: "Can you adjust this?",
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /Stage thread 'stage-thread-1' was not found/);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("steerStage rejects a stage thread outside the task", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const steerStage = findTool(tools, "steerStage");

    const error = yield* Effect.promise(() =>
      steerStage
        .execute("tool-steer-wrong-thread", {
          taskId,
          stageThreadId: "other-stage-thread",
          message: "Can you adjust this?",
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /does not belong to task 'task-1'/);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("steerStage rejects a task with no stage thread yet", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel([makeTask({ stageThreadIds: [], currentStageThreadId: null })]),
        ),
      ),
    );
    const steerStage = findTool(tools, "steerStage");

    const error = yield* Effect.promise(() =>
      steerStage
        .execute("tool-steer-no-stage", {
          taskId,
          message: "Can you adjust this?",
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /has no stage thread to steer yet/);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("cancelTask dispatches a task.abandon command", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const cancelTask = findTool(tools, "cancelTask");

    const result = yield* Effect.promise(() =>
      cancelTask.execute("tool-cancel", {
        taskId,
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.abandon");
    if (dispatched[0]?.type === "task.abandon") {
      assert.strictEqual(dispatched[0].taskId, taskId);
    }
    assert.deepStrictEqual(result.details, { taskId, sequence: 1 });
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
