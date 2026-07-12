import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  MessageId,
  OrchestrationCancelTaskError,
  OrchestrationDispatchCommandError,
  TaskId,
  TaskTypeId,
  TerminalSessionLookupError,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationMessage,
  type OrchestrationReadModel,
  type ProviderSession,
  type OrchestrationTask,
  type OrchestrationThreadActivity,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { createEmptyReadModel } from "../projector.ts";
import { makePmTools, type PmToolExecutor } from "./pmTools.ts";

const now = "2026-06-14T00:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const stageThreadId = ThreadId.make("stage-thread-1");
const laterStageThreadId = ThreadId.make("stage-thread-2");
const turnId = TurnId.make("turn-1");

const makeMessage = (
  index: number,
  overrides: Partial<OrchestrationMessage> = {},
): OrchestrationMessage => ({
  id: MessageId.make(`message-${index}`),
  role: index % 2 === 0 ? "assistant" : "user",
  text: `Message ${index}`,
  attachments: [],
  turnId,
  streaming: false,
  createdAt: `2026-06-14T00:00:${String(index).padStart(2, "0")}.000Z`,
  updatedAt: `2026-06-14T00:00:${String(index).padStart(2, "0")}.000Z`,
  ...overrides,
});

const makeActivity = (
  index: number,
  overrides: Partial<OrchestrationThreadActivity> = {},
): OrchestrationThreadActivity => ({
  id: EventId.make(`event-${index}`),
  tone: "info",
  kind: `activity.${index}`,
  summary: `Activity ${index}`,
  payload: { ignored: true },
  turnId,
  sequence: index,
  createdAt: `2026-06-14T00:01:${String(index).padStart(2, "0")}.000Z`,
  ...overrides,
});

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
  pendingPmHandoff: null,
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
  cancellation: null,
  landing: null,
  roleModelSelections: {
    plan: {
      instanceId: ProviderInstanceId.make("codex_plan"),
      model: "gpt-5-plan",
    },
  },
  playbookVersion: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
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

const withStageHistory = (
  readModel: ReturnType<typeof makeReadModel>,
  threadId: ThreadId,
  role: "classify" | "plan" | "review" | "work" | "verify",
): OrchestrationReadModel => ({
  ...readModel,
  stageHistory: {
    ...readModel.stageHistory,
    [threadId]: {
      projectId,
      taskId,
      stageThreadId: threadId,
      role,
      providerInstanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
      status: "running",
      startedAt: now,
      endedAt: null,
    },
  },
});

