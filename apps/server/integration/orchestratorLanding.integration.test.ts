// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

import {
  CommandId,
  EventId,
  GateId,
  GitCommandError,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  SourceControlProviderError,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type ChangeRequest,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationTask,
  type OrchestratorConfigJson,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";
import * as SourceControlProvider from "../src/sourceControl/SourceControlProvider.ts";
import type {
  SourceControlProviderRegistryShape,
  SourceControlProviderHandle,
} from "../src/sourceControl/SourceControlProviderRegistry.ts";
import { landOrchestrationTaskWithServices } from "../src/orchestration/taskLanding.ts";

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const DEFAULT_INSTANCE = ProviderInstanceId.make("codex");
const TASK_TYPE = TaskTypeId.make("feature");
const DEFAULT_SELECTION: ModelSelection = {
  instanceId: DEFAULT_INSTANCE,
  model: "gpt-5-landing",
};

const iso = (seconds: number) => `2026-06-24T12:00:${String(seconds).padStart(2, "0")}.000Z`;
const commandId = (suffix: string) => CommandId.make(`cmd-landing-${suffix}`);
const eventId = (suffix: string) => EventId.make(`evt-landing-${suffix}`);
const gateId = (suffix: string) => GateId.make(`gate-landing-${suffix}`);
const projectId = (suffix: string) => ProjectId.make(`project-landing-${suffix}`);
const taskId = (suffix: string) => TaskId.make(`task-landing-${suffix}`);

const fakePrUrl = "https://github.com/acme/repo/pull/42";

class IntegrationProjectionTimeoutError extends Error {
  constructor(description: string) {
    super(`Timed out waiting for ${description}.`);
  }
}

function runGit(cwd: string, args: ReadonlyArray<string>) {
  return execFileSync("git", args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function ensureGitWorktree(input: {
  readonly workspaceDir: string;
  readonly branch: string;
  readonly worktreePath: string;
}) {
  if (existsSync(input.worktreePath)) {
    return;
  }
  runGit(input.workspaceDir, ["worktree", "add", "-b", input.branch, input.worktreePath, "HEAD"]);
}

function runtimeBase(suffix: string, createdAt: string) {
  return {
    eventId: eventId(suffix),
    provider: CODEX_PROVIDER,
    createdAt,
    threadId: ThreadId.make("fixture-landing-thread"),
    turnId: TurnId.make("fixture-landing-turn"),
  };
}

function successfulTurnResponse(label: string, createdAt: string): TestTurnResponse {
  return {
    events: [
      {
        type: "turn.started",
        ...runtimeBase(`${label}-turn-started`, createdAt),
      },
      {
        type: "message.delta",
        ...runtimeBase(`${label}-message-delta`, createdAt),
        delta: `${label} complete.\n`,
      },
      {
        type: "turn.completed",
        ...runtimeBase(`${label}-turn-completed`, createdAt),
        status: "completed",
      },
    ],
  };
}

function waitForProjection<A, B extends A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => value is B,
  description: string,
  timeoutMs?: number,
): Effect.Effect<B, never>;
function waitForProjection<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs?: number,
): Effect.Effect<A, never> {
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + (timeoutMs ?? 30_000);
    while (true) {
      const value = yield* read.pipe(Effect.orDie);
      if (predicate(value)) {
        return value;
      }
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        return yield* Effect.die(new IntegrationProjectionTimeoutError(description));
      }
      yield* Effect.sleep(10);
    }
  });
}

function waitForTask(
  harness: OrchestrationIntegrationHarness,
  id: TaskId,
  predicate: (task: OrchestrationTask) => boolean,
  description: string,
): Effect.Effect<OrchestrationTask, never> {
  return waitForProjection(
    harness.snapshotQuery
      .getSnapshot()
      .pipe(Effect.map((snapshot) => snapshot.tasks.find((task) => task.id === id) ?? null)),
    (task): task is OrchestrationTask => task !== null && predicate(task),
    description,
  );
}

