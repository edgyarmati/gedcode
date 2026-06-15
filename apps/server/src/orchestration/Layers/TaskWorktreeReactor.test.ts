// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CommandId,
  EventId,
  ProviderInstanceId,
  ProjectId,
  TaskId,
  TaskTypeId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import { ChildProcessSpawner } from "effect/unstable/process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitWorkflowService, type GitWorkflowServiceShape } from "../../git/GitWorkflowService.ts";
import { VcsProcess, type VcsProcessShape } from "../../vcs/VcsProcess.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TaskWorktreeReactor } from "../Services/TaskWorktreeReactor.ts";
import { isDeterministicTaskWorktreePath, TaskWorktreeReactorLive } from "./TaskWorktreeReactor.ts";

const now = "2026-06-15T09:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const taskType = TaskTypeId.make("feature");
const providerInstanceId = ProviderInstanceId.make("codex");

const unsupportedProjectionQuery = () =>
  Effect.die(new Error("unsupported projection query call")) as never;
const unsupportedGitWorkflowCall = () =>
  Effect.die(new Error("unsupported git workflow call")) as never;

function makeReadModel(input: {
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly taskStatus: OrchestrationReadModel["tasks"][number]["status"];
}): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: projectId,
        title: "Project",
        workspaceRoot: input.workspaceRoot,
        defaultModelSelection: {
          instanceId: providerInstanceId,
          model: "gpt-5-codex",
        },
        roleModelSelections: {},
        orchestratorConfig: { enabled: true },
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [],
    tasks: [
      {
        id: taskId,
        projectId,
        type: taskType,
        title: "Task",
        status: input.taskStatus,
        branch: "orchestrator/task-1",
        worktreePath: input.worktreePath,
        pmMessageId: null,
        stageThreadIds: [],
        currentStageThreadId: null,
        playbookVersion: "feature@v1",
        createdAt: now,
        updatedAt: now,
      },
    ],
    pendingGates: [],
    updatedAt: now,
  };
}

function makeTerminalTaskEvent(type: "task.landed" | "task.abandoned"): OrchestrationEvent {
  return {
    sequence: 2,
    eventId: EventId.make(`evt-${type}`),
    aggregateKind: "task",
    aggregateId: taskId,
    type,
    occurredAt: now,
    commandId: CommandId.make(`cmd-${type}`),
    causationEventId: null,
    correlationId: CommandId.make(`cmd-${type}`),
    metadata: {},
    payload: {
      taskId,
      updatedAt: now,
    },
  };
}

function makeProjectionSnapshotQueryLayer(readModelRef: { current: OrchestrationReadModel }) {
  return Layer.succeed(ProjectionSnapshotQuery, {
    getCommandReadModel: () => Effect.succeed(readModelRef.current),
    getSnapshot: () => Effect.succeed(readModelRef.current),
    getShellSnapshot: () => unsupportedProjectionQuery(),
    getArchivedShellSnapshot: () => unsupportedProjectionQuery(),
    getSnapshotSequence: () => unsupportedProjectionQuery(),
    getCounts: () => unsupportedProjectionQuery(),
    getActiveProjectByWorkspaceRoot: () => unsupportedProjectionQuery(),
    getProjectShellById: () => unsupportedProjectionQuery(),
    getFirstActiveThreadIdByProjectId: () => unsupportedProjectionQuery(),
    getThreadCheckpointContext: () => unsupportedProjectionQuery(),
    getFullThreadDiffContext: () => unsupportedProjectionQuery(),
    getThreadShellById: () => unsupportedProjectionQuery(),
    getThreadDetailById: () => unsupportedProjectionQuery(),
  });
}

function processOutput() {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = (await Effect.runPromise(Clock.currentTimeMillis)) + timeoutMs;
  while (!predicate()) {
    if ((await Effect.runPromise(Clock.currentTimeMillis)) >= deadline) {
      throw new Error("Timed out waiting for expectation.");
    }
    await Effect.runPromise(Effect.sleep(Duration.millis(1)));
  }
}