const makeLayer = (
  dispatched: OrchestrationCommand[],
  readModel: OrchestrationReadModel = makeReadModel(),
  threadDetails: ReadonlyMap<ThreadId, OrchestrationThread> | null = null,
  overrides: {
    readonly providerService?: Partial<ProviderServiceShape>;
    readonly terminalManager?: Partial<TerminalManagerShape>;
    readonly afterCancellationRequest?: OrchestrationReadModel;
    readonly failDispatchFor?: ReadonlySet<OrchestrationCommand["type"]>;
  } = {},
) => {
  let currentReadModel = readModel;
  return Layer.mergeAll(
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          if (overrides.failDispatchFor?.has(command.type) === true) {
            throw new OrchestrationDispatchCommandError({
              message: `Dispatch failed for ${command.type}`,
            });
          }
          if (command.type === "task.cancellation.request") {
            currentReadModel = overrides.afterCancellationRequest ?? {
              ...currentReadModel,
              snapshotSequence: dispatched.length,
              tasks: currentReadModel.tasks.map((task) =>
                task.id === command.taskId
                  ? {
                      ...task,
                      cancellation: {
                        requestedAt: command.createdAt,
                        failurePhase: null,
                        failureMessage: null,
                        failedAt: null,
                        completedPhases: [],
                      },
                    }
                  : task,
              ),
            };
          } else if (command.type === "task.cancellation.phase.complete") {
            currentReadModel = {
              ...currentReadModel,
              snapshotSequence: dispatched.length,
              tasks: currentReadModel.tasks.map((task) =>
                task.id === command.taskId && task.cancellation != null
                  ? {
                      ...task,
                      cancellation: {
                        ...task.cancellation,
                        completedPhases: [
                          ...(task.cancellation.completedPhases ?? []),
                          command.phase,
                        ],
                      },
                    }
                  : task,
              ),
            };
          } else if (command.type === "task.cancellation.fail") {
            currentReadModel = {
              ...currentReadModel,
              snapshotSequence: dispatched.length,
              tasks: currentReadModel.tasks.map((task) =>
                task.id === command.taskId && task.cancellation != null
                  ? {
                      ...task,
                      cancellation: {
                        ...task.cancellation,
                        failurePhase: command.phase,
                        failureMessage: command.message,
                        failedAt: command.createdAt,
                      },
                    }
                  : task,
              ),
            };
          } else if (command.type === "task.abandon") {
            currentReadModel = {
              ...currentReadModel,
              snapshotSequence: dispatched.length,
              tasks: currentReadModel.tasks.map((task) =>
                task.id === command.taskId ? { ...task, status: "abandoned" as const } : task,
              ),
            };
          } else if (command.type === "task.land") {
            currentReadModel = {
              ...currentReadModel,
              snapshotSequence: dispatched.length,
              tasks: currentReadModel.tasks.map((task) =>
                task.id === command.taskId ? { ...task, status: "landed" as const } : task,
              ),
            };
          }
          return { sequence: dispatched.length };
        }),
      streamDomainEvents: Stream.empty,
      streamShellEvents: Stream.empty,
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getCommandReadModel: () => Effect.succeed(currentReadModel),
      getSnapshot: () => Effect.succeed(currentReadModel),
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
      getThreadDetailById: (threadId) => {
        const thread = (
          threadDetails ?? new Map(currentReadModel.threads.map((entry) => [entry.id, entry]))
        ).get(threadId);
        return Effect.succeed(thread === undefined ? Option.none() : Option.some(thread));
      },
    }),
    Layer.mock(ProviderService)({
      startSession: () => Effect.die("ProviderService.startSession should not be called"),
      sendTurn: () => Effect.die("ProviderService.sendTurn should not be called"),
      interruptTurn: () => Effect.void,
      respondToRequest: () => Effect.die("ProviderService.respondToRequest should not be called"),
      respondToUserInput: () =>
        Effect.die("ProviderService.respondToUserInput should not be called"),
      stopSession: () => Effect.void,
      listSessions: () => Effect.succeed([] as ReadonlyArray<ProviderSession>),
      getCapabilities: () => Effect.die("ProviderService.getCapabilities should not be called"),
      getInstanceInfo: () => Effect.die("ProviderService.getInstanceInfo should not be called"),
      rollbackConversation: () =>
        Effect.die("ProviderService.rollbackConversation should not be called"),
      streamEvents: Stream.empty,
      ...overrides.providerService,
    }),
    Layer.mock(TerminalManager)({
      open: () => Effect.die("TerminalManager.open should not be called"),
      write: () => Effect.die("TerminalManager.write should not be called"),
      resize: () => Effect.die("TerminalManager.resize should not be called"),
      clear: () => Effect.die("TerminalManager.clear should not be called"),
      restart: () => Effect.die("TerminalManager.restart should not be called"),
      close: () => Effect.void,
      subscribe: () => Effect.succeed(() => undefined),
      ...overrides.terminalManager,
    }),
    NodeServices.layer,
  );
};

const findTool = (tools: ReadonlyArray<PmToolExecutor>, name: string): PmToolExecutor<any, any> => {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool);
  return tool;
};

