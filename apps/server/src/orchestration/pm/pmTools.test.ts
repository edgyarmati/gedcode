import {
  ApprovalRequestId,
  EventId,
  HelperRunId,
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
import { ChildProcessSpawner } from "effect/unstable/process";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import type { ProjectionPendingApproval } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { createEmptyReadModel } from "../projector.ts";
import { makePmTools, type PmToolExecutor } from "./pmTools.ts";
import { VcsProcess, type VcsProcessOutput, type VcsProcessShape } from "../../vcs/VcsProcess.ts";

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
  changeReview: null,
  verification: null,
  noChangesNeeded: null,
  landing: null,
  roleCapabilityTiers: { plan: "genius" },
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
  projects: [
    {
      id: projectId,
      title: "Project",
      workspaceRoot: "/repo",
      repositoryIdentity: null,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      roleModelSelections: {},
      orchestratorConfig: {},
      scripts: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ],
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
      capabilityTier: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
      modelOptions: null,
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
    readonly pendingApprovals?: ReadonlyArray<ProjectionPendingApproval>;
    readonly vcsProcess?: Partial<VcsProcessShape>;
  } = {},
) => {
  let currentReadModel = readModel;
  return Layer.mergeAll(
    Layer.succeed(ProjectionPendingApprovalRepository, {
      upsert: () => Effect.void,
      listByThreadId: ({ threadId }) =>
        Effect.succeed(
          (overrides.pendingApprovals ?? []).filter((row) => row.threadId === threadId),
        ),
      getByRequestId: ({ requestId }) =>
        Effect.succeed(
          Option.fromUndefinedOr(
            (overrides.pendingApprovals ?? []).find((row) => row.requestId === requestId),
          ),
        ),
      deleteByRequestId: () => Effect.void,
      countPendingByThreadId: ({ threadId }) =>
        Effect.succeed(
          (overrides.pendingApprovals ?? []).filter(
            (row) => row.threadId === threadId && row.status === "pending",
          ).length,
        ),
    }),
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
    Layer.mock(VcsProcess)({
      run: () => Effect.die("VcsProcess.run should not be called"),
      ...overrides.vcsProcess,
    }),
    NodeServices.layer,
  );
};

const findTool = (tools: ReadonlyArray<PmToolExecutor>, name: string): PmToolExecutor<any, any> => {
  const tool = tools.find((entry) => entry.name === name);
  assert.ok(tool);
  return tool;
};

const vcsOutput = (stdout = "", exitCode = 0): VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const changeReviewTask = () =>
  makeTask({
    status: "change-review",
    currentStageThreadId: null,
    changeReview: {
      status: "pending",
      workStageThreadId: stageThreadId,
      detectedHead: "abc123",
      resolution: null,
      requestedAt: now,
      resolvedAt: null,
    },
  });

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
    const replacement = yield* Effect.promise(() =>
      createTask.execute("tool-create-4", { ...params, supersedesTaskId: "task-old" }),
    );

    const [firstCommand, secondCommand, changedCommand, replacementCommand] = dispatched;
    assert.strictEqual(firstCommand?.type, "task.create");
    assert.strictEqual(secondCommand?.type, "task.create");
    assert.strictEqual(changedCommand?.type, "task.create");
    assert.strictEqual(replacementCommand?.type, "task.create");
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
    assert.strictEqual(first.details.taskId, replacement.details.taskId);
    if (replacementCommand?.type === "task.create") {
      assert.strictEqual(replacementCommand.supersedesTaskId, "task-old");
      assert.notStrictEqual(replacementCommand.commandId, firstCommand?.commandId);
    }
    assert.match(first.content[0]?.text ?? "", /Created or reused task/);
  }),
);

