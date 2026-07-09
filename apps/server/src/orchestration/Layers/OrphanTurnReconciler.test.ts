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
  type OrchestrationThread,
  type ProviderSession,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrphanTurnReconciler } from "../Services/OrphanTurnReconciler.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { findOrphanedStageSessions, OrphanTurnReconcilerLive } from "./OrphanTurnReconciler.ts";

const now = "2026-06-15T08:00:00.000Z";
const projectId = ProjectId.make("project-1");
const provider = ProviderDriverKind.make("codex");
const providerInstanceId = ProviderInstanceId.make("codex");
const asTaskId = (value: string): TaskId => TaskId.make(value);
const asTaskTypeId = (value: string): TaskTypeId => TaskTypeId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);

function makeThread(input: {
  readonly threadId: ThreadId;
  readonly activeTurnId?: TurnId | null;
  readonly status?: NonNullable<OrchestrationThread["session"]>["status"];
}): OrchestrationThread {
  const activeTurnId = input.activeTurnId ?? null;
  return {
    id: input.threadId,
    projectId,
    title: String(input.threadId),
    modelSelection: {
      instanceId: providerInstanceId,
      model: "gpt-5-codex",
    },
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
    session: {
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

function makeReadModel(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [],
    threads: [...threads],
    tasks: [
      {
        id: asTaskId("task-1"),
        projectId,
        type: asTaskTypeId("feature"),
        title: "Task",
        status: "working",
        branch: "orchestrator/task-1",
        worktreePath: "/tmp/project/.gedcode/tasks/task-1",
        prUrl: null,
        pmMessageId: null,
        stageThreadIds: [asThreadId("stage-orphan"), asThreadId("stage-live")],
        currentStageThreadId: asThreadId("stage-orphan"),
        playbookVersion: "feature@v1",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pendingGates: [],
    quotaBlockedStages: [],
    stageHistory: {},
    updatedAt: now,
  };
}

function makeProjectionSnapshotQueryLayer(readModel: OrchestrationReadModel) {
  const unsupported = () => Effect.die(new Error("unsupported projection query call")) as never;
  return Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.succeed(readModel),
    getSnapshot: () => Effect.succeed(readModel),
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

function makeProviderServiceLayer(liveSessions: ReadonlyArray<ProviderSession>) {
  const unsupported = () => Effect.die(new Error("unsupported provider call")) as never;
  return Layer.succeed(ProviderService, {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions: () => Effect.succeed([...liveSessions]),
    getCapabilities: () => unsupported(),
    getInstanceInfo: () => unsupported(),
    rollbackConversation: () => unsupported(),
    streamEvents: Stream.empty,
  } satisfies ProviderServiceShape);
}

describe("OrphanTurnReconciler", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrphanTurnReconciler, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("selects only running task stage threads without live provider sessions", () => {
    const stageOrphan = makeThread({
      threadId: asThreadId("stage-orphan"),
      activeTurnId: asTurnId("turn-orphan"),
    });
    const stageLive = makeThread({
      threadId: asThreadId("stage-live"),
      activeTurnId: asTurnId("turn-live"),
    });
    const normalThread = makeThread({
      threadId: asThreadId("normal-thread"),
      activeTurnId: asTurnId("turn-normal"),
    });
    const stageReady = makeThread({
      threadId: asThreadId("stage-ready"),
      status: "ready",
      activeTurnId: null,
    });

    const orphaned = findOrphanedStageSessions({
      readModel: makeReadModel([stageOrphan, stageLive, normalThread, stageReady]),
      liveProviderSessions: [makeProviderSession(asThreadId("stage-live"))],
    });

    expect(orphaned.map((entry) => String(entry.threadId))).toEqual(["stage-orphan"]);
  });

  it("dispatches interrupted session updates for orphaned stage turns", async () => {
    const dispatched: OrchestrationCommand[] = [];
    const stageOrphan = makeThread({
      threadId: asThreadId("stage-orphan"),
      activeTurnId: asTurnId("turn-orphan"),
    });
    const readModel = makeReadModel([stageOrphan]);

    runtime = ManagedRuntime.make(
      OrphanTurnReconcilerLive.pipe(
        Layer.provide(makeProjectionSnapshotQueryLayer(readModel)),
        Layer.provide(makeProviderServiceLayer([])),
        Layer.provide(
          Layer.succeed(OrchestrationEngineService, {
            readEvents: () => Stream.empty,
            dispatch: (command) => {
              dispatched.push(command);
              return Effect.succeed({ sequence: dispatched.length });
            },
            streamDomainEvents: Stream.empty,
            streamShellEvents: Stream.empty,
          }),
        ),
      ),
    );

    const reconciler = await runtime.runPromise(Effect.service(OrphanTurnReconciler));
    const count = await runtime.runPromise(reconciler.reconcile());

    expect(count).toBe(1);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      type: "thread.session.set",
      commandId: CommandId.make("server:orphan-turn-reconcile:stage-orphan:turn-orphan"),
      threadId: asThreadId("stage-orphan"),
      session: {
        status: "interrupted",
        activeTurnId: null,
        lastError: "Provider session was not live during server startup reconciliation.",
      },
    });
  });
});
