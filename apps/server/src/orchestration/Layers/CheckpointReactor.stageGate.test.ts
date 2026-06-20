// @effect-diagnostics nodeBuiltinImport:off
//
// WP-2 (slice 3): gate stage completion on a REAL captured diff.
//
// These tests exercise the new stage-completion gate that lives across two
// reactors:
//   - CheckpointReactor settles the active orchestrator stage AFTER a real git
//     diff is captured (status !== "missing"), using a deterministic commandId.
//   - ProviderRuntimeIngestion forks a fail-loud diff-wait timeout that settles
//     the SAME deterministic commandId with diffComplete: false (covered in
//     ProviderRuntimeIngestion.test.ts).
//
// Exactly-once PM re-entry is guaranteed by the engine's command-receipt dedup
// on the shared deterministic commandId — not by any in-memory latch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  ProviderDriverKind,
  ProviderRuntimeEvent,
  ProviderSession,
  ProviderInstanceId,
} from "@t3tools/contracts";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointStoreLive } from "../../checkpointing/Layers/CheckpointStore.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { RepositoryIdentityResolverLive } from "../../project/Layers/RepositoryIdentityResolver.ts";
import { CheckpointReactorLive } from "./CheckpointReactor.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusLive } from "./RuntimeReceiptBus.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { CheckpointReactor } from "../Services/CheckpointReactor.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../provider/Services/ProviderService.ts";
import { ServerConfig } from "../../config.ts";
import { WorkspaceEntriesLive } from "../../workspace/Layers/WorkspaceEntries.ts";
import { WorkspacePathsLive } from "../../workspace/Layers/WorkspacePaths.ts";
import { stageCompleteCommandId } from "../stageResolution.ts";

const asTurnId = (value: string): TurnId => TurnId.make(value);

type LegacyProviderRuntimeEvent = {
  readonly type: string;
  readonly eventId: EventId;
  readonly provider: ProviderDriverKind;
  readonly createdAt: string;
  readonly threadId: ThreadId;
  readonly turnId?: string | undefined;
  readonly payload?: unknown | undefined;
  readonly [key: string]: unknown;
};

// Provider harness whose single session can be re-pointed at any thread id and
// cwd. The stage thread id is minted by the decider at task.stage.start time,
// so the test binds the session to it only after it is known.
function createProviderServiceHarness() {
  const now = "2026-01-01T00:00:00.000Z";
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>());
  const sessionRef: { current: ProviderSession | null } = { current: null };

  const unsupported = <A>() =>
    Effect.die(new Error("Unsupported provider call in test")) as Effect.Effect<A, never>;
  const listSessions = () =>
    Effect.succeed(
      sessionRef.current ? [sessionRef.current] : ([] as ReadonlyArray<ProviderSession>),
    );
  const service: ProviderServiceShape = {
    startSession: () => unsupported(),
    sendTurn: () => unsupported(),
    interruptTurn: () => unsupported(),
    respondToRequest: () => unsupported(),
    respondToUserInput: () => unsupported(),
    stopSession: () => unsupported(),
    listSessions,
    getCapabilities: () => Effect.succeed({ sessionModelSwitch: "in-session" }),
    getInstanceInfo: (instanceId) =>
      Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make("codex"),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make("codex"),
          continuationKey: `codex:instance:${instanceId}`,
        },
      }),
    rollbackConversation: () => Effect.void,
    get streamEvents() {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  };

  const setSession = (threadId: ThreadId, cwd: string): void => {
    sessionRef.current = {
      provider: ProviderDriverKind.make("codex"),
      status: "ready",
      runtimeMode: "full-access",
      threadId,
      cwd,
      createdAt: now,
      updatedAt: now,
    };
  };

  const emit = (event: LegacyProviderRuntimeEvent): void => {
    Effect.runSync(PubSub.publish(runtimeEventPubSub, event as unknown as ProviderRuntimeEvent));
  };

  return { service, emit, setSession };
}

async function waitForEvent(
  engine: OrchestrationEngineShape,
  predicate: (event: { type: string }) => boolean,
  timeoutMs = 15_000,
) {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  const poll = async () => {
    const events = await Effect.runPromise(
      Stream.runCollect(engine.readEvents(0)).pipe(Effect.map((chunk) => Array.from(chunk))),
    );
    if (events.some(predicate)) {
      return events;
    }
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for orchestration event.");
    }
    await Effect.runPromise(Effect.sleep("10 millis"));
    return poll();
  };
  return poll();
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
}

function createGitRepository(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "t3-stage-gate-"));
  runGit(cwd, ["init", "--initial-branch=main"]);
  runGit(cwd, ["config", "user.email", "test@example.com"]);
  runGit(cwd, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(cwd, "README.md"), "v1\n", "utf8");
  runGit(cwd, ["add", "."]);
  runGit(cwd, ["commit", "-m", "Initial"]);
  return cwd;
}