async function createHarness(input: {
  readonly readModel: OrchestrationReadModel;
  readonly eventPubSub?: PubSub.PubSub<OrchestrationEvent>;
}) {
  const readModelRef = { current: input.readModel };
  const eventPubSub = input.eventPubSub ?? Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
  const removeWorktree = vi.fn<GitWorkflowServiceShape["removeWorktree"]>(() => Effect.void);
  const vcsProcessRun = vi.fn<VcsProcessShape["run"]>(() => Effect.succeed(processOutput()));
  const runtime = ManagedRuntime.make(
    TaskWorktreeReactorLive.pipe(
      Layer.provide(makeProjectionSnapshotQueryLayer(readModelRef)),
      Layer.provide(
        Layer.succeed(OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: () => unsupportedGitWorkflowCall(),
          streamDomainEvents: Stream.fromPubSub(eventPubSub),
          streamShellEvents: Stream.empty,
        }),
      ),
      Layer.provide(
        Layer.mock(GitWorkflowService)({
          removeWorktree,
        } satisfies Partial<GitWorkflowServiceShape>),
      ),
      Layer.provide(
        Layer.succeed(VcsProcess, {
          run: vcsProcessRun,
        }),
      ),
      Layer.provide(NodeServices.layer),
    ),
  );
  const reactor = await runtime.runPromise(Effect.service(TaskWorktreeReactor));
  const scope = await Effect.runPromise(Scope.make("sequential"));
  return { runtime, reactor, scope, readModelRef, eventPubSub, removeWorktree, vcsProcessRun };
}

describe("TaskWorktreeReactor", () => {
  const createdDirs = new Set<string>();

  afterEach(() => {
    for (const dir of createdDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    createdDirs.clear();
  });

  function makeWorkspace() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gedcode-task-wt-"));
    createdDirs.add(workspaceRoot);
    const worktreePath = path.join(
      workspaceRoot,
      ".gedcode",
      "orchestrator",
      "tasks",
      String(taskId),
    );
    fs.mkdirSync(worktreePath, { recursive: true });
    return { workspaceRoot, worktreePath };
  }

  it("recognizes only deterministic task worktree paths", () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    expect(
      isDeterministicTaskWorktreePath({
        workspaceRoot,
        taskId: String(taskId),
        worktreePath,
      }),
    ).toBe(true);
    expect(
      isDeterministicTaskWorktreePath({
        workspaceRoot,
        taskId: String(taskId),
        worktreePath: path.join(workspaceRoot, ".gedcode", "other", String(taskId)),
      }),
    ).toBe(false);
  });

  it("sweeps terminal task worktrees on startup", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "abandoned" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));

    expect(harness.removeWorktree).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      path: worktreePath,
      force: true,
    });
    expect(harness.vcsProcessRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "git",
        args: ["worktree", "prune"],
        cwd: workspaceRoot,
      }),
    );

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("cleans task worktrees when terminal task events arrive", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const eventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const harness = await createHarness({
      eventPubSub,
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);
    expect(harness.removeWorktree).not.toHaveBeenCalled();

    harness.readModelRef.current = makeReadModel({
      workspaceRoot,
      worktreePath,
      taskStatus: "abandoned",
    });
    await Effect.runPromise(PubSub.publish(eventPubSub, makeTerminalTaskEvent("task.abandoned")));
    await waitFor(() => harness.removeWorktree.mock.calls.length === 1);
    await harness.runtime.runPromise(harness.reactor.drain);

    expect(harness.removeWorktree).toHaveBeenCalledTimes(1);
    expect(harness.removeWorktree).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      path: worktreePath,
      force: true,
    });
    expect(harness.vcsProcessRun).toHaveBeenCalledTimes(1);

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("skips non-deterministic terminal task paths", async () => {
    const { workspaceRoot } = makeWorkspace();
    const unsafePath = path.join(workspaceRoot, "not-a-task-worktree");
    fs.mkdirSync(unsafePath, { recursive: true });
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath: unsafePath, taskStatus: "landed" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));

    expect(harness.removeWorktree).not.toHaveBeenCalled();
    expect(harness.vcsProcessRun).not.toHaveBeenCalled();

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });
});
