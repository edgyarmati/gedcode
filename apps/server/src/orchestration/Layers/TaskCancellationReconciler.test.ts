import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
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
import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { TerminalManager, type TerminalManagerShape } from "../../terminal/Services/Manager.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TaskCancellationReconciler } from "../Services/TaskCancellationReconciler.ts";
import { createEmptyReadModel } from "../projector.ts";
import {
  findPendingTaskCancellations,
  makeTaskCancellationReconcilerLive,
} from "./TaskCancellationReconciler.ts";

const now = "2026-07-11T08:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const threadId = ThreadId.make("stage-thread-1");
const turnId = TurnId.make("turn-1");
const providerInstanceId = ProviderInstanceId.make("codex");

const makeTask = (overrides: Partial<OrchestrationTask> = {}): OrchestrationTask => ({
  id: taskId,
  projectId,
  type: TaskTypeId.make("feature"),
  title: "Cancel after restart",
  status: "working",
  branch: "orchestrator/task-1",
  worktreePath: "/repo/.gedcode/tasks/task-1",
  prUrl: null,
  pmMessageId: null,
  stageThreadIds: [threadId],
  currentStageThreadId: threadId,
  cancellation: {
    requestedAt: now,
    completedPhases: [],
    failurePhase: "stop-session",
    failureMessage: "server exited while stopping the provider",
    failedAt: now,
  },
  landing: null,
  roleModelSelections: {},
  playbookVersion: "feature@v1",
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
  ...overrides,
});

const makeThread = (): OrchestrationThread => ({
  id: threadId,
  projectId,
  title: "Work stage",
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5-codex" },
  runtimeMode: "full-access",
  interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
  branch: "orchestrator/task-1",
  worktreePath: "/repo/.gedcode/tasks/task-1",
  latestTurn: {
    turnId,
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
  session: null,
});

const makeProviderSession = (): ProviderSession => ({
  provider: ProviderDriverKind.make("codex"),
  providerInstanceId,
  status: "running",
  runtimeMode: "full-access",
  threadId,
  activeTurnId: turnId,
  createdAt: now,
  updatedAt: now,
});

const makeReadModel = (task: OrchestrationTask): OrchestrationReadModel => ({
  ...createEmptyReadModel(now),
  snapshotSequence: 1,
  tasks: [task],
  threads: [makeThread()],
});

const unsupportedCall = () => Effect.die("unexpected service call") as never;

function makeRuntime(input: {
  readonly task: OrchestrationTask;
  readonly liveSessions: ReadonlyArray<ProviderSession>;
  readonly stopFailures?: number;
}) {
  let readModel = makeReadModel(input.task);
  const dispatched: OrchestrationCommand[] = [];
  const interruptTurn = vi.fn();
  const stopSession = vi.fn();
  const closeTerminals = vi.fn();
  let stopFailuresRemaining = input.stopFailures ?? 0;

  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getCommandReadModel: () => Effect.succeed(readModel),
      getSnapshot: () => Effect.succeed(readModel),
      getShellSnapshot: () => Effect.die("unexpected projection query"),
      getArchivedShellSnapshot: () => Effect.die("unexpected projection query"),
      getSnapshotSequence: () => Effect.die("unexpected projection query"),
      getCounts: () => Effect.die("unexpected projection query"),
      getActiveProjectByWorkspaceRoot: () => Effect.die("unexpected projection query"),
      getProjectShellById: () => Effect.die("unexpected projection query"),
      getFirstActiveThreadIdByProjectId: () => Effect.die("unexpected projection query"),
      getThreadCheckpointContext: () => Effect.die("unexpected projection query"),
      getFullThreadDiffContext: () => Effect.die("unexpected projection query"),
      getThreadShellById: () => Effect.die("unexpected projection query"),
      getThreadDetailById: () => Effect.die("unexpected projection query"),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          readModel = {
            ...readModel,
            snapshotSequence: readModel.snapshotSequence + 1,
            tasks: readModel.tasks.map((task): OrchestrationTask => {
              if (
                !("taskId" in command) ||
                task.id !== command.taskId ||
                task.cancellation == null
              ) {
                return task;
              }
              const cancellation = task.cancellation;
              if (command.type === "task.cancellation.phase.complete") {
                return {
                  ...task,
                  cancellation: {
                    ...cancellation,
                    completedPhases: Array.from(
                      new Set([...(cancellation.completedPhases ?? []), command.phase]),
                    ),
                    failurePhase: null,
                    failureMessage: null,
                    failedAt: null,
                  },
                };
              }
              if (command.type === "task.abandon") {
                return {
                  ...task,
                  status: "abandoned" as const,
                  currentStageThreadId: null,
                  cancellation: {
                    ...cancellation,
                    failurePhase: null,
                    failureMessage: null,
                    failedAt: null,
                  },
                };
              }
              return task;
            }),
          };
          return { sequence: readModel.snapshotSequence };
        }),
      streamDomainEvents: Stream.empty,
      streamShellEvents: Stream.empty,
    }),
    Layer.succeed(ProviderService, {
      startSession: unsupportedCall,
      sendTurn: unsupportedCall,
      interruptTurn: () => Effect.sync(interruptTurn),
      respondToRequest: unsupportedCall,
      respondToUserInput: unsupportedCall,
      stopSession: () =>
        Effect.sync(() => {
          stopSession();
          if (stopFailuresRemaining > 0) {
            stopFailuresRemaining -= 1;
            throw new Error("transient provider stop failure");
          }
        }),
      listSessions: () => Effect.succeed([...input.liveSessions]),
      getCapabilities: unsupportedCall,
      getInstanceInfo: unsupportedCall,
      rollbackConversation: unsupportedCall,
      forkConversation: unsupportedCall,
      streamEvents: Stream.empty,
    } satisfies ProviderServiceShape),
    Layer.succeed(TerminalManager, {
      open: unsupportedCall,
      write: unsupportedCall,
      resize: unsupportedCall,
      clear: unsupportedCall,
      restart: unsupportedCall,
      close: () => Effect.sync(closeTerminals),
      subscribe: () => Effect.succeed(() => undefined),
    } satisfies TerminalManagerShape),
    NodeServices.layer,
  );

  return {
    runtime: ManagedRuntime.make(
      makeTaskCancellationReconcilerLive({ maxAttempts: 2, retryDelayMs: 0 }).pipe(
        Layer.provide(dependencies),
      ),
    ),
    dispatched,
    interruptTurn,
    stopSession,
    closeTerminals,
    getReadModel: () => readModel,
  };
}