function readAllEvents(
  harness: OrchestrationIntegrationHarness,
): Effect.Effect<ReadonlyArray<OrchestrationEvent>, never> {
  return Stream.runCollect(harness.engine.readEvents(0)).pipe(
    Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk)),
    Effect.orDie,
  );
}

function waitForWorktreeRemoved(path: string): Effect.Effect<void, never> {
  return waitForProjection(
    Effect.sync(() => existsSync(path)),
    (exists): exists is false => !exists,
    `worktree '${path}' to be removed`,
  ).pipe(Effect.asVoid);
}

function makeCreatedChangeRequest(request: {
  readonly title: string;
  readonly baseRefName: string;
  readonly headSelector: string;
}): ChangeRequest {
  return {
    provider: "github",
    number: 42,
    title: request.title,
    url: fakePrUrl,
    baseRefName: request.baseRefName,
    headRefName: request.headSelector,
    state: "open",
    updatedAt: Option.none(),
  };
}

function makeSourceControlRegistry(input?: {
  readonly createChangeRequest?: SourceControlProvider.SourceControlProviderShape["createChangeRequest"];
  readonly existingChangeRequests?: ReadonlyArray<ChangeRequest>;
}) {
  const createChangeRequestCalls: Array<
    Parameters<SourceControlProvider.SourceControlProviderShape["createChangeRequest"]>[0]
  > = [];
  const provider = SourceControlProvider.SourceControlProvider.of({
    kind: "github",
    listChangeRequests: () => Effect.succeed(input?.existingChangeRequests ?? []),
    getChangeRequest: () =>
      Effect.succeed(
        makeCreatedChangeRequest({
          title: "Existing",
          baseRefName: "main",
          headSelector: "orchestrator/existing",
        }),
      ),
    createChangeRequest:
      input?.createChangeRequest ??
      ((request) => {
        createChangeRequestCalls.push(request);
        return Effect.succeed(makeCreatedChangeRequest(request));
      }),
    getRepositoryCloneUrls: () =>
      Effect.fail(
        new SourceControlProviderError({
          provider: "github",
          operation: "getRepositoryCloneUrls",
          detail: "unsupported in integration fixture",
        }),
      ),
    createRepository: () =>
      Effect.fail(
        new SourceControlProviderError({
          provider: "github",
          operation: "createRepository",
          detail: "unsupported in integration fixture",
        }),
      ),
    getDefaultBranch: () => Effect.succeed("main"),
    checkoutChangeRequest: () => Effect.void,
  });
  const handle: SourceControlProviderHandle = {
    provider,
    context: {
      provider: {
        kind: "github",
        name: "GitHub",
        baseUrl: "https://github.com",
      },
      remoteName: "origin",
      remoteUrl: "git@github.com:acme/repo.git",
    },
  };
  const registry: SourceControlProviderRegistryShape = {
    get: () => Effect.succeed(provider),
    resolveHandle: () => Effect.succeed(handle),
    resolve: () => Effect.succeed(provider),
    discover: Effect.succeed([]),
  };
  return { registry, createChangeRequestCalls };
}

function makeUnsupportedSourceControlRegistry() {
  const provider = SourceControlProvider.SourceControlProvider.of({
    kind: "unknown",
    listChangeRequests: () =>
      Effect.fail(
        new SourceControlProviderError({
          provider: "unknown",
          operation: "listChangeRequests",
          detail: "unsupported",
        }),
      ),
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
    getRepositoryCloneUrls: () =>
      Effect.fail(
        new SourceControlProviderError({
          provider: "unknown",
          operation: "getRepositoryCloneUrls",
          detail: "unsupported",
        }),
      ),
    createRepository: () =>
      Effect.fail(
        new SourceControlProviderError({
          provider: "unknown",
          operation: "createRepository",
          detail: "unsupported",
        }),
      ),
    getDefaultBranch: () => Effect.succeed(null),
    checkoutChangeRequest: () => Effect.void,
  });
  const registry: SourceControlProviderRegistryShape = {
    get: () => Effect.succeed(provider),
    resolveHandle: () => Effect.succeed({ provider, context: null }),
    resolve: () => Effect.succeed(provider),
    discover: Effect.succeed([]),
  };
  return registry;
}