it.effect(
  "helper tools preserve identity while exposing conflicting retries and task attachments",
  () =>
    Effect.gen(function* () {
      const helperRunId = HelperRunId.make("helper-existing");
      const readModel: OrchestrationReadModel = {
        ...makeReadModel(),
        helperRuns: [
          {
            id: helperRunId,
            projectId,
            attachment: { kind: "task", taskId },
            accessMode: "read-only",
            tier: "smart",
            providerInstanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
            modelOptions: null,
            prompt: "Inspect the task invariants.",
            status: "running",
            providerThreadId: ThreadId.make("helper:helper-existing"),
            result: null,
            failureMessage: null,
            createdAt: now,
            startedAt: now,
            completedAt: null,
            updatedAt: now,
          },
        ],
      };
      const dispatched: OrchestrationCommand[] = [];
      const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));
      const start = findTool(tools, "startHelperRun");
      const inspect = findTool(tools, "inspectHelperRun");
      const interrupt = findTool(tools, "interruptHelperRun");
      const params = {
        projectId,
        idempotencyKey: "request-42:helper-context",
        prompt: "Map the relevant implementation without changing files.",
      };

      const first = yield* Effect.promise(() => start.execute("helper-start-1", params));
      const second = yield* Effect.promise(() =>
        start.execute("helper-start-2", {
          ...params,
          idempotencyKey: ` ${params.idempotencyKey} `,
        }),
      );
      yield* Effect.promise(() =>
        start.execute("helper-start-changed-prompt", {
          ...params,
          prompt: "Inspect only the task state.",
        }),
      );
      yield* Effect.promise(() =>
        start.execute("helper-start-changed-tier", { ...params, tier: "genius" }),
      );
      const attached = yield* Effect.promise(() =>
        start.execute("helper-start-task", {
          ...params,
          idempotencyKey: "request-42:task-context",
          taskId: ` ${taskId} `,
          tier: "genius",
        }),
      );
      const inspected = yield* Effect.promise(() =>
        inspect.execute("helper-inspect", { projectId, helperRunId }),
      );
      yield* Effect.promise(() =>
        interrupt.execute("helper-interrupt", { projectId, helperRunId }),
      );

      const requests = dispatched.filter(
        (command): command is Extract<OrchestrationCommand, { type: "helper.run.request" }> =>
          command.type === "helper.run.request",
      );
      assert.strictEqual(requests.length, 5);
      assert.strictEqual(requests[0]?.helperRunId, requests[1]?.helperRunId);
      assert.strictEqual(requests[0]?.commandId, requests[1]?.commandId);
      assert.strictEqual(requests[0]?.helperRunId, requests[2]?.helperRunId);
      assert.strictEqual(requests[0]?.helperRunId, requests[3]?.helperRunId);
      assert.notStrictEqual(requests[0]?.commandId, requests[2]?.commandId);
      assert.notStrictEqual(requests[0]?.commandId, requests[3]?.commandId);
      assert.strictEqual(requests[0]?.tier, "cheap");
      assert.deepStrictEqual(requests[0]?.attachment, {
        kind: "pm",
        threadId: ThreadId.make(`pm:${projectId}`),
      });
      assert.deepStrictEqual(requests[4]?.attachment, { kind: "task", taskId });
      assert.strictEqual(requests[4]?.tier, "genius");
      assert.strictEqual(first.details.helperRunId, second.details.helperRunId);
      assert.strictEqual(attached.details.taskId, taskId);
      assert.strictEqual(attached.details.tier, "genius");
      assert.strictEqual(inspected.details.helperRun.id, helperRunId);
      assert.strictEqual(dispatched.at(-1)?.type, "helper.run.interrupt");
    }),
);

it.effect("change-review tools inspect task-owned changes and reject foreign tasks", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel([changeReviewTask()]), null, {
          vcsProcess: {
            run: (input) =>
              Effect.succeed(
                input.operation === "TaskChangeReview.head"
                  ? vcsOutput("abc123\n")
                  : input.operation === "TaskChangeReview.status"
                    ? vcsOutput(" M selected.txt\0?? untracked.txt\0")
                    : input.operation === "TaskChangeReview.diff"
                      ? vcsOutput("diff --git a/selected.txt b/selected.txt\n")
                      : vcsOutput(),
              ),
          },
        }),
      ),
    );
    const inspect = findTool(tools, "inspectTaskChanges");
    const result = yield* Effect.promise(() => inspect.execute("inspect-changes", { taskId }));
    assert.deepStrictEqual(result.details.changes.paths, ["selected.txt", "untracked.txt"]);
    assert.equal(result.details.changes.head, "abc123");

    const error = yield* Effect.promise(async () => {
      try {
        await inspect.execute("inspect-foreign", { taskId: "task-foreign" });
        return null;
      } catch (cause) {
        return cause;
      }
    });
    assert.match(String(error), /not found/);
  }),
);