describe("stageCompleteCommandId", () => {
  it("is deterministic for a (stageThreadId, turnId) pair and distinct across inputs", () => {
    const stageThreadId = ThreadId.make("stage-thread-A");
    const turnId = asTurnId("turn-A");
    const first = stageCompleteCommandId(stageThreadId, turnId);
    const second = stageCompleteCommandId(stageThreadId, turnId);
    expect(first).toBe(second);
    expect(first).toBe(CommandId.make("server:task-stage-complete:stage-thread-A:turn-A"));
    expect(stageCompleteCommandId(ThreadId.make("stage-thread-B"), turnId)).not.toBe(first);
    expect(stageCompleteCommandId(stageThreadId, asTurnId("turn-B"))).not.toBe(first);
  });
});

describe("CheckpointReactor stage-completion diff gate", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | CheckpointReactor | CheckpointStore | ProjectionSnapshotQuery,
    unknown
  > | null = null;
  let scope: Scope.Closeable | null = null;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  // Builds a CheckpointReactor harness over a real git repo, then drives the
  // orchestrator command sequence (project enabled -> task.create ->
  // task.classify -> task.stage.start) so a task is in `working` with an active
  // stage thread. Binds the provider session to that stage thread + git cwd so
  // CheckpointReactor resolves the workspace for real capture.
  async function createHarness() {
    const cwd = createGitRepository();
    tempDirs.push(cwd);
    const provider = createProviderServiceHarness();

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(RepositoryIdentityResolverLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const projectionSnapshotLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
      Layer.provide(RepositoryIdentityResolverLive),
      Layer.provide(SqlitePersistenceMemory),
    );
    const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-stage-gate-test-",
    });
    const vcsStatusBroadcasterLayer = Layer.succeed(VcsStatusBroadcaster, {
      getStatus: () => Effect.die("getStatus should not be called in this test"),
      refreshLocalStatus: () =>
        Effect.succeed({
          isRepo: true,
          hasPrimaryRemote: false,
          isDefaultRef: true,
          refName: "main",
          hasWorkingTreeChanges: false,
          workingTree: { files: [], insertions: 0, deletions: 0 },
        }),
      refreshStatus: () => Effect.die("refreshStatus should not be called in this test"),
      streamStatus: () => Stream.empty,
    });

    const layer = CheckpointReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(projectionSnapshotLayer),
      Layer.provideMerge(RuntimeReceiptBusLive),
      Layer.provideMerge(Layer.succeed(ProviderService, provider.service)),
      Layer.provideMerge(vcsStatusBroadcasterLayer),
      Layer.provideMerge(CheckpointStoreLive.pipe(Layer.provide(VcsDriverRegistry.layer))),
      Layer.provideMerge(
        WorkspaceEntriesLive.pipe(
          Layer.provide(WorkspacePathsLive),
          Layer.provideMerge(VcsDriverRegistry.layer),
        ),
      ),
      Layer.provideMerge(WorkspacePathsLive),
      Layer.provideMerge(VcsProcess.layer),
      Layer.provideMerge(ServerConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const snapshotQuery = await runtime.runPromise(Effect.service(ProjectionSnapshotQuery));
    const reactor = await runtime.runPromise(Effect.service(CheckpointReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)));
    const drain = () => Effect.runPromise(reactor.drain);

    const createdAt = "2026-01-01T00:00:00.000Z";
    // Orchestrator-enabled project rooted at the real git repo.
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.make("cmd-stage-gate-project"),
        projectId: ProjectId.make("project-stage-gate"),
        title: "Stage Gate Project",
        workspaceRoot: cwd,
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        orchestratorConfig: { enabled: true },
        createdAt,
      }),
    );

    const readModel = () => Effect.runPromise(snapshotQuery.getSnapshot());

    return { engine, readModel, provider, cwd, drain };
  }

  // Drives task.create -> task.classify -> task.stage.start (role: work) and
  // returns the active stage thread id, with the provider session bound to it
  // at the git repo cwd so the reactor can capture real diffs.
  async function startWorkingStage(harness: {
    engine: OrchestrationEngineShape;
    readModel: () => Promise<{
      tasks: ReadonlyArray<{
        readonly id: TaskId;
        readonly status: string;
        readonly currentStageThreadId: ThreadId | null;
      }>;
    }>;
    provider: ReturnType<typeof createProviderServiceHarness>;
    cwd: string;
  }): Promise<ThreadId> {
    const createdAt = "2026-01-01T00:00:00.000Z";
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "task.create",
        commandId: CommandId.make("cmd-stage-gate-task-create"),
        taskId: TaskId.make("task-stage-gate"),
        projectId: ProjectId.make("project-stage-gate"),
        taskType: TaskTypeId.make("feature"),
        title: "Stage gate task",
        pmMessageId: null,
        branch: "orchestrator/task-stage-gate",
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "task.classify",
        commandId: CommandId.make("cmd-stage-gate-task-classify"),
        taskId: TaskId.make("task-stage-gate"),
        taskType: TaskTypeId.make("feature"),
        playbookVersion: "feature@v1",
        createdAt,
      }),
    );
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "task.stage.start",
        commandId: CommandId.make("cmd-stage-gate-task-stage-start"),
        taskId: TaskId.make("task-stage-gate"),
        role: "work",
        instructions: "Implement the task.",
        createdAt,
      }),
    );

    const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + 15_000;
    const poll = async (): Promise<ThreadId> => {
      const snapshot = await harness.readModel();
      const task = snapshot.tasks.find((entry) => entry.id === TaskId.make("task-stage-gate"));
      if (task && task.status === "working" && task.currentStageThreadId !== null) {
        return task.currentStageThreadId;
      }
      if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
        throw new Error("Timed out waiting for working stage.");
      }
      await Effect.runPromise(Effect.sleep("10 millis"));
      return poll();
    };
    const stageThreadId = await poll();
    harness.provider.setSession(stageThreadId, harness.cwd);
    return stageThreadId;
  }

  it("settles the active stage with the deterministic commandId and absent diffComplete after a real diff", async () => {
    const harness = await createHarness();
    const stageThreadId = await startWorkingStage(harness);
    const turnId = asTurnId("turn-stage-gate-1");

    // Establish the pre-turn baseline, mutate the worktree, then complete.
    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-stage-gate-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: stageThreadId,
      turnId,
    });
    await harness.drain();

    fs.writeFileSync(path.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-stage-gate-completed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: stageThreadId,
      turnId,
      payload: { state: "completed" },
    });

    const events = await waitForEvent(
      harness.engine,
      (event) => event.type === "task.stage-completed",
    );
    const stageCompletedEvents = events.filter((event) => event.type === "task.stage-completed");
    expect(stageCompletedEvents).toHaveLength(1);
    const stageCompleted = stageCompletedEvents[0];
    expect(stageCompleted?.type).toBe("task.stage-completed");
    if (stageCompleted?.type === "task.stage-completed") {
      // Real diff present at completion -> diffComplete stays absent.
      expect(stageCompleted.payload.diffComplete).toBeUndefined();
      expect(stageCompleted.payload.stageThreadId).toBe(stageThreadId);
      expect(stageCompleted.commandId).toBe(stageCompleteCommandId(stageThreadId, turnId));
    }
  });

  it("dedups the timeout path against the diff path on the shared deterministic commandId", async () => {
    const harness = await createHarness();
    const stageThreadId = await startWorkingStage(harness);
    const turnId = asTurnId("turn-stage-gate-dedup");

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-stage-gate-dedup-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: stageThreadId,
      turnId,
    });
    await harness.drain();

    fs.writeFileSync(path.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-stage-gate-dedup-completed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: stageThreadId,
      turnId,
      payload: { state: "completed" },
    });

    await waitForEvent(harness.engine, (event) => event.type === "task.stage-completed");

    // Simulate the fail-loud timeout path firing the SAME deterministic
    // commandId with diffComplete: false. It must dedup against the diff path's
    // already-accepted receipt and emit NO second event (exactly-once re-entry).
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "task.stage.complete",
        commandId: stageCompleteCommandId(stageThreadId, turnId),
        taskId: TaskId.make("task-stage-gate"),
        role: "work",
        stageThreadId,
        awaitedTurnId: turnId,
        diffComplete: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    expect(events.filter((event) => event.type === "task.stage-completed")).toHaveLength(1);
  });

  it("does not settle any stage when no task owns the completing thread", async () => {
    const harness = await createHarness();
    // A plain (non-stage) thread bound to the git repo; no task references it.
    const createdAt = "2026-01-01T00:00:00.000Z";
    const plainThreadId = ThreadId.make("plain-thread-no-task");
    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.create",
        commandId: CommandId.make("cmd-stage-gate-plain-thread"),
        threadId: plainThreadId,
        projectId: ProjectId.make("project-stage-gate"),
        title: "Plain thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: harness.cwd,
        createdAt,
      }),
    );
    harness.provider.setSession(plainThreadId, harness.cwd);
    const turnId = asTurnId("turn-plain-1");

    harness.provider.emit({
      type: "turn.started",
      eventId: EventId.make("evt-plain-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt,
      threadId: plainThreadId,
      turnId,
    });
    await harness.drain();

    fs.writeFileSync(path.join(harness.cwd, "README.md"), "v2\n", "utf8");
    harness.provider.emit({
      type: "turn.completed",
      eventId: EventId.make("evt-plain-completed"),
      provider: ProviderDriverKind.make("codex"),
      createdAt,
      threadId: plainThreadId,
      turnId,
      payload: { state: "completed" },
    });

    // The real diff is still captured for the plain thread...
    await waitForEvent(harness.engine, (event) => event.type === "thread.turn-diff-completed");
    await harness.drain();

    // ...but no task owns it, so NO task.stage-completed is ever emitted.
    const events = await Effect.runPromise(
      Stream.runCollect(harness.engine.readEvents(0)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      ),
    );
    expect(events.filter((event) => event.type === "task.stage-completed")).toHaveLength(0);
  });
});