function withHarness<A, E, R>(
  registry: SourceControlProviderRegistryShape,
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E, R>,
  rootDir?: string,
) {
  const options: Parameters<typeof makeOrchestrationIntegrationHarness>[0] = {
    provider: CODEX_PROVIDER,
    ...(rootDir !== undefined ? { rootDir } : {}),
    taskWorktreeReactor: {
      enabled: true,
      sourceControlProviderRegistry: registry,
    },
  };
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness(options),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

function withHarnessWithoutLanding<A, E, R>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: CODEX_PROVIDER }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

function seedReviewTask(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly suffix: string;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly branch: string;
  readonly title: string;
  readonly orchestratorConfig?: OrchestratorConfigJson;
}): Effect.Effect<{ readonly task: OrchestrationTask; readonly stageThreadId: ThreadId }, never> {
  return Effect.gen(function* () {
    yield* input.harness.engine
      .dispatch({
        type: "project.create",
        commandId: commandId(`${input.suffix}-project-create`),
        projectId: input.projectId,
        title: `Landing ${input.suffix}`,
        workspaceRoot: input.harness.workspaceDir,
        defaultModelSelection: DEFAULT_SELECTION,
        orchestratorConfig: input.orchestratorConfig ?? {},
        createdAt: iso(0),
      })
      .pipe(Effect.orDie);
    yield* input.harness.engine
      .dispatch({
        type: "task.create",
        commandId: commandId(`${input.suffix}-task-create`),
        taskId: input.taskId,
        projectId: input.projectId,
        taskType: TASK_TYPE,
        title: input.title,
        pmMessageId: null,
        branch: input.branch,
        createdAt: iso(1),
      })
      .pipe(Effect.orDie);
    yield* input.harness.engine
      .dispatch({
        type: "task.classify",
        commandId: commandId(`${input.suffix}-task-classify`),
        taskId: input.taskId,
        taskType: TASK_TYPE,
        playbookVersion: "landing-playbook",
        createdAt: iso(2),
      })
      .pipe(Effect.orDie);
    const createdTask = yield* waitForTask(
      input.harness,
      input.taskId,
      (task) => task.branch !== null && task.worktreePath !== null,
      `created task ${input.suffix}`,
    );
    assert.ok(createdTask.branch);
    assert.ok(createdTask.worktreePath);
    ensureGitWorktree({
      workspaceDir: input.harness.workspaceDir,
      branch: createdTask.branch,
      worktreePath: createdTask.worktreePath,
    });

    yield* input.harness.adapterHarness!.queueTurnResponseForNextSession(
      successfulTurnResponse(`${input.suffix}-work`, iso(3)),
    );
    const stageCommandId = commandId(`${input.suffix}-work-start`);
    yield* input.harness.engine
      .dispatch({
        type: "task.stage.start",
        commandId: stageCommandId,
        taskId: input.taskId,
        role: "work",
        instructions: "Implement the landing fixture.",
        createdAt: iso(3),
      })
      .pipe(Effect.orDie);
    const events = yield* input.harness.waitForDomainEvent(
      (event) => event.type === "task.stage-started" && event.commandId === stageCommandId,
    );
    const stageStarted = events.find(
      (event): event is Extract<OrchestrationEvent, { type: "task.stage-started" }> =>
        event.type === "task.stage-started" && event.commandId === stageCommandId,
    );
    if (!stageStarted) {
      return yield* Effect.die(new Error(`Missing stage-started event for ${input.suffix}.`));
    }
    yield* input.harness.engine
      .dispatch({
        type: "task.stage.complete",
        commandId: commandId(`${input.suffix}-work-complete`),
        taskId: input.taskId,
        role: "work",
        stageThreadId: stageStarted.payload.stageThreadId,
        awaitedTurnId: TurnId.make(`${input.suffix}-manual-turn`),
        diffComplete: false,
        createdAt: iso(4),
      })
      .pipe(Effect.orDie);
    const reviewTask = yield* waitForTask(
      input.harness,
      input.taskId,
      (task) => task.status === "review",
      `review task ${input.suffix}`,
    );
    return { task: reviewTask, stageThreadId: stageStarted.payload.stageThreadId };
  });
}