it.effect("createTask derives stable task and command identities from its idempotency key", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const createTask = findTool(tools, "createTask");
    const params = {
      projectId: "project-1",
      title: "Implement stable creation",
      idempotencyKey: "request-42:task-1",
      taskType: "feature",
    };

    const first = yield* Effect.promise(() => createTask.execute("tool-create-1", params));
    const second = yield* Effect.promise(() =>
      createTask.execute("tool-create-2", {
        ...params,
        title: `  ${params.title}  `,
        idempotencyKey: ` ${params.idempotencyKey} `,
      }),
    );
    const changed = yield* Effect.promise(() =>
      createTask.execute("tool-create-3", { ...params, title: "Conflicting retry" }),
    );

    const [firstCommand, secondCommand, changedCommand] = dispatched;
    assert.strictEqual(firstCommand?.type, "task.create");
    assert.strictEqual(secondCommand?.type, "task.create");
    assert.strictEqual(changedCommand?.type, "task.create");
    if (
      firstCommand?.type === "task.create" &&
      secondCommand?.type === "task.create" &&
      changedCommand?.type === "task.create"
    ) {
      assert.strictEqual(firstCommand.taskId, secondCommand.taskId);
      assert.strictEqual(firstCommand.commandId, secondCommand.commandId);
      assert.strictEqual(firstCommand.pmMessageId, secondCommand.pmMessageId);
      assert.strictEqual(firstCommand.taskId, changedCommand.taskId);
      assert.notStrictEqual(firstCommand.commandId, changedCommand.commandId);
    }
    assert.strictEqual(first.details.taskId, second.details.taskId);
    assert.strictEqual(first.details.taskId, changed.details.taskId);
    assert.match(first.content[0]?.text ?? "", /Created or reused task/);
  }),
);

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

it.effect("inspectStage returns the task row with a note when no stage thread exists yet", () =>
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
    const inspectStage = findTool(tools, "inspectStage");

    const result = yield* Effect.promise(() =>
      inspectStage.execute("tool-inspect-no-stage", {
        taskId,
      }),
    );

    assert.strictEqual(result.details.task?.id, taskId);
    assert.strictEqual(result.details.stageDigest, null);
    assert.match(result.details.note, /has no stage thread yet/);
    const firstContent = result.content[0];
    assert.strictEqual(firstContent?.type, "text");
    if (firstContent?.type === "text") {
      assert.match(firstContent.text, /no stage thread yet/);
    }
  }),
);

it.effect("inspectStage defaults to the latest stage thread and returns bounded tails", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const earlyThread = makeThread(stageThreadId, {
      messages: [makeMessage(1)],
      activities: [makeActivity(1)],
    });
    const laterThread = makeThread(laterStageThreadId, {
      messages: Array.from({ length: 12 }, (_, index) => makeMessage(index + 1)),
      activities: Array.from({ length: 25 }, (_, index) => makeActivity(index + 1)),
    });
    const readModel = withStageHistory(
      makeReadModel(
        [
          makeTask({
            stageThreadIds: [stageThreadId, laterStageThreadId],
            currentStageThreadId: laterStageThreadId,
          }),
        ],
        [earlyThread, laterThread],
      ),
      laterStageThreadId,
      "work",
    );
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));
    const inspectStage = findTool(tools, "inspectStage");

    const result = yield* Effect.promise(() =>
      inspectStage.execute("tool-inspect-default", {
        taskId,
      }),
    );

    assert.strictEqual(result.details.stageDigest.stageThreadId, laterStageThreadId);
    assert.strictEqual(result.details.stageDigest.stageRole, "work");
    assert.strictEqual(result.details.stageDigest.messageCount, 12);
    assert.strictEqual(result.details.stageDigest.messages.length, 10);
    assert.strictEqual(result.details.stageDigest.messages[0]?.text, "Message 3");
    assert.strictEqual(result.details.stageDigest.activityCount, 25);
    assert.strictEqual(result.details.stageDigest.activities.length, 20);
    assert.strictEqual(result.details.stageDigest.activities[0]?.kind, "activity.6");
    const firstContent = result.content[0];
    assert.strictEqual(firstContent?.type, "text");
    if (firstContent?.type === "text") {
      assert.match(firstContent.text, /work stage-thread-2/);
      assert.match(firstContent.text, /messages 10\/12/);
      assert.match(firstContent.text, /activities 20\/25/);
    }
  }),
);

it.effect("inspectStage accepts an explicit owned stage thread", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const readModel = makeReadModel(
      [
        makeTask({
          stageThreadIds: [stageThreadId, laterStageThreadId],
          currentStageThreadId: laterStageThreadId,
        }),
      ],
      [makeThread(stageThreadId), makeThread(laterStageThreadId)],
    );
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));
    const inspectStage = findTool(tools, "inspectStage");

    const result = yield* Effect.promise(() =>
      inspectStage.execute("tool-inspect-explicit", {
        taskId,
        stageThreadId,
      }),
    );

    assert.strictEqual(result.details.stageDigest.stageThreadId, stageThreadId);
  }),
);

