import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderDriverKind,
  ProviderInstanceId,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationTask,
  type OrchestrationThread,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { OrphanTurnReconciler } from "../Services/OrphanTurnReconciler.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { withTaskLifecycleLock } from "../taskLifecycleCoordinator.ts";
import { findOrphanedActiveStages, makeOrphanTurnReconcilerLive } from "./OrphanTurnReconciler.ts";

const now = "2026-06-15T08:00:00.000Z";
const projectId = ProjectId.make("project-1");
const provider = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const asTaskId = (value: string): TaskId => TaskId.make(value);
const asTaskTypeId = (value: string): TaskTypeId => TaskTypeId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const unsupported = () => Effect.die(new Error("unsupported test service call")) as never;

function makeThread(input: {
  readonly threadId: ThreadId;
  readonly activeTurnId?: TurnId | null;
  readonly status?: NonNullable<OrchestrationThread["session"]>["status"];
  readonly withSession?: boolean;
}): OrchestrationThread {
  const activeTurnId = input.activeTurnId ?? null;
  return {
    id: input.threadId,
    projectId,
    title: String(input.threadId),
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5-codex" },
    runtimeMode: "full-access",
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn:
      activeTurnId === null
        ? null
        : {
            turnId: activeTurnId,
            state: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            assistantMessageId: null,
          },
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
    pendingPmHandoff: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session:
      input.withSession === false
        ? null
        : {
            threadId: input.threadId,
            status: input.status ?? "running",
            providerName: "codex",
            providerInstanceId,
            runtimeMode: "full-access",
            activeTurnId,
            lastError: null,
            updatedAt: now,
          },
  };
}

function makeTask(input: {
  readonly taskId: string;
  readonly status?: OrchestrationTask["status"];
  readonly currentStageThreadId?: ThreadId | null;
  readonly historicalStageThreadIds?: ReadonlyArray<ThreadId>;
  readonly cancelling?: boolean;
}): OrchestrationTask {
  const currentStageThreadId = input.currentStageThreadId ?? null;
  return {
    id: asTaskId(input.taskId),
    projectId,
    type: asTaskTypeId("feature"),
    title: input.taskId,
    status: input.status ?? "working",
    branch: `orchestrator/${input.taskId}`,
    worktreePath: `/tmp/project/.gedcode/tasks/${input.taskId}`,
    prUrl: null,
    pmMessageId: null,
    stageThreadIds: [
      ...(input.historicalStageThreadIds ?? []),
      ...(currentStageThreadId === null ? [] : [currentStageThreadId]),
    ],
    currentStageThreadId,
    cancellation: input.cancelling
      ? {
          requestedAt: now,
          completedPhases: [],
          failurePhase: null,
          failureMessage: null,
          failedAt: null,
        }
      : null,
    playbookVersion: "feature@v1",
    createdAt: now,
    updatedAt: now,
  };
}

function makeProviderSession(threadId: ThreadId): ProviderSession {
  return {
    provider,
    providerInstanceId,
    status: "running",
    runtimeMode: "full-access",
    threadId,
    activeTurnId: asTurnId("live-turn"),
    createdAt: now,
    updatedAt: now,
  };
}

function makeReadModel(input: {
  readonly tasks: ReadonlyArray<OrchestrationTask>;
  readonly threads?: ReadonlyArray<OrchestrationThread>;
}): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [],
    threads: [...(input.threads ?? [])],
    tasks: [...input.tasks],
    pendingGates: [],
    quotaBlockedStages: [],
    stageHistory: {},
    updatedAt: now,
  };
}

function makeProjectionSnapshotQueryLayer(getReadModel: () => OrchestrationReadModel) {
  return Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.succeed(getReadModel()),
    getSnapshot: () => Effect.succeed(getReadModel()),
    getShellSnapshot: () => unsupported(),
    getArchivedShellSnapshot: () => unsupported(),
    getSnapshotSequence: () => unsupported(),
    getCounts: () => unsupported(),
    getActiveProjectByWorkspaceRoot: () => unsupported(),
    getProjectShellById: () => unsupported(),
    getFirstActiveThreadIdByProjectId: () => unsupported(),
    getThreadCheckpointContext: () => unsupported(),
    getFullThreadDiffContext: () => unsupported(),
    getThreadShellById: () => unsupported(),
    getThreadDetailById: () => unsupported(),
  });
}

function makeProviderServiceLayer(getLiveSessions: () => ReadonlyArray<ProviderSession>) {
  return Layer.succeed(ProviderService, {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions: () => Effect.sync(() => [...getLiveSessions()]),
    getCapabilities: () => unsupported(),
    getInstanceInfo: () => unsupported(),
    rollbackConversation: () => unsupported(),
    streamEvents: Stream.empty,
  } satisfies ProviderServiceShape);
}

