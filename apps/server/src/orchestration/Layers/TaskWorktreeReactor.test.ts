// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  type ChangeRequest,
  CommandId,
  EventId,
  GitCommandError,
  ProviderInstanceId,
  ProjectId,
  SourceControlProviderError,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Metric from "effect/Metric";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitWorkflowService, type GitWorkflowServiceShape } from "../../git/GitWorkflowService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as SourceControlProvider from "../../sourceControl/SourceControlProvider.ts";
import {
  SourceControlProviderRegistry,
  type SourceControlProviderRegistryShape,
} from "../../sourceControl/SourceControlProviderRegistry.ts";
import { VcsProcess, type VcsProcessShape } from "../../vcs/VcsProcess.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TaskWorktreeReactor } from "../Services/TaskWorktreeReactor.ts";
import {
  isDeterministicTaskWorktreePath,
  makeTaskWorktreeReactorLive,
} from "./TaskWorktreeReactor.ts";

const now = "2026-06-15T09:00:00.000Z";
const projectId = ProjectId.make("project-1");
const taskId = TaskId.make("task-1");
const taskType = TaskTypeId.make("feature");
const providerInstanceId = ProviderInstanceId.make("codex");
const stageThreadId = ThreadId.make("thread-stage");

const unsupportedProjectionQuery = () =>
  Effect.die(new Error("unsupported projection query call")) as never;