it.effect("inspectStage rejects a stage thread outside the task", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const inspectStage = findTool(tools, "inspectStage");

    const error = yield* Effect.promise(() =>
      inspectStage
        .execute("tool-inspect-wrong-thread", {
          taskId,
          stageThreadId: "other-stage-thread",
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /does not belong to task 'task-1'/);
  }),
);

it.effect("inspectStage truncates long message text", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel([
            makeTask({
              stageThreadIds: [stageThreadId],
              currentStageThreadId: stageThreadId,
            }),
          ]),
          new Map([
            [
              stageThreadId,
              makeThread(stageThreadId, {
                messages: [makeMessage(1, { text: "x".repeat(501) })],
              }),
            ],
          ]),
        ),
      ),
    );
    const inspectStage = findTool(tools, "inspectStage");

    const result = yield* Effect.promise(() =>
      inspectStage.execute("tool-inspect-truncate", {
        taskId,
      }),
    );

    assert.strictEqual(result.details.stageDigest.messages[0]?.text.length, 500);
    assert.strictEqual(result.details.stageDigest.messages[0]?.truncated, true);
  }),
);

it.effect("inspectStage computes running turn elapsed with the Effect clock", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(
      DateTime.toEpochMillis(DateTime.makeUnsafe("2026-06-14T00:02:30.000Z")),
    );
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel([
            makeTask({
              stageThreadIds: [stageThreadId],
              currentStageThreadId: stageThreadId,
            }),
          ]),
          new Map([
            [
              stageThreadId,
              makeThread(stageThreadId, {
                latestTurn: {
                  turnId,
                  state: "running",
                  requestedAt: "2026-06-14T00:00:00.000Z",
                  startedAt: "2026-06-14T00:01:00.000Z",
                  completedAt: null,
                  assistantMessageId: null,
                },
              }),
            ],
          ]),
        ),
      ),
    );
    const inspectStage = findTool(tools, "inspectStage");

    const result = yield* Effect.promise(() =>
      inspectStage.execute("tool-inspect-elapsed", {
        taskId,
      }),
    );

    assert.strictEqual(result.details.stageDigest.turn?.state, "running");
    assert.strictEqual(result.details.stageDigest.turn?.elapsedSeconds, 90);
  }).pipe(Effect.provide(TestClock.layer())),
);

it.effect("inspectStage returns token usage from the latest context-window activity", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel([
            makeTask({
              stageThreadIds: [stageThreadId],
              currentStageThreadId: stageThreadId,
            }),
          ]),
          new Map([
            [
              stageThreadId,
              makeThread(stageThreadId, {
                activities: [
                  makeActivity(1, {
                    kind: "context-window.updated",
                    payload: { usedTokens: 5, maxTokens: 100 },
                  }),
                  makeActivity(2),
                  makeActivity(3, {
                    kind: "context-window.updated",
                    payload: { usedTokens: 42, maxTokens: 100 },
                  }),
                  makeActivity(4),
                ],
              }),
            ],
          ]),
        ),
      ),
    );
    const inspectStage = findTool(tools, "inspectStage");

    const result = yield* Effect.promise(() =>
      inspectStage.execute("tool-inspect-token-usage", {
        taskId,
      }),
    );

    assert.deepStrictEqual(result.details.stageDigest.tokenUsage, {
      usedTokens: 42,
      maxTokens: 100,
    });
    const firstContent = result.content[0];
    assert.strictEqual(firstContent?.type, "text");
    if (firstContent?.type === "text") {
      assert.match(firstContent.text, /42\/100 tokens used/);
    }
  }),
);

it.effect("inspectStage rejects when the selected stage thread detail row is missing", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(makeLayer(dispatched, makeReadModel(), new Map())),
    );
    const inspectStage = findTool(tools, "inspectStage");

    const error = yield* Effect.promise(() =>
      inspectStage
        .execute("tool-inspect-missing-thread", {
          taskId,
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /Stage thread 'stage-thread-1' was not found/);
  }),
);