it.effect("direct PM tools inspect and commit an exact primary-checkout patch without a task", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const calls: Array<{ operation: string; cwd: string; stdin?: string }> = [];
    let committed = false;
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel([]), null, {
          vcsProcess: {
            run: (input) => {
              calls.push({
                operation: input.operation,
                cwd: input.cwd,
                ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
              });
              if (input.operation === "TaskChangeReview.commitSelection") {
                committed = true;
                return Effect.succeed(vcsOutput("[main def456] docs: update label\n"));
              }
              if (input.operation === "TaskChangeReview.head") {
                return Effect.succeed(vcsOutput(committed ? "def456\n" : "abc123\n"));
              }
              if (input.operation === "TaskChangeReview.status") {
                return Effect.succeed(
                  vcsOutput(committed ? " M shared.txt\0" : " M direct.txt\0 M shared.txt\0"),
                );
              }
              if (input.operation === "TaskChangeReview.diff") {
                return Effect.succeed(vcsOutput("diff --git a/direct.txt b/direct.txt\n"));
              }
              return Effect.succeed(vcsOutput());
            },
          },
        }),
      ),
    );
    const inspect = findTool(tools, "inspectDirectChanges");
    const inspected = yield* Effect.promise(() => inspect.execute("inspect-direct", { projectId }));
    assert.equal(inspected.details.projectId, projectId);
    assert.deepStrictEqual(inspected.details.changes.paths, ["direct.txt", "shared.txt"]);

    const patch = [
      "diff --git a/direct.txt b/direct.txt",
      "--- a/direct.txt",
      "+++ b/direct.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const commit = findTool(tools, "commitDirectChanges");
    const result = yield* Effect.promise(() =>
      commit.execute("commit-direct", {
        projectId,
        patch,
        message: "docs: update direct label",
        rationale: "This is one bounded text change with no behavior or contract impact.",
        checks: [{ command: "bun fmt", outcome: "passed" }],
      }),
    );

    assert.equal(result.details.commit, "def456");
    assert.deepStrictEqual(result.details.changes.paths, ["shared.txt"]);
    assert.deepStrictEqual(result.details.checks, [{ command: "bun fmt", outcome: "passed" }]);
    assert.deepStrictEqual(dispatched, []);
    assert.ok(calls.every((call) => call.cwd === "/repo"));
    assert.equal(
      calls.find((call) => call.operation === "TaskChangeReview.stagePatch")?.stdin,
      patch,
    );
  }),
);

it.effect("completeTaskWithoutChanges verifies the branch baseline and clean worktree", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const reviewTask = makeTask({
      status: "review",
      currentStageThreadId: null,
      branch: "orchestrator/task-1",
    });
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel([reviewTask]), null, {
          vcsProcess: {
            run: (input) =>
              Effect.succeed(
                input.operation === "OrchestratorTaskNoChange.head" ||
                  input.operation === "OrchestratorTaskNoChange.base"
                  ? vcsOutput("abc123\n")
                  : vcsOutput(),
              ),
          },
        }),
      ),
    );

    const result = yield* Effect.promise(() =>
      findTool(tools, "completeTaskWithoutChanges").execute("no-change", { taskId }),
    );
    assert.match(result.content[0]?.text ?? "", /Completed and archived/);
    assert.deepStrictEqual(result.details, {
      taskId,
      baseHead: "abc123",
      head: "abc123",
      sequence: 1,
    });
    const command = dispatched.find((entry) => entry.type === "task.no-changes-needed");
    assert.ok(command?.type === "task.no-changes-needed");
    assert.equal(command.taskId, taskId);
    assert.equal(command.baseHead, "abc123");
    assert.equal(command.head, "abc123");
    assert.deepStrictEqual(command.worktreeCompletion, { head: "abc123", dirty: false });
  }),
);

it.effect("commitTaskChanges preserves remaining review changes and refreshes their HEAD", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    let committed = false;
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel([changeReviewTask()]), null, {
          vcsProcess: {
            run: (input) => {
              if (input.operation === "TaskChangeReview.commitSelection") {
                committed = true;
                return Effect.succeed(vcsOutput("[branch def456] fix: selected path\n"));
              }
              if (input.operation === "TaskChangeReview.head") {
                return Effect.succeed(vcsOutput(committed ? "def456\n" : "abc123\n"));
              }
              if (input.operation === "TaskChangeReview.status") {
                return Effect.succeed(
                  vcsOutput(
                    committed ? " M remaining.txt\0" : " M selected.txt\0 M remaining.txt\0",
                  ),
                );
              }
              if (input.operation === "TaskChangeReview.diff") {
                return Effect.succeed(vcsOutput("diff --git a/selected.txt b/selected.txt\n"));
              }
              return Effect.succeed(vcsOutput());
            },
          },
        }),
      ),
    );
    const commit = findTool(tools, "commitTaskChanges");
    const result = yield* Effect.promise(() =>
      commit.execute("commit-changes", {
        taskId,
        paths: ["selected.txt"],
        message: "fix: commit selected path",
      }),
    );

    assert.deepStrictEqual(result.details.changes.paths, ["remaining.txt"]);
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      ["task.change-review.resolve", "task.change-review.request"],
    );
    const refreshed = dispatched[1];
    assert.equal(refreshed?.type, "task.change-review.request");
    if (refreshed?.type === "task.change-review.request") {
      assert.equal(refreshed.detectedHead, "def456");
    }
  }),
);