function makeRuntime(input: {
  readonly getReadModel: () => OrchestrationReadModel;
  readonly liveSessions?: ReadonlyArray<ProviderSession>;
  readonly getLiveSessions?: () => ReadonlyArray<ProviderSession>;
  readonly dispatch: OrchestrationEngineShape["dispatch"];
}) {
  return ManagedRuntime.make(
    makeOrphanTurnReconcilerLive({ maxAttempts: 2, retryDelayMs: 0 }).pipe(
      Layer.provide(makeProjectionSnapshotQueryLayer(input.getReadModel)),
      Layer.provide(
        makeProviderServiceLayer(input.getLiveSessions ?? (() => input.liveSessions ?? [])),
      ),
      Layer.provide(
        Layer.succeed(OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: input.dispatch,
          streamDomainEvents: Stream.empty,
          streamShellEvents: Stream.empty,
        }),
      ),
    ),
  );
}

describe("OrphanTurnReconciler", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrphanTurnReconciler, never> | null = null;

  afterEach(async () => {
    await runtime?.dispose();
    runtime = null;
  });

  it("selects only the current active stage that has no live provider session", () => {
    const orphanThreadId = asThreadId("stage-orphan");
    const liveThreadId = asThreadId("stage-live");
    const historicalThreadId = asThreadId("stage-historical");
    const cancellingThreadId = asThreadId("stage-cancelling");
    const landedThreadId = asThreadId("stage-landed");
    const abandonedThreadId = asThreadId("stage-abandoned");
    const readModel = makeReadModel({
      tasks: [
        makeTask({
          taskId: "task-orphan",
          currentStageThreadId: orphanThreadId,
          historicalStageThreadIds: [historicalThreadId],
        }),
        makeTask({ taskId: "task-live", currentStageThreadId: liveThreadId }),
        makeTask({
          taskId: "task-cancelling",
          currentStageThreadId: cancellingThreadId,
          cancelling: true,
        }),
        makeTask({
          taskId: "task-landed",
          status: "landed",
          currentStageThreadId: landedThreadId,
        }),
        makeTask({
          taskId: "task-abandoned",
          status: "abandoned",
          currentStageThreadId: abandonedThreadId,
        }),
      ],
      threads: [
        makeThread({
          threadId: orphanThreadId,
          activeTurnId: asTurnId("turn-orphan"),
        }),
        makeThread({
          threadId: liveThreadId,
          activeTurnId: asTurnId("turn-live"),
        }),
        makeThread({
          threadId: historicalThreadId,
          activeTurnId: asTurnId("turn-history"),
        }),
      ],
    });

    const orphaned = findOrphanedActiveStages({
      readModel,
      liveProviderSessions: [makeProviderSession(liveThreadId)],
    });

    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]).toMatchObject({
      taskId: asTaskId("task-orphan"),
      threadId: orphanThreadId,
      role: "work",
    });
  });

  it("interrupts the thread session before settling the task stage with deterministic ids", async () => {
    const dispatched: OrchestrationCommand[] = [];
    const threadId = asThreadId("stage-orphan");
    const readModel = makeReadModel({
      tasks: [makeTask({ taskId: "task-orphan", currentStageThreadId: threadId })],
      threads: [makeThread({ threadId, activeTurnId: asTurnId("turn-orphan") })],
    });
    runtime = makeRuntime({
      getReadModel: () => readModel,
      dispatch: (command) => {
        dispatched.push(command);
        return Effect.succeed({ sequence: dispatched.length });
      },
    });

    const reconciler = await runtime.runPromise(Effect.service(OrphanTurnReconciler));
    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);

    expect(dispatched.map((command) => command.type)).toEqual([
      "thread.session.set",
      "task.stage.interrupt",
    ]);
    expect(dispatched[0]).toMatchObject({
      commandId: CommandId.make("server:orphan-turn-reconcile:stage-orphan:turn-orphan"),
      threadId,
      session: { status: "interrupted", activeTurnId: null },
    });
    expect(dispatched[1]).toMatchObject({
      commandId: CommandId.make("server:orphan-stage-reconcile:task-orphan:stage-orphan"),
      taskId: asTaskId("task-orphan"),
      stageThreadId: threadId,
      role: "work",
      reason: "orphaned",
    });
  });

  it.each([
    {
      label: "already-interrupted",
      thread: makeThread({
        threadId: asThreadId("stage-interrupted"),
        status: "interrupted",
      }),
    },
    {
      label: "null-session",
      thread: makeThread({
        threadId: asThreadId("stage-null"),
        withSession: false,
      }),
    },
    { label: "missing-thread", thread: null },
  ])("settles the task when its thread session is $label", async ({ label, thread }) => {
    const threadId = thread?.id ?? asThreadId("stage-missing");
    const dispatched: OrchestrationCommand[] = [];
    const readModel = makeReadModel({
      tasks: [makeTask({ taskId: `task-${label}`, currentStageThreadId: threadId })],
      threads: thread === null ? [] : [thread],
    });
    runtime = makeRuntime({
      getReadModel: () => readModel,
      dispatch: (command) => {
        dispatched.push(command);
        return Effect.succeed({ sequence: dispatched.length });
      },
    });

    const reconciler = await runtime.runPromise(Effect.service(OrphanTurnReconciler));
    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "task.stage.interrupt",
      taskId: asTaskId(`task-${label}`),
      stageThreadId: threadId,
    });
  });

  it("uses the mutable projection so repeated reconciliation is a no-op", async () => {
    const threadId = asThreadId("stage-once");
    let readModel = makeReadModel({
      tasks: [makeTask({ taskId: "task-once", currentStageThreadId: threadId })],
      threads: [makeThread({ threadId, status: "interrupted" })],
    });
    const dispatched: OrchestrationCommand[] = [];
    runtime = makeRuntime({
      getReadModel: () => readModel,
      dispatch: (command) => {
        dispatched.push(command);
        if (command.type === "task.stage.interrupt") {
          readModel = {
            ...readModel,
            tasks: readModel.tasks.map((task) =>
              task.id === command.taskId
                ? Object.assign({}, task, { currentStageThreadId: null })
                : task,
            ),
          };
        }
        return Effect.succeed({ sequence: dispatched.length });
      },
    });

    const reconciler = await runtime.runPromise(Effect.service(OrphanTurnReconciler));
    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);
    expect(await runtime.runPromise(reconciler.reconcile())).toBe(0);
    expect(dispatched.map((command) => command.type)).toEqual(["task.stage.interrupt"]);
  });

  it("retries a transient stage-dispatch failure without repeating settled session repair", async () => {
    const threadId = asThreadId("stage-retry");
    let readModel = makeReadModel({
      tasks: [makeTask({ taskId: "task-retry", currentStageThreadId: threadId })],
      threads: [makeThread({ threadId, activeTurnId: asTurnId("turn-retry") })],
    });
    const dispatched: OrchestrationCommand[] = [];
    let stageAttempts = 0;
    runtime = makeRuntime({
      getReadModel: () => readModel,
      dispatch: (command) => {
        dispatched.push(command);
        if (command.type === "thread.session.set") {
          readModel = {
            ...readModel,
            threads: readModel.threads.map((thread) =>
              thread.id === command.threadId ? { ...thread, session: command.session } : thread,
            ),
          };
        }
        if (command.type === "task.stage.interrupt") {
          stageAttempts += 1;
          if (stageAttempts === 1) {
            return Effect.die(new Error("transient dispatch failure"));
          }
          readModel = {
            ...readModel,
            tasks: readModel.tasks.map((task) =>
              task.id === command.taskId
                ? Object.assign({}, task, { currentStageThreadId: null })
                : task,
            ),
          };
        }
        return Effect.succeed({ sequence: dispatched.length });
      },
    });

    const reconciler = await runtime.runPromise(Effect.service(OrphanTurnReconciler));
    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);
    expect(dispatched.map((command) => command.type)).toEqual([
      "thread.session.set",
      "task.stage.interrupt",
      "task.stage.interrupt",
    ]);
  });

  it("does not settle a stage that becomes live while reconciliation waits for its lifecycle lock", async () => {
    const taskId = asTaskId("task-race-live");
    const threadId = asThreadId("stage-race-live");
    const readModel = makeReadModel({
      tasks: [makeTask({ taskId: String(taskId), currentStageThreadId: threadId })],
      threads: [makeThread({ threadId, activeTurnId: asTurnId("turn-race-live") })],
    });
    const dispatched: OrchestrationCommand[] = [];
    let liveSessions: ReadonlyArray<ProviderSession> = [];
    let listSessionCalls = 0;
    const initialSnapshotListedLatch: { resolve: () => void } = {
      resolve: () => {},
    };
    const initialSnapshotListed = new Promise<void>((resolve) => {
      initialSnapshotListedLatch.resolve = resolve;
    });
    const lockAcquired = await Effect.runPromise(Deferred.make<void>());
    const releaseLock = await Effect.runPromise(Deferred.make<void>());
    const lockFiber = Effect.runFork(
      withTaskLifecycleLock(
        taskId,
        Deferred.succeed(lockAcquired, undefined).pipe(Effect.andThen(Deferred.await(releaseLock))),
      ),
    );
    await Effect.runPromise(Deferred.await(lockAcquired));

    runtime = makeRuntime({
      getReadModel: () => readModel,
      getLiveSessions: () => {
        listSessionCalls += 1;
        if (listSessionCalls === 1) {
          initialSnapshotListedLatch.resolve();
        }
        return liveSessions;
      },
      dispatch: (command) => {
        dispatched.push(command);
        return Effect.succeed({ sequence: dispatched.length });
      },
    });
    const reconciler = await runtime.runPromise(Effect.service(OrphanTurnReconciler));
    const reconciliation = runtime.runPromise(reconciler.reconcile());

    try {
      await initialSnapshotListed;
      liveSessions = [makeProviderSession(threadId)];
    } finally {
      await Effect.runPromise(Deferred.succeed(releaseLock, undefined));
      await Effect.runPromise(Fiber.join(lockFiber));
    }

    await reconciliation;
    expect(listSessionCalls).toBeGreaterThanOrEqual(2);
    expect(dispatched).toEqual([]);
  });
});