it.effect("cancelTask reserves cancellation before dispatching task.abandon", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const cancelTask = findTool(tools, "cancelTask");

    const result = yield* Effect.promise(() =>
      cancelTask.execute("tool-cancel", {
        taskId,
      }),
    );

    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.request",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.abandon",
      ],
    );
    assert.deepStrictEqual(
      dispatched
        .filter((command) => command.type === "task.cancellation.phase.complete")
        .map((command) => command.phase),
      ["interrupt-turn", "stop-session", "close-terminals"],
    );
    if (dispatched[1]?.type === "task.abandon") {
      assert.strictEqual(dispatched[1].taskId, taskId);
    }
    assert.deepStrictEqual(result.details, { taskId, sequence: 5 });
  }),
);

it.effect("cancelTask stops an active stage turn, session, and terminals before abandon", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: string[] = [];
    const readModel = makeReadModel(undefined, [
      makeThread(stageThreadId, {
        latestTurn: {
          turnId,
          state: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ]);
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, readModel, null, {
          providerService: {
            interruptTurn: (input) =>
              Effect.sync(() => {
                calls.push(`interrupt:${input.threadId}:${input.turnId}`);
              }),
            stopSession: (input) =>
              Effect.sync(() => {
                calls.push(`stop:${input.threadId}`);
              }),
          },
          terminalManager: {
            close: (input) =>
              Effect.sync(() => {
                calls.push(`close:${input.threadId}:${String(input.deleteHistory)}`);
              }),
          },
        }),
      ),
    );
    const cancelTask = findTool(tools, "cancelTask");

    yield* Effect.promise(() =>
      cancelTask.execute("tool-cancel-active", {
        taskId,
      }),
    );

    assert.deepStrictEqual(calls, [
      `interrupt:${stageThreadId}:${turnId}`,
      `stop:${stageThreadId}`,
      `close:${stageThreadId}:true`,
    ]);
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.request",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.abandon",
      ],
    );
  }),
);

it.effect("cancelTask refreshes after reservation and shuts down a newly-started stage", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: string[] = [];
    const initialReadModel = makeReadModel([
      makeTask({ stageThreadIds: [], currentStageThreadId: null }),
    ]);
    const postReservationReadModel = makeReadModel(
      [
        makeTask({
          stageThreadIds: [laterStageThreadId],
          currentStageThreadId: laterStageThreadId,
          cancellation: {
            requestedAt: now,
            failurePhase: null,
            failureMessage: null,
            failedAt: null,
            completedPhases: [],
          },
        }),
      ],
      [
        makeThread(laterStageThreadId, {
          latestTurn: {
            turnId,
            state: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      ],
    );
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, initialReadModel, null, {
          afterCancellationRequest: postReservationReadModel,
          providerService: {
            interruptTurn: ({ threadId }) => Effect.sync(() => calls.push(`interrupt:${threadId}`)),
            stopSession: ({ threadId }) => Effect.sync(() => calls.push(`stop:${threadId}`)),
          },
          terminalManager: {
            close: ({ threadId }) => Effect.sync(() => calls.push(`close:${threadId}`)),
          },
        }),
      ),
    );

    yield* Effect.promise(() =>
      findTool(tools, "cancelTask").execute("tool-cancel-racing-stage", { taskId }),
    );

    assert.deepStrictEqual(calls, [
      `interrupt:${laterStageThreadId}`,
      `stop:${laterStageThreadId}`,
      `close:${laterStageThreadId}`,
    ]);
  }),
);

it.effect("concurrent cancelTask calls shut the worker down only once", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: string[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel(), null, {
          providerService: { stopSession: () => Effect.sync(() => calls.push("stop")) },
          terminalManager: { close: () => Effect.sync(() => calls.push("close")) },
        }),
      ),
    );
    const cancelTask = findTool(tools, "cancelTask");

    const results = yield* Effect.promise(() =>
      Promise.all([
        cancelTask.execute("tool-cancel-concurrent-1", { taskId }),
        cancelTask.execute("tool-cancel-concurrent-2", { taskId }),
      ]),
    );

    assert.deepStrictEqual(calls, ["stop", "close"]);
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.request",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.abandon",
      ],
    );
    assert.deepStrictEqual(
      results.map((result) => result.details.sequence),
      [5, 5],
    );
  }),
);