it.effect("discard and return tools record distinct review outcomes", () =>
  Effect.gen(function* () {
    const discardedCommands: OrchestrationCommand[] = [];
    let discarded = false;
    const discardTools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(discardedCommands, makeReadModel([changeReviewTask()]), null, {
          vcsProcess: {
            run: (input) => {
              if (input.operation === "TaskChangeReview.cleanSelection") discarded = true;
              if (input.operation === "TaskChangeReview.head") {
                return Effect.succeed(vcsOutput("abc123\n"));
              }
              if (input.operation === "TaskChangeReview.status") {
                return Effect.succeed(vcsOutput(discarded ? "" : "?? temporary.txt\0"));
              }
              return Effect.succeed(vcsOutput());
            },
          },
        }),
      ),
    );
    yield* Effect.promise(() =>
      findTool(discardTools, "discardTaskChanges").execute("discard-changes", {
        taskId,
        paths: ["temporary.txt"],
      }),
    );
    const discardResolution = discardedCommands.at(-1);
    assert.equal(discardResolution?.type, "task.change-review.resolve");
    if (discardResolution?.type === "task.change-review.resolve") {
      assert.equal(discardResolution.resolution, "discarded");
    }

    const returnedCommands: OrchestrationCommand[] = [];
    const returnTools = yield* makePmTools.pipe(
      Effect.provide(makeLayer(returnedCommands, makeReadModel([changeReviewTask()]))),
    );
    yield* Effect.promise(() =>
      findTool(returnTools, "returnTaskChanges").execute("return-changes", {
        taskId,
        instructions: "Commit the intended remaining changes and leave the worktree clean.",
      }),
    );
    assert.deepStrictEqual(
      returnedCommands.map((command) => command.type),
      ["task.stage.start", "task.change-review.resolve"],
    );
    const returned = returnedCommands[1];
    assert.equal(returned?.type, "task.change-review.resolve");
    if (returned?.type === "task.change-review.resolve") {
      assert.equal(returned.resolution, "returned");
    }
  }),
);

it.effect("createTask rejects an unregistered task type before dispatch", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const createTask = findTool(tools, "createTask");

    const error = yield* Effect.promise(async () => {
      try {
        await createTask.execute("tool-create-unknown", {
          projectId: "project-1",
          title: "Unknown task",
          idempotencyKey: "request-unknown",
          taskType: "unknown",
        });
        return null;
      } catch (cause) {
        return cause;
      }
    });

    assert.match(String(error), /Unknown orchestration task type 'unknown'/);
    assert.strictEqual(dispatched.length, 0);
  }),
);

it.effect("createTask carries release provenance into the durable dependency", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const createTask = findTool(tools, "createTask");

    yield* Effect.promise(() =>
      createTask.execute("tool-create-release", {
        projectId: "project-1",
        title: "Release landed feature",
        idempotencyKey: "release:task-1",
        taskType: "release",
        releaseSourceTaskId: "task-1",
      }),
    );

    const command = dispatched[0];
    assert.strictEqual(command?.type, "task.create");
    if (command?.type === "task.create") {
      assert.strictEqual(command.taskType, TaskTypeId.make("release"));
      assert.deepStrictEqual(command.dependsOnTaskIds, [TaskId.make("task-1")]);
    }
  }),
);