function approveLandAndDispatch(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly suffix: string;
  readonly taskId: TaskId;
  readonly stageThreadId: ThreadId;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const id = gateId(`${input.suffix}-land`);
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.request",
        commandId: commandId(`${input.suffix}-gate-request`),
        taskId: input.taskId,
        gateId: id,
        gate: "land",
        contentHash: `sha256:${input.suffix}-land`,
        stageThreadId: input.stageThreadId,
        createdAt: iso(5),
      })
      .pipe(Effect.orDie);
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.resolve",
        commandId: commandId(`${input.suffix}-gate-resolve`),
        taskId: input.taskId,
        gateId: id,
        gate: "land",
        approvedHash: `sha256:${input.suffix}-land`,
        decision: "approved",
        origin: "human",
        createdAt: iso(6),
      })
      .pipe(Effect.orDie);
    yield* landOrchestrationTaskWithServices(
      { snapshotQuery: input.harness.snapshotQuery },
      {
        taskId: input.taskId,
        commandId: Effect.succeed(commandId(`${input.suffix}-land`)),
        createdAt: Effect.succeed(iso(7)),
        dispatch: (command) => input.harness.engine.dispatch(command),
      },
    ).pipe(Effect.orDie);
  });
}

it.live("opens a ready PR after the human-approved land gate and cleans the worktree", () => {
  const { registry, createChangeRequestCalls } = makeSourceControlRegistry();
  const id = taskId("happy");
  return withHarness(registry, (harness) =>
    Effect.gen(function* () {
      const { task, stageThreadId } = yield* seedReviewTask({
        harness,
        suffix: "happy",
        projectId: projectId("happy"),
        taskId: id,
        branch: "orchestrator/landing-happy",
        title: "Landing happy path",
      });
      const worktreePath = task.worktreePath;
      assert.ok(worktreePath);

      yield* approveLandAndDispatch({ harness, suffix: "happy", taskId: id, stageThreadId });
      yield* harness.waitForDomainEvent(
        (event) => event.type === "task.pr-opened" && event.payload.taskId === id,
      );
      const landed = yield* waitForTask(
        harness,
        id,
        (entry) => entry.status === "landed" && entry.prUrl === fakePrUrl,
        "landed task with PR URL",
      );
      yield* waitForWorktreeRemoved(task.worktreePath);

      assert.equal(landed.prUrl, fakePrUrl);
      assert.deepEqual(harness.landingMocks?.pushCurrentBranchCalls, [
        {
          cwd: task.worktreePath,
          fallbackBranch: "orchestrator/landing-happy",
          remoteName: "origin",
        },
      ]);
      assert.equal(createChangeRequestCalls.length, 1);
      assert.equal(createChangeRequestCalls[0]?.cwd, task.worktreePath);
      assert.equal(createChangeRequestCalls[0]?.baseRefName, "main");
      assert.equal(createChangeRequestCalls[0]?.headSelector, "orchestrator/landing-happy");
      assert.equal(createChangeRequestCalls[0]?.title, "Landing happy path");
      assert.equal(createChangeRequestCalls[0]?.draft, false);
      assert.deepEqual(harness.landingMocks?.removeWorktreeCalls, [
        {
          cwd: harness.workspaceDir,
          path: task.worktreePath,
          force: true,
        },
      ]);
    }),
  );
});