it.effect("cancelTask is side-effect free for a landed task with an active stage thread", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: string[] = [];
    const readModel = makeReadModel(
      [makeTask({ status: "landed", currentStageThreadId: stageThreadId })],
      [
        makeThread(stageThreadId, {
          latestTurn: {
            turnId,
            state: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      ],
    );
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, readModel, null, {
          providerService: {
            interruptTurn: () => Effect.sync(() => calls.push("interrupt")),
            stopSession: () => Effect.sync(() => calls.push("stop")),
          },
          terminalManager: {
            close: () => Effect.sync(() => calls.push("close")),
          },
        }),
      ),
    );
    const cancelTask = findTool(tools, "cancelTask");

    const result = yield* Effect.promise(() =>
      cancelTask.execute("tool-cancel-landed", {
        taskId,
      }),
    );

    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(dispatched, []);
    assert.deepStrictEqual(result.details, { taskId, sequence: 0 });
  }),
);

it.effect("cancelTask remains idempotent for an abandoned task", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: string[] = [];
    const readModel = makeReadModel([makeTask({ status: "abandoned" })]);
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, readModel, null, {
          providerService: {
            interruptTurn: () => Effect.sync(() => calls.push("interrupt")),
            stopSession: () => Effect.sync(() => calls.push("stop")),
          },
          terminalManager: {
            close: () => Effect.sync(() => calls.push("close")),
          },
        }),
      ),
    );
    const cancelTask = findTool(tools, "cancelTask");

    const result = yield* Effect.promise(() =>
      cancelTask.execute("tool-cancel-abandoned", {
        taskId,
      }),
    );

    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(dispatched, []);
    assert.deepStrictEqual(result.details, { taskId, sequence: 0 });
  }),
);

it.effect("cancelTask does not abandon when terminal shutdown fails", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel(), null, {
          terminalManager: {
            close: () =>
              Effect.fail(
                new TerminalSessionLookupError({
                  threadId: stageThreadId,
                  terminalId: "default",
                }),
              ),
          },
        }),
      ),
    );
    const cancelTask = findTool(tools, "cancelTask");

    const error = yield* Effect.promise(() =>
      cancelTask
        .execute("tool-cancel-failing-terminal", {
          taskId,
        })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, OrchestrationCancelTaskError);
    assert.strictEqual((error as OrchestrationCancelTaskError).phase, "close-terminals");
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.request",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.fail",
      ],
    );
  }),
);

it.effect("cancelTask retries an existing durable reservation without reserving twice", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: string[] = [];
    const readModel = makeReadModel([
      makeTask({
        cancellation: {
          requestedAt: now,
          failurePhase: "close-terminals",
          failureMessage: "previous close failed",
          failedAt: now,
          completedPhases: [],
        },
      }),
    ]);
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, readModel, null, {
          providerService: {
            stopSession: () => Effect.sync(() => calls.push("stop")),
          },
          terminalManager: {
            close: () => Effect.sync(() => calls.push("close")),
          },
        }),
      ),
    );

    const result = yield* Effect.promise(() =>
      findTool(tools, "cancelTask").execute("tool-cancel-retry", { taskId }),
    );

    assert.deepStrictEqual(calls, ["stop", "close"]);
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.abandon",
      ],
    );
    assert.deepStrictEqual(result.details, { taskId, sequence: 4 });
  }),
);

it.effect("cancelTask records a final abandon dispatch failure", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel(), null, {
          failDispatchFor: new Set(["task.abandon"]),
        }),
      ),
    );

    const error = yield* Effect.promise(() =>
      findTool(tools, "cancelTask")
        .execute("tool-cancel-abandon-failure", { taskId })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, OrchestrationCancelTaskError);
    assert.strictEqual((error as OrchestrationCancelTaskError).phase, "abandon");
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.request",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.abandon",
        "task.cancellation.fail",
      ],
    );
  }),
);