describe("TaskCancellationReconciler", () => {
  let runtime: ManagedRuntime.ManagedRuntime<TaskCancellationReconciler, never> | null = null;

  afterEach(async () => {
    if (runtime !== null) await runtime.dispose();
    runtime = null;
  });

  it("selects reserved non-terminal tasks only", () => {
    const pending = makeTask();
    const unreserved = makeTask({ id: TaskId.make("task-unreserved"), cancellation: null });
    const landed = makeTask({ id: TaskId.make("task-landed"), status: "landed" });
    const abandoned = makeTask({ id: TaskId.make("task-abandoned"), status: "abandoned" });

    expect(findPendingTaskCancellations([unreserved, landed, pending, abandoned])).toEqual([
      pending,
    ]);
  });

  it("continues only unfinished shutdown phases, clears failure, and is idempotent", async () => {
    const fixture = makeRuntime({
      task: makeTask({
        cancellation: {
          requestedAt: now,
          completedPhases: ["interrupt-turn"],
          failurePhase: "stop-session",
          failureMessage: "server exited while stopping the provider",
          failedAt: now,
        },
      }),
      liveSessions: [makeProviderSession()],
    });
    runtime = fixture.runtime;
    const reconciler = await runtime.runPromise(Effect.service(TaskCancellationReconciler));

    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);
    expect(fixture.dispatched.map((command) => command.type)).toEqual([
      "task.cancellation.phase.complete",
      "task.cancellation.phase.complete",
      "task.abandon",
    ]);
    expect(fixture.interruptTurn).not.toHaveBeenCalled();
    expect(fixture.stopSession).toHaveBeenCalledOnce();
    expect(fixture.closeTerminals).toHaveBeenCalledOnce();
    expect(fixture.getReadModel().tasks[0]).toMatchObject({
      status: "abandoned",
      currentStageThreadId: null,
      cancellation: {
        completedPhases: ["interrupt-turn", "stop-session", "close-terminals"],
        failurePhase: null,
        failureMessage: null,
        failedAt: null,
      },
    });

    expect(await runtime.runPromise(reconciler.reconcile())).toBe(0);
    expect(fixture.dispatched).toHaveLength(3);
    expect(fixture.stopSession).toHaveBeenCalledOnce();
    expect(fixture.closeTerminals).toHaveBeenCalledOnce();
  });

  it("does not interrupt or stop a provider session missing at startup", async () => {
    const fixture = makeRuntime({ task: makeTask(), liveSessions: [] });
    runtime = fixture.runtime;
    const reconciler = await runtime.runPromise(Effect.service(TaskCancellationReconciler));

    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);
    expect(fixture.interruptTurn).not.toHaveBeenCalled();
    expect(fixture.stopSession).not.toHaveBeenCalled();
    expect(fixture.closeTerminals).toHaveBeenCalledOnce();
    expect(fixture.dispatched.map((command) => command.type)).toEqual([
      "task.cancellation.phase.complete",
      "task.cancellation.phase.complete",
      "task.cancellation.phase.complete",
      "task.abandon",
    ]);
  });

  it("retries a transient shutdown failure during the same startup", async () => {
    const fixture = makeRuntime({
      task: makeTask({
        cancellation: {
          requestedAt: now,
          completedPhases: ["interrupt-turn"],
          failurePhase: null,
          failureMessage: null,
          failedAt: null,
        },
      }),
      liveSessions: [makeProviderSession()],
      stopFailures: 1,
    });
    runtime = fixture.runtime;
    const reconciler = await runtime.runPromise(Effect.service(TaskCancellationReconciler));

    expect(await runtime.runPromise(reconciler.reconcile())).toBe(1);
    expect(fixture.stopSession).toHaveBeenCalledTimes(2);
    expect(fixture.closeTerminals).toHaveBeenCalledOnce();
    expect(fixture.dispatched.map((command) => command.type)).toEqual([
      "task.cancellation.fail",
      "task.cancellation.phase.complete",
      "task.cancellation.phase.complete",
      "task.abandon",
    ]);
    expect(fixture.getReadModel().tasks[0]?.status).toBe("abandoned");
  });
});