it.live("processes once when landing races with the startup scan-to-subscribe window", () =>
  Effect.gen(function* () {
    const cleanupStarted = yield* Deferred.make<void>();
    const releaseCleanup = yield* Deferred.make<void>();
    const removedPaths: string[] = [];
    const blockerId = taskId("startup-race-blocker");
    const targetId = taskId("startup-race-target");
    const { registry, createChangeRequestCalls } = makeSourceControlRegistry();

    yield* Effect.acquireUseRelease(
      makeOrchestrationIntegrationHarness({
        provider: CODEX_PROVIDER,
        startReactors: false,
        taskWorktreeReactor: {
          enabled: true,
          sourceControlProviderRegistry: registry,
          removeWorktree: (input) =>
            Effect.gen(function* () {
              removedPaths.push(input.path);
              if (input.path.endsWith(String(blockerId))) {
                yield* Deferred.succeed(cleanupStarted, undefined);
                yield* Deferred.await(releaseCleanup);
              }
              yield* Effect.try({
                try: () => {
                  runGit(input.cwd, [
                    "worktree",
                    "remove",
                    ...(input.force ? ["--force"] : []),
                    input.path,
                  ]);
                },
                catch: (cause) =>
                  new GitCommandError({
                    operation: "removeWorktree",
                    command: "git worktree remove",
                    cwd: input.cwd,
                    detail: cause instanceof Error ? cause.message : String(cause),
                  }),
              }).pipe(Effect.orDie);
            }),
        },
      }),
      (harness) =>
        Effect.gen(function* () {
          const project = projectId("startup-race");
          const { task: target, stageThreadId } = yield* seedReviewTask({
            harness,
            suffix: "startup-race-target",
            projectId: project,
            taskId: targetId,
            branch: "orchestrator/landing-startup-race-target",
            title: "Landing startup race target",
          });
          assert.ok(target.worktreePath);

          yield* harness.engine
            .dispatch({
              type: "task.create",
              commandId: commandId("startup-race-blocker-create"),
              taskId: blockerId,
              projectId: project,
              taskType: TASK_TYPE,
              title: "Landing startup race blocker",
              pmMessageId: null,
              branch: "orchestrator/landing-startup-race-blocker",
              createdAt: iso(20),
            })
            .pipe(Effect.orDie);
          const blocker = yield* waitForTask(
            harness,
            blockerId,
            (task) => task.worktreePath !== null,
            "startup race blocker task",
          );
          assert.ok(blocker.worktreePath);
          ensureGitWorktree({
            workspaceDir: harness.workspaceDir,
            branch: blocker.branch!,
            worktreePath: blocker.worktreePath,
          });
          yield* harness.engine
            .dispatch({
              type: "task.cancellation.request",
              commandId: commandId("startup-race-blocker-cancel"),
              taskId: blockerId,
              createdAt: iso(21),
            })
            .pipe(Effect.orDie);
          yield* harness.engine
            .dispatch({
              type: "task.abandon",
              commandId: commandId("startup-race-blocker-abandon"),
              taskId: blockerId,
              createdAt: iso(22),
            })
            .pipe(Effect.orDie);
          yield* waitForTask(
            harness,
            blockerId,
            (task) => task.status === "abandoned",
            "abandoned startup race blocker",
          );

          const startupFiber = yield* Effect.forkChild(harness.startTaskWorktreeReactor);
          yield* Deferred.await(cleanupStarted);

          yield* approveLandAndDispatch({
            harness,
            suffix: "startup-race-target",
            taskId: targetId,
            stageThreadId,
          });
          yield* waitForTask(
            harness,
            targetId,
            (task) => task.status === "landed",
            "landed startup race target",
          );

          yield* Deferred.succeed(releaseCleanup, undefined);
          yield* Fiber.join(startupFiber);
          yield* harness.waitForDomainEvent(
            (event) => event.type === "task.pr-opened" && event.payload.taskId === targetId,
          );
          yield* waitForWorktreeRemoved(target.worktreePath);
          yield* harness.drainReactors;

          const events = yield* readAllEvents(harness);
          assert.equal(createChangeRequestCalls.length, 1);
          assert.equal(
            events.filter(
              (event) => event.type === "task.pr-opened" && event.payload.taskId === targetId,
            ).length,
            1,
          );
          assert.equal(
            removedPaths.filter((removedPath) => removedPath === target.worktreePath).length,
            1,
          );
          assert.equal(
            harness.landingMocks?.pushCurrentBranchCalls.filter(
              (call) => call.cwd === target.worktreePath,
            ).length,
            1,
          );
        }),
      (harness) => harness.dispose,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.live("opens a draft PR when project config sets openPrAsDraft", () => {
  const { registry, createChangeRequestCalls } = makeSourceControlRegistry();
  const id = taskId("draft");
  return withHarness(registry, (harness) =>
    Effect.gen(function* () {
      const { stageThreadId } = yield* seedReviewTask({
        harness,
        suffix: "draft",
        projectId: projectId("draft"),
        taskId: id,
        branch: "orchestrator/landing-draft",
        title: "Landing draft PR",
        orchestratorConfig: { openPrAsDraft: true },
      });

      yield* approveLandAndDispatch({ harness, suffix: "draft", taskId: id, stageThreadId });
      yield* harness.waitForDomainEvent(
        (event) => event.type === "task.pr-opened" && event.payload.taskId === id,
      );

      assert.equal(createChangeRequestCalls.length, 1);
      assert.equal(createChangeRequestCalls[0]?.baseRefName, "main");
      assert.equal(createChangeRequestCalls[0]?.headSelector, "orchestrator/landing-draft");
      assert.equal(createChangeRequestCalls[0]?.title, "Landing draft PR");
      assert.equal(createChangeRequestCalls[0]?.draft, true);
    }),
  );
});

it.live("fails loud without a supported provider and leaves the worktree recoverable", () => {
  const registry = makeUnsupportedSourceControlRegistry();
  const id = taskId("unsupported");
  return withHarness(registry, (harness) =>
    Effect.gen(function* () {
      const { task, stageThreadId } = yield* seedReviewTask({
        harness,
        suffix: "unsupported",
        projectId: projectId("unsupported"),
        taskId: id,
        branch: "orchestrator/landing-unsupported",
        title: "Landing unsupported provider",
      });
      const worktreePath = task.worktreePath;
      assert.ok(worktreePath);

      yield* approveLandAndDispatch({ harness, suffix: "unsupported", taskId: id, stageThreadId });
      yield* harness.waitForDomainEvent(
        (event) => event.type === "task.pr-open-failed" && event.payload.taskId === id,
      );
      yield* harness.waitForDomainEvent(
        (event) =>
          event.type === "thread.activity-appended" &&
          event.payload.activity.kind === "task.landing.pr-open-failed",
      );

      const afterFailure = yield* waitForTask(
        harness,
        id,
        (entry) => entry.status === "landed",
        "landed task after PR failure",
      );
      const events = yield* readAllEvents(harness);

      assert.equal(afterFailure.prUrl, null);
      assert.equal(afterFailure.landing?.status, "failed");
      assert.equal(afterFailure.landing?.branchPushed, false);
      assert.match(afterFailure.landing?.failureMessage ?? "", /unsupported/i);
      assert.equal(existsSync(worktreePath), true);
      assert.deepEqual(harness.landingMocks?.pushCurrentBranchCalls, []);
      assert.deepEqual(harness.landingMocks?.removeWorktreeCalls, []);
      assert.equal(
        events.some((event) => event.type === "task.pr-opened" && event.payload.taskId === id),
        false,
      );
    }),
  );
});

it.live("retries an exhausted landing once through the shared actuator", () => {
  let prAttempts = 0;
  const { registry } = makeSourceControlRegistry({
    createChangeRequest: (request) => {
      prAttempts += 1;
      return prAttempts === 1
        ? Effect.fail(
            new SourceControlProviderError({
              provider: "github",
              operation: "createChangeRequest",
              detail: "temporary provider outage",
            }),
          )
        : Effect.succeed(makeCreatedChangeRequest(request));
    },
  });
  const id = taskId("retry");
  return withHarness(registry, (harness) =>
    Effect.gen(function* () {
      const { task, stageThreadId } = yield* seedReviewTask({
        harness,
        suffix: "retry",
        projectId: projectId("retry"),
        taskId: id,
        branch: "orchestrator/landing-retry",
        title: "Retry landing PR",
      });
      const worktreePath = task.worktreePath;
      assert.ok(worktreePath);

      yield* approveLandAndDispatch({ harness, suffix: "retry", taskId: id, stageThreadId });
      yield* waitForTask(
        harness,
        id,
        (entry) => entry.landing?.status === "failed",
        "exhausted landing failure",
      );

      const result = yield* landOrchestrationTaskWithServices(
        { snapshotQuery: harness.snapshotQuery },
        {
          taskId: id,
          commandId: Effect.succeed(commandId("retry-request")),
          createdAt: Effect.succeed(iso(20)),
          dispatch: (command) => harness.engine.dispatch(command),
        },
      );
      assert.equal(result.alreadyLanded, false);
      assert.equal(result.alreadyInProgress, false);
      yield* harness.waitForDomainEvent(
        (event) => event.type === "task.pr-opened" && event.payload.taskId === id,
      );
      yield* waitForWorktreeRemoved(worktreePath);

      const afterRetry = yield* waitForTask(
        harness,
        id,
        (entry) => entry.landing?.status === "completed",
        "completed retried landing",
      );
      assert.equal(afterRetry.prUrl, fakePrUrl);
      assert.equal(prAttempts, 2);
    }),
  );
});

it.live("does not open a second PR for a landed task that already has prUrl", () => {
  const { registry, createChangeRequestCalls } = makeSourceControlRegistry();
  const id = taskId("idempotent");
  return withHarnessWithoutLanding((setupHarness) =>
    Effect.gen(function* () {
      const { task, stageThreadId } = yield* seedReviewTask({
        harness: setupHarness,
        suffix: "idempotent",
        projectId: projectId("idempotent"),
        taskId: id,
        branch: "orchestrator/landing-idempotent",
        title: "Landing already opened",
      });
      const worktreePath = task.worktreePath;
      assert.ok(worktreePath);
      yield* approveLandAndDispatch({
        harness: setupHarness,
        suffix: "idempotent",
        taskId: id,
        stageThreadId,
      });
      yield* waitForTask(
        setupHarness,
        id,
        (entry) => entry.status === "landed",
        "initial landed task",
      );
      yield* setupHarness.engine
        .dispatch({
          type: "task.pr.opened",
          commandId: commandId("idempotent-pr-opened"),
          taskId: id,
          prUrl: "https://github.com/acme/repo/pull/7",
          prNumber: 7,
          createdAt: iso(8),
        })
        .pipe(Effect.orDie);
      yield* waitForTask(
        setupHarness,
        id,
        (entry) => entry.prUrl === "https://github.com/acme/repo/pull/7",
        "initial PR URL",
      );
      assert.equal(existsSync(worktreePath), true);
      const rootDir = setupHarness.rootDir;

      yield* setupHarness.dispose;

      yield* withHarness(
        registry,
        (restarted) =>
          Effect.gen(function* () {
            yield* waitForTask(
              restarted,
              id,
              (entry) =>
                entry.status === "landed" && entry.prUrl === "https://github.com/acme/repo/pull/7",
              "restarted landed task with existing PR URL",
            );
            yield* waitForWorktreeRemoved(worktreePath);

            assert.equal(createChangeRequestCalls.length, 0);
            assert.deepEqual(restarted.landingMocks?.pushCurrentBranchCalls, []);
            assert.deepEqual(restarted.landingMocks?.removeWorktreeCalls, [
              {
                cwd: restarted.workspaceDir,
                path: worktreePath,
                force: true,
              },
            ]);
          }),
        rootDir,
      );
    }),
  );
});