it.effect("splitTask derives stable children and resolves dependencies by earlier child key", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const splitTask = findTool(tools, "splitTask");
    const params = {
      parentTaskId: "task-parent",
      idempotencyKey: "request-42:split-1",
      children: [
        {
          key: "contracts",
          title: "Add contracts",
          acceptanceCriteria: ["Contracts decode"],
        },
        {
          key: "runtime",
          title: "Add runtime",
          acceptanceCriteria: ["Runtime passes integration tests"],
          dependsOnKeys: ["contracts"],
        },
      ],
    };

    const first = yield* Effect.promise(() => splitTask.execute("tool-split-1", params));
    const second = yield* Effect.promise(() => splitTask.execute("tool-split-2", params));
    const [firstCommand, secondCommand] = dispatched;
    assert.strictEqual(firstCommand?.type, "task.split");
    assert.strictEqual(secondCommand?.type, "task.split");
    if (firstCommand?.type === "task.split" && secondCommand?.type === "task.split") {
      assert.strictEqual(firstCommand.commandId, secondCommand.commandId);
      assert.deepStrictEqual(firstCommand.children, secondCommand.children);
      assert.ok(firstCommand.children[0]);
      assert.deepStrictEqual(firstCommand.children[1]?.dependsOnTaskIds, [
        firstCommand.children[0].taskId,
      ]);
      assert.deepStrictEqual(firstCommand.children[0]?.acceptanceCriteria, ["Contracts decode"]);
    }
    assert.deepStrictEqual(first.details.childTaskIds, second.details.childTaskIds);
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
        tier: "genius",
        instructions: "Plan the work.",
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.stage.start");
    if (dispatched[0]?.type === "task.stage.start") {
      assert.strictEqual(dispatched[0].capabilityTier, "genius");
    }
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
        tier: "cheap",
        instructions: "Verify the work.",
      }),
    );

    assert.strictEqual(dispatched[0]?.type, "task.stage.start");
    if (dispatched[0]?.type === "task.stage.start") {
      assert.strictEqual(dispatched[0].role, "verify");
      assert.strictEqual(dispatched[0].capabilityTier, "cheap");
    }
  }),
);

it.effect(
  "handoffWorker records an explicit higher-tier retry without mutating the task default",
  () =>
    Effect.gen(function* () {
      const dispatched: OrchestrationCommand[] = [];
      const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
      const handoffWorker = findTool(tools, "handoffWorker");

      yield* Effect.promise(() =>
        handoffWorker.execute("tool-work-cheap", {
          taskId,
          role: "work",
          tier: "cheap",
          instructions: "Apply the mechanical edit.",
        }),
      );
      yield* Effect.promise(() =>
        handoffWorker.execute("tool-work-smart-retry", {
          taskId,
          role: "work",
          tier: "smart",
          instructions: "Retry because the completed result missed the required invariant.",
        }),
      );

      const attempts = dispatched.filter(
        (command): command is Extract<OrchestrationCommand, { type: "task.stage.start" }> =>
          command.type === "task.stage.start",
      );
      assert.deepStrictEqual(
        attempts.map((command) => command.capabilityTier),
        ["cheap", "smart"],
      );
      assert.deepStrictEqual(makeTask().roleCapabilityTiers, { plan: "genius" });
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
      assert.match(firstContent.text, /activity records whether the provider/);
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

it.effect("interruptStage durably requests interruption of the active running stage", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          makeReadModel(
            [makeTask()],
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
          ),
        ),
      ),
    );
    const interruptStage = findTool(tools, "interruptStage");

    const result = yield* Effect.promise(() =>
      interruptStage.execute("tool-interrupt", { taskId }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "thread.turn.interrupt");
    if (dispatched[0]?.type === "thread.turn.interrupt") {
      assert.strictEqual(dispatched[0].threadId, stageThreadId);
      assert.strictEqual(dispatched[0].turnId, turnId);
    }
    assert.deepStrictEqual(result.details, {
      taskId,
      stageThreadId,
      sequence: 1,
      status: "requested",
    });
  }),
);