function makeReadModel(input: {
  readonly workspaceRoot: string;
  readonly worktreePath: string | null;
  readonly taskStatus: OrchestrationReadModel["tasks"][number]["status"];
  readonly prUrl?: string | null;
  readonly openPrAsDraft?: boolean;
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
        orchestratorConfig: {
          enabled: true,
          ...(input.openPrAsDraft !== undefined ? { openPrAsDraft: input.openPrAsDraft } : {}),
        },
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: stageThreadId,
        projectId,
        title: "Task stage",
        modelSelection: {
          instanceId: providerInstanceId,
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "orchestrator/task-1",
        worktreePath: input.worktreePath,
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
      },
    ],
    tasks: [
      {
        id: taskId,
        projectId,
        type: taskType,
        title: "Task",
        status: input.taskStatus,
        branch: "orchestrator/task-1",
        worktreePath: input.worktreePath,
        prUrl: input.prUrl ?? null,
        pmMessageId: null,
        stageThreadIds: [stageThreadId],
        currentStageThreadId: null,
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

function taskWorktreePath(workspaceRoot: string, id: string) {
  return path.join(workspaceRoot, ".gedcode", "orchestrator", "tasks", id);
}

const createdChangeRequest: ChangeRequest = {
  provider: "github",
  number: 42,
  title: "Task",
  url: "https://github.com/acme/repo/pull/42",
  baseRefName: "main",
  headRefName: "orchestrator/task-1",
  state: "open",
  updatedAt: Option.none(),
};

async function createHarness(input: {
  readonly readModel: OrchestrationReadModel;
  readonly eventPubSub?: PubSub.PubSub<OrchestrationEvent>;
  readonly reaperIntervalMsOverride?: number;
  readonly useTestClock?: boolean;
  readonly serverSettingsOverrides?: Parameters<typeof ServerSettingsService.layerTest>[0];
  readonly sourceControlProvider?: SourceControlProvider.SourceControlProviderShape;
  readonly resolveHandle?: SourceControlProviderRegistryShape["resolveHandle"];
  readonly dispatch?: OrchestrationEngineShape["dispatch"];
  readonly pushCurrentBranch?: GitWorkflowServiceShape["pushCurrentBranch"];
  readonly readRangeContext?: GitWorkflowServiceShape["readRangeContext"];
}) {
  const readModelRef = { current: input.readModel };
  const eventPubSub = input.eventPubSub ?? Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
  const order: string[] = [];
  const removeWorktree = vi.fn<GitWorkflowServiceShape["removeWorktree"]>(() => Effect.void);
  const pushCurrentBranch = vi.fn<GitWorkflowServiceShape["pushCurrentBranch"]>(
    input.pushCurrentBranch ??
      (() => {
        order.push("push");
        return Effect.succeed({
          status: "pushed",
          branch: "orchestrator/task-1",
          upstreamBranch: "origin/orchestrator/task-1",
          setUpstream: true,
        });
      }),
  );
  const readRangeContext = vi.fn<GitWorkflowServiceShape["readRangeContext"]>(
    input.readRangeContext ??
      (() =>
        Effect.succeed({
          commitSummary: "- Implement task landing",
          diffSummary: " 2 files changed, 10 insertions(+)",
          diffPatch: "",
        })),
  );
  const vcsProcessRun = vi.fn<VcsProcessShape["run"]>(() => Effect.succeed(processOutput()));
  const createChangeRequest = vi.fn<
    SourceControlProvider.SourceControlProviderShape["createChangeRequest"]
  >((request) => {
    order.push("createChangeRequest");
    return Effect.succeed({
      ...createdChangeRequest,
      title: request.title,
      baseRefName: request.baseRefName,
      headRefName: request.headSelector,
    });
  });
  const sourceControlProvider =
    input.sourceControlProvider ??
    SourceControlProvider.SourceControlProvider.of({
      kind: "github",
      listChangeRequests: () => Effect.succeed([]),
      getChangeRequest: () => Effect.succeed(createdChangeRequest),
      createChangeRequest,
      getRepositoryCloneUrls: () => unsupportedProjectionQuery(),
      createRepository: () => unsupportedProjectionQuery(),
      getDefaultBranch: () => Effect.succeed("main"),
      checkoutChangeRequest: () => Effect.void,
    });
  const resolveHandle = vi.fn<SourceControlProviderRegistryShape["resolveHandle"]>(
    input.resolveHandle ??
      (() =>
        Effect.succeed({
          provider: sourceControlProvider,
          context: {
            provider: {
              kind: "github",
              name: "GitHub",
              baseUrl: "https://github.com",
            },
            remoteName: "origin",
            remoteUrl: "git@github.com:acme/repo.git",
          },
        })),
  );
  const dispatch = vi.fn<OrchestrationEngineShape["dispatch"]>(
    input.dispatch ??
      ((command) => {
        if (command.type === "task.pr.opened") {
          order.push("dispatchPrOpened");
        }
        return Effect.succeed({ sequence: 10 });
      }),
  );
  // Fresh per-harness metric registry isolates WP-6 counters from the
  // process-global default registry that other tests also write to.
  const metricRegistry = new Map();
  const platformLayer = input.useTestClock
    ? Layer.mergeAll(NodeServices.layer, TestClock.layer())
    : NodeServices.layer;
  const metricRegistryLayer = Layer.succeed(Metric.MetricRegistry, metricRegistry);
  const reactorLayer = makeTaskWorktreeReactorLive({
    reaperIntervalMsOverride: input.reaperIntervalMsOverride ?? 60_000,
    landingMaxAttemptsOverride: 1,
    landingRetryDelayMsOverride: 1,
  }).pipe(
    Layer.provide(makeProjectionSnapshotQueryLayer(readModelRef)),
    Layer.provide(
      Layer.succeed(OrchestrationEngineService, {
        readEvents: () => Stream.empty,
        dispatch,
        streamDomainEvents: Stream.fromPubSub(eventPubSub),
        streamShellEvents: Stream.empty,
      }),
    ),
    Layer.provide(
      Layer.mock(GitWorkflowService)({
        removeWorktree,
        pushCurrentBranch,
        readRangeContext,
      } satisfies Partial<GitWorkflowServiceShape>),
    ),
    Layer.provide(
      Layer.succeed(SourceControlProviderRegistry, {
        get: () => Effect.succeed(sourceControlProvider),
        resolveHandle,
        resolve: (request) => resolveHandle(request).pipe(Effect.map((handle) => handle.provider)),
        discover: Effect.succeed([]),
      }),
    ),
    Layer.provide(
      Layer.succeed(VcsProcess, {
        run: vcsProcessRun,
      }),
    ),
    Layer.provide(ServerSettingsService.layerTest(input.serverSettingsOverrides ?? {})),
    Layer.provide(platformLayer),
  );
  const runtimeLayer = input.useTestClock
    ? Layer.mergeAll(reactorLayer, metricRegistryLayer, TestClock.layer())
    : Layer.merge(reactorLayer, metricRegistryLayer);
  const runtime = ManagedRuntime.make(runtimeLayer);
  const reactor = await runtime.runPromise(Effect.service(TaskWorktreeReactor));
  const scope = await Effect.runPromise(Scope.make("sequential"));
  return {
    runtime,
    reactor,
    scope,
    readModelRef,
    eventPubSub,
    removeWorktree,
    pushCurrentBranch,
    readRangeContext,
    createChangeRequest,
    resolveHandle,
    dispatch,
    vcsProcessRun,
    metricRegistry,
    order,
  };
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
    const worktreePath = taskWorktreePath(workspaceRoot, String(taskId));
    fs.mkdirSync(worktreePath, { recursive: true });
    return { workspaceRoot, worktreePath };
  }

  function makeEmptyWorkspace() {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gedcode-task-wt-"));
    createdDirs.add(workspaceRoot);
    return workspaceRoot;
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

  it("pushes, opens a draft PR, records it, then cleans a landed task worktree", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const eventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const harness = await createHarness({
      eventPubSub,
      readModel: makeReadModel({
        workspaceRoot,
        worktreePath,
        taskStatus: "working",
        openPrAsDraft: true,
      }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    harness.readModelRef.current = makeReadModel({
      workspaceRoot,
      worktreePath,
      taskStatus: "landed",
      openPrAsDraft: true,
    });
    await Effect.runPromise(PubSub.publish(eventPubSub, makeTerminalTaskEvent("task.landed")));
    await waitFor(() => harness.removeWorktree.mock.calls.length === 1);
    await harness.runtime.runPromise(harness.reactor.drain);

    expect(harness.resolveHandle).toHaveBeenCalledWith({ cwd: worktreePath });
    expect(harness.pushCurrentBranch).toHaveBeenCalledWith({
      cwd: worktreePath,
      fallbackBranch: "orchestrator/task-1",
      remoteName: "origin",
    });
    expect(harness.createChangeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: worktreePath,
        baseRefName: "main",
        headSelector: "orchestrator/task-1",
        title: "Task",
        draft: true,
      }),
    );
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.pr.opened",
        commandId: CommandId.make("task-pr-opened:task-1"),
        taskId,
        prUrl: "https://github.com/acme/repo/pull/42",
        prNumber: 42,
      }),
    );
    expect(harness.order).toEqual(["push", "createChangeRequest", "dispatchPrOpened"]);
    expect(harness.removeWorktree).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      path: worktreePath,
      force: true,
    });

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("resolves draft PRs from global defaults when the project omits the setting", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const eventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const harness = await createHarness({
      eventPubSub,
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
      serverSettingsOverrides: {
        orchestratorDefaults: {
          openPrAsDraft: true,
        },
      },
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    harness.readModelRef.current = makeReadModel({
      workspaceRoot,
      worktreePath,
      taskStatus: "landed",
    });
    await Effect.runPromise(PubSub.publish(eventPubSub, makeTerminalTaskEvent("task.landed")));
    await waitFor(() => harness.createChangeRequest.mock.calls.length === 1);
    await harness.runtime.runPromise(harness.reactor.drain);

    expect(harness.createChangeRequest.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ draft: true }),
    );

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("does not open a duplicate PR when the landed task already has a prUrl", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const harness = await createHarness({
      readModel: makeReadModel({
        workspaceRoot,
        worktreePath,
        taskStatus: "landed",
        prUrl: "https://github.com/acme/repo/pull/42",
      }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));

    expect(harness.pushCurrentBranch).not.toHaveBeenCalled();
    expect(harness.createChangeRequest).not.toHaveBeenCalled();
    expect(harness.removeWorktree).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      path: worktreePath,
      force: true,
    });

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("fails loud and keeps the worktree when the source-control provider is unsupported", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const unsupportedProvider = SourceControlProvider.SourceControlProvider.of({
      kind: "unknown",
      listChangeRequests: () => Effect.succeed([]),
      getChangeRequest: () =>
        Effect.fail(
          new SourceControlProviderError({
            provider: "unknown",
            operation: "getChangeRequest",
            detail: "unsupported",
          }),
        ),
      createChangeRequest: () =>
        Effect.fail(
          new SourceControlProviderError({
            provider: "unknown",
            operation: "createChangeRequest",
            detail: "unsupported",
          }),
        ),
      getRepositoryCloneUrls: () => unsupportedProjectionQuery(),
      createRepository: () => unsupportedProjectionQuery(),
      getDefaultBranch: () => Effect.succeed(null),
      checkoutChangeRequest: () => Effect.void,
    });
    const eventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const harness = await createHarness({
      eventPubSub,
      sourceControlProvider: unsupportedProvider,
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    harness.readModelRef.current = makeReadModel({
      workspaceRoot,
      worktreePath,
      taskStatus: "landed",
    });
    await Effect.runPromise(PubSub.publish(eventPubSub, makeTerminalTaskEvent("task.landed")));
    await waitFor(() => harness.dispatch.mock.calls.length === 1);
    await harness.runtime.runPromise(harness.reactor.drain);

    expect(harness.pushCurrentBranch).not.toHaveBeenCalled();
    expect(harness.createChangeRequest).not.toHaveBeenCalled();
    expect(harness.removeWorktree).not.toHaveBeenCalled();
    expect(harness.dispatch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "thread.activity.append",
        commandId: CommandId.make("task-pr-open-failed:task-1"),
      }),
    );

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("fails loud and keeps the worktree when push fails", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const eventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const harness = await createHarness({
      eventPubSub,
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
      pushCurrentBranch: () =>
        Effect.fail(
          new GitCommandError({
            operation: "pushCurrentBranch",
            command: "git push",
            cwd: worktreePath,
            detail: "denied",
          }),
        ),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    harness.readModelRef.current = makeReadModel({
      workspaceRoot,
      worktreePath,
      taskStatus: "landed",
    });
    await Effect.runPromise(PubSub.publish(eventPubSub, makeTerminalTaskEvent("task.landed")));
    await waitFor(() => harness.dispatch.mock.calls.length === 1);
    await harness.runtime.runPromise(harness.reactor.drain);

    expect(harness.createChangeRequest).not.toHaveBeenCalled();
    expect(harness.removeWorktree).not.toHaveBeenCalled();
    expect(harness.dispatch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "thread.activity.append",
        activity: expect.objectContaining({
          summary: expect.stringContaining("branch pushed: no"),
        }),
      }),
    );

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("fails loud and keeps the worktree when PR creation fails after push", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const failingProvider = SourceControlProvider.SourceControlProvider.of({
      kind: "github",
      listChangeRequests: () => Effect.succeed([]),
      getChangeRequest: () => Effect.succeed(createdChangeRequest),
      createChangeRequest: () =>
        Effect.fail(
          new SourceControlProviderError({
            provider: "github",
            operation: "createChangeRequest",
            detail: "network down",
          }),
        ),
      getRepositoryCloneUrls: () => unsupportedProjectionQuery(),
      createRepository: () => unsupportedProjectionQuery(),
      getDefaultBranch: () => Effect.succeed("main"),
      checkoutChangeRequest: () => Effect.void,
    });
    const eventPubSub = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());
    const harness = await createHarness({
      eventPubSub,
      sourceControlProvider: failingProvider,
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    harness.readModelRef.current = makeReadModel({
      workspaceRoot,
      worktreePath,
      taskStatus: "landed",
    });
    await Effect.runPromise(PubSub.publish(eventPubSub, makeTerminalTaskEvent("task.landed")));
    await waitFor(() => harness.dispatch.mock.calls.length === 1);
    await harness.runtime.runPromise(harness.reactor.drain);

    expect(harness.pushCurrentBranch).toHaveBeenCalled();
    expect(harness.removeWorktree).not.toHaveBeenCalled();
    expect(harness.dispatch.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        type: "thread.activity.append",
        activity: expect.objectContaining({
          summary: expect.stringContaining("branch pushed: yes"),
        }),
      }),
    );

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

  it("reaps an unowned deterministic task worktree from the filesystem scan", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const orphanTaskId = "orphan-task";
    const orphanPath = taskWorktreePath(workspaceRoot, orphanTaskId);
    fs.mkdirSync(orphanPath, { recursive: true });
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await waitFor(() => harness.removeWorktree.mock.calls.length === 1);

    expect(harness.removeWorktree).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      path: orphanPath,
      force: true,
    });

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("does not reap a deterministic worktree owned by a live task", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    expect(harness.removeWorktree).not.toHaveBeenCalled();

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("treats a missing task worktree directory as an empty scan", async () => {
    const workspaceRoot = makeEmptyWorkspace();
    const worktreePath = taskWorktreePath(workspaceRoot, String(taskId));
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    expect(harness.removeWorktree).not.toHaveBeenCalled();
    expect(harness.vcsProcessRun).not.toHaveBeenCalled();

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("does not remove a terminal worktree twice when startup cleanup and reaper both see it", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "abandoned" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);

    expect(harness.removeWorktree).toHaveBeenCalledTimes(1);

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("records the orphans-removed durability metric for a reaped worktree", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const orphanTaskId = "orphan-task";
    const orphanPath = taskWorktreePath(workspaceRoot, orphanTaskId);
    fs.mkdirSync(orphanPath, { recursive: true });
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await waitFor(() => harness.removeWorktree.mock.calls.length === 1);

    const snapshots = await harness.runtime.runPromise(Metric.snapshot);
    const removed = snapshots.find(
      (entry): entry is Extract<Metric.Metric.Snapshot, { readonly type: "Counter" }> =>
        entry.type === "Counter" &&
        entry.id === "t3_orchestration_worktree_reaper_orphans_removed_total" &&
        entry.attributes?.reason === "orphaned",
    );
    expect(Number(removed?.state.count ?? 0)).toBe(1);

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });

  it("runs the periodic orphan reaper on the configured interval", async () => {
    const { workspaceRoot, worktreePath } = makeWorkspace();
    const harness = await createHarness({
      readModel: makeReadModel({ workspaceRoot, worktreePath, taskStatus: "working" }),
      reaperIntervalMsOverride: 10,
      useTestClock: true,
    });

    await harness.runtime.runPromise(harness.reactor.start().pipe(Scope.provide(harness.scope)));
    await harness.runtime.runPromise(Effect.yieldNow);
    expect(harness.removeWorktree).not.toHaveBeenCalled();

    const orphanPath = taskWorktreePath(workspaceRoot, "late-orphan");
    fs.mkdirSync(orphanPath, { recursive: true });
    await harness.runtime.runPromise(TestClock.adjust(Duration.millis(10)));
    await waitFor(() => harness.removeWorktree.mock.calls.length === 1);

    expect(harness.removeWorktree).toHaveBeenCalledWith({
      cwd: workspaceRoot,
      path: orphanPath,
      force: true,
    });

    await Effect.runPromise(Scope.close(harness.scope, Exit.void));
    await harness.runtime.dispose();
  });
});