it.effect("cancellation failure persistence does not mask the shutdown error", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel(), null, {
          failDispatchFor: new Set(["task.cancellation.fail"]),
          terminalManager: {
            close: () =>
              Effect.fail(
                new TerminalSessionLookupError({
                  threadId: stageThreadId,
                  terminalId: "default",
                }),
              ),
          },
        }),
      ),
    );

    const error = yield* Effect.promise(() =>
      findTool(tools, "cancelTask")
        .execute("tool-cancel-unpersisted-failure", { taskId })
        .then(
          () => null,
          (cause) => cause,
        ),
    );

    assert.instanceOf(error, OrchestrationCancelTaskError);
    assert.strictEqual((error as OrchestrationCancelTaskError).phase, "close-terminals");
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      [
        "task.cancellation.request",
        "task.cancellation.phase.complete",
        "task.cancellation.phase.complete",
        "task.cancellation.fail",
      ],
    );
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

it.effect("landTask delegates one task.land command to the guarded landing executor", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const readModel = makeReadModel([makeTask({ status: "review", currentStageThreadId: null })]);
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));

    const result = yield* Effect.promise(() =>
      findTool(tools, "landTask").execute("tool-land", { taskId }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.land");
    assert.deepStrictEqual(result.details, {
      taskId,
      sequence: 1,
      alreadyLanded: false,
      alreadyInProgress: false,
    });
    assert.match(result.content[0]?.text ?? "", /Started landing task/);
  }),
);

it.effect("landTask is idempotent after the task is already landed", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const readModel = makeReadModel([
      makeTask({
        status: "landed",
        currentStageThreadId: null,
        prUrl: "https://github.com/acme/repo/pull/42",
        landing: {
          status: "completed",
          failureMessage: null,
          branchPushed: true,
          updatedAt: now,
        },
      }),
    ]);
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));

    const result = yield* Effect.promise(() =>
      findTool(tools, "landTask").execute("tool-land-again", { taskId }),
    );

    assert.deepStrictEqual(dispatched, []);
    assert.deepStrictEqual(result.details, {
      taskId,
      sequence: 0,
      alreadyLanded: true,
      alreadyInProgress: false,
    });
    assert.match(result.content[0]?.text ?? "", /already landed/);
  }),
);

it.effect("landTask retries an exhausted durable landing failure", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const readModel = makeReadModel([
      makeTask({
        status: "landed",
        currentStageThreadId: null,
        landing: {
          status: "failed",
          failureMessage: "provider unavailable",
          branchPushed: false,
          updatedAt: now,
        },
      }),
    ]);
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));

    const result = yield* Effect.promise(() =>
      findTool(tools, "landTask").execute("tool-land-retry", { taskId }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.landing.retry");
    assert.deepStrictEqual(result.details, {
      taskId,
      sequence: 1,
      alreadyLanded: false,
      alreadyInProgress: false,
    });
    assert.match(result.content[0]?.text ?? "", /Started landing task/);
  }),
);

it.effect("task retention tools dispatch archive, restore, and delete commands", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));

    for (const [toolName, commandType] of [
      ["archiveTask", "task.archive"],
      ["restoreTask", "task.restore"],
      ["deleteTask", "task.delete"],
    ] as const) {
      const result = yield* Effect.promise(() =>
        findTool(tools, toolName).execute(`tool-${toolName}`, { taskId }),
      );
      assert.strictEqual(dispatched.at(-1)?.type, commandType);
      assert.strictEqual(result.details.taskId, taskId);
      assert.strictEqual(result.details.sequence, dispatched.length);
    }
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

it.effect("getTaskLedger omits archived and permanently deleted tasks", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const active = makeTask({ id: TaskId.make("task-active") });
    const archived = makeTask({ id: TaskId.make("task-archived"), archivedAt: now });
    const deleted = makeTask({ id: TaskId.make("task-deleted"), deletedAt: now });
    const tools = yield* makePmTools.pipe(
      Effect.provide(makeLayer(dispatched, makeReadModel([active, archived, deleted], []))),
    );
    const getTaskLedger = findTool(tools, "getTaskLedger");

    const result = yield* Effect.promise(() =>
      getTaskLedger.execute("tool-task-ledger", { projectId }),
    );

    assert.deepStrictEqual(
      result.details.tasks.map((task: OrchestrationTask) => task.id),
      [TaskId.make("task-active")],
    );
  }),
);