it.effect("interruptStage rejects a task without a running active stage", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const interruptStage = findTool(tools, "interruptStage");

    const error = yield* Effect.promise(() =>
      interruptStage.execute("tool-interrupt-idle", { taskId }).then(
        () => null,
        (cause) => cause,
      ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /no running turn/);
    assert.strictEqual(dispatched.length, 0);
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

it.effect("lists and resolves a pending approval owned by the task stage", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const requestId = ApprovalRequestId.make("approval-1");
    const thread = makeThread(stageThreadId, {
      activities: [
        makeActivity(1, {
          kind: "approval.requested",
          tone: "approval",
          payload: {
            requestId,
            requestKind: "permissions",
            detail: "Write generated files under /tmp/build",
          },
        }),
      ],
    });
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(
          dispatched,
          withStageHistory(makeReadModel([makeTask()], [thread]), stageThreadId, "work"),
          null,
          {
            pendingApprovals: [
              {
                requestId,
                threadId: stageThreadId,
                turnId,
                status: "pending",
                decision: null,
                createdAt: now,
                resolvedAt: null,
              },
            ],
          },
        ),
      ),
    );
    const listApprovals = findTool(tools, "listPendingStageApprovals");
    const respond = findTool(tools, "respondToStageApproval");

    const listed = yield* Effect.promise(() =>
      listApprovals.execute("tool-list-approvals", { taskId }),
    );
    assert.deepStrictEqual(listed.details.approvals, [
      {
        requestId,
        stageThreadId,
        stageRole: "work",
        turnId,
        requestKind: "permissions",
        detail: "Write generated files under /tmp/build",
        createdAt: now,
      },
    ]);

    yield* Effect.promise(() =>
      respond.execute("tool-respond-approval", {
        taskId,
        requestId,
        decision: "accept",
      }),
    );
    assert.deepInclude(dispatched.at(-1), {
      type: "thread.approval.respond",
      threadId: stageThreadId,
      requestId,
      decision: "accept",
    });
  }),
);

it.effect("rejects a pending approval owned by a different task", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const requestId = ApprovalRequestId.make("approval-foreign");
    const foreignThreadId = ThreadId.make("foreign-stage");
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel(), null, {
          pendingApprovals: [
            {
              requestId,
              threadId: foreignThreadId,
              turnId,
              status: "pending",
              decision: null,
              createdAt: now,
              resolvedAt: null,
            },
          ],
        }),
      ),
    );
    const respond = findTool(tools, "respondToStageApproval");
    const error = yield* Effect.promise(() =>
      respond.execute("tool-respond-foreign", { taskId, requestId, decision: "accept" }).then(
        () => null,
        (cause) => cause,
      ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /does not belong to task/);
    assert.isEmpty(dispatched);
  }),
);

it.effect("rejects an approval that was already resolved", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const requestId = ApprovalRequestId.make("approval-resolved");
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, makeReadModel(), null, {
          pendingApprovals: [
            {
              requestId,
              threadId: stageThreadId,
              turnId,
              status: "resolved",
              decision: "decline",
              createdAt: now,
              resolvedAt: now,
            },
          ],
        }),
      ),
    );
    const respond = findTool(tools, "respondToStageApproval");
    const error = yield* Effect.promise(() =>
      respond.execute("tool-respond-resolved", { taskId, requestId, decision: "accept" }).then(
        () => null,
        (cause) => cause,
      ),
    );

    assert.instanceOf(error, Error);
    assert.match(error.message, /is not pending/);
    assert.isEmpty(dispatched);
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
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, readModel, null, {
          vcsProcess: {
            run: (input) =>
              Effect.succeed(vcsOutput(input.args[0] === "rev-parse" ? "verified-head\n" : "")),
          },
        }),
      ),
    );

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
    const tools = yield* makePmTools.pipe(
      Effect.provide(
        makeLayer(dispatched, readModel, null, {
          vcsProcess: {
            run: (input) =>
              Effect.succeed(vcsOutput(input.args[0] === "rev-parse" ? "verified-head\n" : "")),
          },
        }),
      ),
    );

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

it.effect("setTaskTier dispatches a merged pm-runtime capability-tier command", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const setTaskTier = findTool(tools, "setTaskTier");

    const result = yield* Effect.promise(() =>
      setTaskTier.execute("tool-tier", {
        taskId,
        role: "work",
        tier: "smart",
      }),
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0]?.type, "task.capability-tiers.set");
    if (dispatched[0]?.type === "task.capability-tiers.set") {
      assert.strictEqual(dispatched[0].origin, "pm-runtime");
      assert.deepStrictEqual(dispatched[0].roleCapabilityTiers, {
        plan: "genius",
        work: "smart",
      });
    }
    assert.deepStrictEqual(result.details, {
      taskId,
      role: "work",
      tier: "smart",
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

it.effect("classifyRequest rejects a task type missing from the registry", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched)));
    const classifyRequest = findTool(tools, "classifyRequest");

    const outcome = yield* Effect.promise(async () => {
      try {
        await classifyRequest.execute("tool-classify-unknown", {
          taskId,
          taskType: "unknown",
          playbookVersion: "pm-supplied-version",
        });
        return { rejected: false as const, error: null };
      } catch (error) {
        return { rejected: true as const, error };
      }
    });

    assert.strictEqual(outcome.rejected, true);
    assert.match(String(outcome.error), /Unknown orchestration task type 'unknown'/);
    assert.strictEqual(dispatched.length, 0);
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
      result.details.tasks.map((task: { id: TaskId }) => task.id),
      [TaskId.make("task-active")],
    );
  }),
);

it.effect("getTaskLedger bounds stage history and returns the projection cursor", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const attemptIds = Array.from({ length: 5 }, (_, index) =>
      ThreadId.make(`thread-attempt-${index + 1}`),
    );
    const task = makeTask({ stageThreadIds: attemptIds, currentStageThreadId: attemptIds.at(-1)! });
    const base = makeReadModel([task]);
    const readModel: OrchestrationReadModel = {
      ...base,
      snapshotSequence: 42,
      stageHistory: Object.fromEntries(
        attemptIds.map((stageThreadId, index) => [
          stageThreadId,
          {
            projectId,
            taskId,
            stageThreadId,
            role: "work" as const,
            capabilityTier: "smart" as const,
            providerInstanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
            modelOptions: null,
            status: index === 4 ? ("running" as const) : ("completed" as const),
            startedAt: now,
            endedAt: index === 4 ? null : now,
          },
        ]),
      ),
    };
    const tools = yield* makePmTools.pipe(Effect.provide(makeLayer(dispatched, readModel)));
    const getTaskLedger = findTool(tools, "getTaskLedger");

    const result = yield* Effect.promise(() =>
      getTaskLedger.execute("tool-task-ledger-bounded", { projectId }),
    );

    assert.strictEqual(result.details.lastActionCursor, 42);
    assert.strictEqual(result.details.tasks[0]?.attemptCount, 5);
    assert.deepStrictEqual(result.details.tasks[0]?.roleCapabilityTiers, task.roleCapabilityTiers);
    assert.deepStrictEqual(
      result.details.tasks[0]?.recentAttempts.map(
        (attempt: { stageThreadId: string }) => attempt.stageThreadId,
      ),
      attemptIds.slice(-3),
    );
    assert.deepStrictEqual(result.details.tasks[0]?.recentAttempts.at(-1), {
      stageThreadId: attemptIds.at(-1),
      role: "work",
      capabilityTier: "smart",
      providerInstanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
      status: "running",
      startedAt: now,
      endedAt: null,
    });
    assert.ok(!("stageThreadIds" in (result.details.tasks[0] ?? {})));
  }),
);

it.effect("getTaskLedger identifies dependency-blocked and runnable children", () =>
  Effect.gen(function* () {
    const dispatched: OrchestrationCommand[] = [];
    const parentId = TaskId.make("task-parent");
    const childAId = TaskId.make("task-child-a");
    const childBId = TaskId.make("task-child-b");
    const parent = makeTask({ id: parentId, stageThreadIds: [], currentStageThreadId: null });
    const childA = makeTask({
      id: childAId,
      parentTaskId: parentId,
      childOrder: 0,
      stageThreadIds: [],
      currentStageThreadId: null,
    });
    const childB = makeTask({
      id: childBId,
      parentTaskId: parentId,
      childOrder: 1,
      acceptanceCriteria: ["B passes"],
      dependsOnTaskIds: [childAId],
      stageThreadIds: [],
      currentStageThreadId: null,
    });
    const tools = yield* makePmTools.pipe(
      Effect.provide(makeLayer(dispatched, makeReadModel([parent, childA, childB], []))),
    );
    const result = yield* Effect.promise(() =>
      findTool(tools, "getTaskLedger").execute("tool-ledger-dependencies", { projectId }),
    );

    const summaries = result.details.tasks as ReadonlyArray<{
      id: string;
      blockedByTaskIds: ReadonlyArray<string>;
      acceptanceCriteria: ReadonlyArray<string>;
    }>;
    assert.deepStrictEqual(summaries.find((task) => task.id === childAId)?.blockedByTaskIds, []);
    assert.deepStrictEqual(summaries.find((task) => task.id === childBId)?.blockedByTaskIds, [
      childAId,
    ]);
    assert.deepStrictEqual(summaries.find((task) => task.id === childBId)?.acceptanceCriteria, [
      "B passes",
    ]);
  }),
);
