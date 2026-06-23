import {
  CommandId,
  EventId,
  GateId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationStageRole,
  type OrchestrationTask,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";
import { defaultPlaybookLoader } from "../src/orchestration/PlaybookLoader.ts";

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const DEFAULT_INSTANCE = ProviderInstanceId.make("codex");
const PROJECT_INSTANCE = ProviderInstanceId.make("codex_project_phase4");
const TASK_INSTANCE = ProviderInstanceId.make("codex_task_phase4");

const PROJECT_ID = ProjectId.make("project-phase4");
const TASK_ID = TaskId.make("task-phase4");
const TASK_TYPE = TaskTypeId.make("feature");

const DEFAULT_SELECTION: ModelSelection = {
  instanceId: DEFAULT_INSTANCE,
  model: "gpt-5-default",
};
const PROJECT_SELECTION: ModelSelection = {
  instanceId: PROJECT_INSTANCE,
  model: "gpt-5-project",
};
const TASK_SELECTION: ModelSelection = {
  instanceId: TASK_INSTANCE,
  model: "gpt-5-task",
};

const PHASE4_CONFIG: Record<string, unknown> = {
  enabled: true,
  taskTypes: [
    {
      id: "feature",
      stages: ["classify", "plan", "work", "verify"],
      gatePolicy: {
        classify: "require-approval",
        plan: "auto",
        work: "require-approval",
        review: "require-approval",
        land: "require-approval",
      },
    },
  ],
};

const FULL_PIPELINE_TIMEOUT_MS = 240_000;

const iso = (seconds: number) => `2026-06-23T12:00:${String(seconds).padStart(2, "0")}.000Z`;

const commandId = (suffix: string) => CommandId.make(`cmd-phase4-${suffix}`);
const eventId = (suffix: string) => EventId.make(`evt-phase4-${suffix}`);
const gateId = (suffix: string) => GateId.make(`gate-phase4-${suffix}`);

const resolvedFeaturePlaybookVersion = () => {
  const resolved = defaultPlaybookLoader.resolve("feature");
  if (resolved === undefined) {
    throw new Error("Built-in feature playbook did not resolve.");
  }
  return resolved.playbookVersion;
};

function runtimeBase(suffix: string, createdAt: string) {
  return {
    eventId: eventId(suffix),
    provider: CODEX_PROVIDER,
    createdAt,
    threadId: ThreadId.make("fixture-thread"),
    turnId: TurnId.make("fixture-turn"),
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

class IntegrationProjectionTimeoutError extends Error {
  constructor(description: string) {
    super(`Timed out waiting for ${description}.`);
  }
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
  predicate: (task: OrchestrationTask) => boolean,
  description: string,
): Effect.Effect<OrchestrationTask, never> {
  return waitForProjection(
    harness.snapshotQuery
      .getSnapshot()
      .pipe(Effect.map((snapshot) => snapshot.tasks.find((task) => task.id === TASK_ID) ?? null)),
    (task): task is OrchestrationTask => task !== null && predicate(task),
    description,
  );
}

function latestSnapshot(
  harness: OrchestrationIntegrationHarness,
): Effect.Effect<OrchestrationReadModel, never> {
  return harness.snapshotQuery.getSnapshot().pipe(Effect.orDie);
}

function readAllEvents(
  harness: OrchestrationIntegrationHarness,
): Effect.Effect<ReadonlyArray<OrchestrationEvent>, never> {
  return Stream.runCollect(harness.engine.readEvents(0)).pipe(
    Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk)),
    Effect.orDie,
  );
}

function withHarness<A, E, R>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({
      provider: CODEX_PROVIDER,
      additionalProviderInstances: [PROJECT_INSTANCE, TASK_INSTANCE],
    }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

function ensureGitWorktree(input: {
  readonly workspaceDir: string;
  readonly branch: string;
  readonly worktreePath: string;
}): Effect.Effect<
  void,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const pathService = yield* Path.Path;
      const exists = yield* fileSystem
        .exists(input.worktreePath)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return;
      }
      yield* fileSystem
        .makeDirectory(pathService.dirname(input.worktreePath), { recursive: true })
        .pipe(Effect.orDie);
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const child = yield* spawner
        .spawn(
          ChildProcess.make(
            "git",
            ["worktree", "add", "-b", input.branch, input.worktreePath, "HEAD"],
            { cwd: input.workspaceDir },
          ),
        )
        .pipe(Effect.orDie);
      const exitCode = yield* child.exitCode.pipe(Effect.map(Number), Effect.orDie);
      if (exitCode !== 0) {
        return yield* Effect.die(
          new Error(`git worktree add exited with code ${exitCode} for '${input.worktreePath}'.`),
        );
      }
    }),
  );
}

function findStageStarted(
  events: ReadonlyArray<OrchestrationEvent>,
  stageCommandId: CommandId,
): Extract<OrchestrationEvent, { type: "task.stage-started" }> {
  const stageStarted = events.find(
    (event): event is Extract<OrchestrationEvent, { type: "task.stage-started" }> =>
      event.type === "task.stage-started" && event.commandId === stageCommandId,
  );
  if (!stageStarted) {
    throw new Error(`Missing task.stage-started event for ${stageCommandId}.`);
  }
  return stageStarted;
}

function startStage(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly role: OrchestrationStageRole;
  readonly suffix: string;
  readonly instructions: string;
  readonly response: TestTurnResponse;
  readonly expectedInstanceId: ProviderInstanceId;
  readonly createdAt: string;
}): Effect.Effect<
  {
    readonly stageStarted: Extract<OrchestrationEvent, { type: "task.stage-started" }>;
    readonly thread: OrchestrationThread;
  },
  never
> {
  return Effect.gen(function* () {
    yield* input.harness.adapterHarness!.queueTurnResponseForNextSession(input.response);
    const stageCommandId = commandId(`stage-start-${input.suffix}`);
    yield* input.harness.engine
      .dispatch({
        type: "task.stage.start",
        commandId: stageCommandId,
        taskId: TASK_ID,
        role: input.role,
        instructions: input.instructions,
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);
    const events = yield* input.harness.waitForDomainEvent(
      (event) => event.type === "task.stage-started" && event.commandId === stageCommandId,
    );
    const stageStarted = findStageStarted(events, stageCommandId);
    yield* input.harness.drainReactors;
    const thread = yield* waitForProjection(
      input.harness.snapshotQuery
        .getSnapshot()
        .pipe(
          Effect.map(
            (snapshot) =>
              snapshot.threads.find((entry) => entry.id === stageStarted.payload.stageThreadId) ??
              null,
          ),
        ),
      (entry): entry is OrchestrationThread =>
        entry !== null &&
        entry.session !== null &&
        entry.latestTurn !== null &&
        entry.modelSelection.instanceId === input.expectedInstanceId,
      `stage thread '${input.suffix}' provider turn start`,
    );
    return { stageStarted, thread };
  });
}

function completeStage(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly expectedStatus?: OrchestrationTask["status"];
}): Effect.Effect<OrchestrationTask, never> {
  return waitForTask(
    input.harness,
    (task) =>
      task.currentStageThreadId === null &&
      (input.expectedStatus === undefined || task.status === input.expectedStatus),
    "task after stage completion",
  );
}

function seedPhase4ProjectAndTask(
  harness: OrchestrationIntegrationHarness,
): Effect.Effect<
  void,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    yield* harness.engine
      .dispatch({
        type: "project.create",
        commandId: commandId("project-create"),
        projectId: PROJECT_ID,
        title: "Phase 4 Project",
        workspaceRoot: harness.workspaceDir,
        defaultModelSelection: DEFAULT_SELECTION,
        roleModelSelections: {
          work: PROJECT_SELECTION,
        },
        orchestratorConfig: PHASE4_CONFIG,
        createdAt: iso(0),
      })
      .pipe(Effect.orDie);
    yield* harness.engine
      .dispatch({
        type: "task.create",
        commandId: commandId("task-create"),
        taskId: TASK_ID,
        projectId: PROJECT_ID,
        taskType: TASK_TYPE,
        title: "Phase 4 pipeline task",
        pmMessageId: null,
        branch: "orchestrator/task-phase4",
        createdAt: iso(1),
      })
      .pipe(Effect.orDie);
    const task = yield* waitForTask(
      harness,
      (entry) => entry.branch !== null && entry.worktreePath !== null,
      "projected task worktree path",
    );
    if (task.branch === null || task.worktreePath === null) {
      return;
    }
    yield* ensureGitWorktree({
      workspaceDir: harness.workspaceDir,
      branch: task.branch,
      worktreePath: task.worktreePath,
    });
  });
}

function classifyWithBuiltInPlaybook(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly createdAt: string;
}): Effect.Effect<string, never> {
  return Effect.gen(function* () {
    const playbookVersion = resolvedFeaturePlaybookVersion();
    assert.match(playbookVersion, /^builtin:[0-9a-f]{12}$/);
    yield* input.harness.engine
      .dispatch({
        type: "task.classify",
        commandId: commandId("task-classify"),
        taskId: TASK_ID,
        taskType: TASK_TYPE,
        playbookVersion,
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);
    const classifiedTask = yield* waitForTask(
      input.harness,
      (task) => task.playbookVersion === playbookVersion,
      "classified task playbook snapshot",
    );
    assert.equal(classifiedTask.playbookVersion, playbookVersion);
    return playbookVersion;
  });
}

function requestPlanGate(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly stageThreadId: ThreadId;
  readonly createdAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const planGateId = gateId("plan");
    const planGateCommandId = commandId("gate-request-plan");
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.request",
        commandId: planGateCommandId,
        taskId: TASK_ID,
        gateId: planGateId,
        gate: "plan",
        contentHash: "sha256:phase4-plan",
        stageThreadId: input.stageThreadId,
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);
    yield* input.harness.waitForDomainEvent(
      (event) => event.type === "task.gate-resolved" && event.payload.gateId === planGateId,
    );
    const events = yield* readAllEvents(input.harness);
    const gateEvents = events.filter((event) => event.commandId === planGateCommandId);
    assert.deepEqual(
      gateEvents.map((event) => event.type),
      ["task.gate-requested", "task.gate-resolved"],
    );
    const resolved = gateEvents.find(
      (event): event is Extract<OrchestrationEvent, { type: "task.gate-resolved" }> =>
        event.type === "task.gate-resolved",
    );
    assert.deepInclude(resolved?.payload, {
      taskId: TASK_ID,
      gateId: planGateId,
      gate: "plan",
      approvedHash: "sha256:phase4-plan",
      decision: "approved",
      origin: "system",
      updatedAt: input.createdAt,
    });
    const task = yield* waitForTask(
      input.harness,
      (entry) => entry.status === "planning",
      "auto-approved plan gate",
    );
    assert.equal(task.status, "planning");
  });
}

function setPmWorkBackend(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly createdAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    yield* input.harness.engine
      .dispatch({
        type: "task.role-selections.set",
        commandId: commandId("task-role-selection-pm"),
        taskId: TASK_ID,
        roleModelSelections: {
          work: TASK_SELECTION,
        },
        origin: "pm-runtime",
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);
    const task = yield* waitForTask(
      input.harness,
      (entry) => entry.roleModelSelections?.work?.instanceId === TASK_INSTANCE,
      "pm-runtime task backend override",
    );
    assert.equal(task.roleModelSelections?.work?.model, TASK_SELECTION.model);
  });
}

function assertReviewStageRejected(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly createdAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const stageCommandId = commandId("stage-start-review-disabled");
    const result = yield* Effect.exit(
      input.harness.engine.dispatch({
        type: "task.stage.start",
        commandId: stageCommandId,
        taskId: TASK_ID,
        role: "review",
        instructions: "Review should be disabled by the Phase 4 config.",
        createdAt: input.createdAt,
      }),
    );
    assert.equal(Exit.isFailure(result), true);
    const events = yield* readAllEvents(input.harness);
    assert.equal(
      events.some(
        (event) => event.type === "task.stage-started" && event.commandId === stageCommandId,
      ),
      false,
    );
  });
}

function requestHumanLandGateAndLand(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly stageThreadId: ThreadId;
  readonly requestedAt: string;
  readonly resolvedAt: string;
  readonly landedAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const landGateId = gateId("land");
    const landGateCommandId = commandId("gate-request-land");
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.request",
        commandId: landGateCommandId,
        taskId: TASK_ID,
        gateId: landGateId,
        gate: "land",
        contentHash: "sha256:phase4-land",
        stageThreadId: input.stageThreadId,
        createdAt: input.requestedAt,
      })
      .pipe(Effect.orDie);
    yield* waitForProjection(
      input.harness.snapshotQuery.getSnapshot(),
      (snapshot): snapshot is OrchestrationReadModel =>
        (snapshot.pendingGates ?? []).some(
          (gate) => gate.gateId === landGateId && gate.status === "pending",
        ),
      "pending land gate",
    );
    const eventsAfterRequest = yield* readAllEvents(input.harness);
    const landGateEvents = eventsAfterRequest.filter(
      (event) => event.commandId === landGateCommandId,
    );
    assert.deepEqual(
      landGateEvents.map((event) => event.type),
      ["task.gate-requested"],
    );

    const prematureLand = yield* Effect.exit(
      input.harness.engine.dispatch({
        type: "task.land",
        commandId: commandId("task-land-before-human"),
        taskId: TASK_ID,
        createdAt: input.requestedAt,
      }),
    );
    assert.equal(Exit.isFailure(prematureLand), true);

    yield* input.harness.engine
      .dispatch({
        type: "task.gate.resolve",
        commandId: commandId("gate-resolve-land-human"),
        taskId: TASK_ID,
        gateId: landGateId,
        gate: "land",
        approvedHash: "sha256:phase4-land",
        decision: "approved",
        origin: "human",
        createdAt: input.resolvedAt,
      })
      .pipe(Effect.orDie);
    yield* waitForProjection(
      input.harness.snapshotQuery.getSnapshot(),
      (snapshot): snapshot is OrchestrationReadModel =>
        (snapshot.pendingGates ?? []).some(
          (gate) =>
            gate.gateId === landGateId && gate.status === "resolved" && gate.origin === "human",
        ),
      "human-resolved land gate",
    );
    yield* input.harness.engine
      .dispatch({
        type: "task.land",
        commandId: commandId("task-land"),
        taskId: TASK_ID,
        createdAt: input.landedAt,
      })
      .pipe(Effect.orDie);
    yield* waitForTask(input.harness, (task) => task.status === "landed", "landed task");
  });
}

it.live(
  "proves Phase 4 gates, stage toggles, playbook snapshot, and PM backend override end-to-end",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* seedPhase4ProjectAndTask(harness);
        yield* classifyWithBuiltInPlaybook({ harness, createdAt: iso(2) });

        const classifyStage = yield* startStage({
          harness,
          role: "classify",
          suffix: "classify",
          instructions: "Classify this task.",
          response: successfulTurnResponse("classify", iso(3)),
          expectedInstanceId: DEFAULT_INSTANCE,
          createdAt: iso(3),
        });
        assert.equal(classifyStage.stageStarted.payload.providerInstanceId, DEFAULT_INSTANCE);
        yield* completeStage({ harness, expectedStatus: "classified" });

        const planStage = yield* startStage({
          harness,
          role: "plan",
          suffix: "plan",
          instructions: "Plan the implementation.",
          response: successfulTurnResponse("plan", iso(4)),
          expectedInstanceId: DEFAULT_INSTANCE,
          createdAt: iso(4),
        });
        assert.equal(planStage.stageStarted.payload.providerInstanceId, DEFAULT_INSTANCE);
        yield* completeStage({ harness, expectedStatus: "planning" });

        yield* requestPlanGate({
          harness,
          stageThreadId: planStage.stageStarted.payload.stageThreadId,
          createdAt: iso(5),
        });

        yield* assertReviewStageRejected({ harness, createdAt: iso(6) });
        yield* setPmWorkBackend({ harness, createdAt: iso(7) });

        const workStage = yield* startStage({
          harness,
          role: "work",
          suffix: "work",
          instructions: "Implement the approved plan.",
          response: successfulTurnResponse("work", iso(8)),
          expectedInstanceId: TASK_INSTANCE,
          createdAt: iso(8),
        });
        assert.equal(workStage.stageStarted.payload.providerInstanceId, TASK_INSTANCE);
        assert.equal(workStage.stageStarted.payload.model, TASK_SELECTION.model);
        yield* completeStage({ harness, expectedStatus: "review" });

        yield* requestHumanLandGateAndLand({
          harness,
          stageThreadId: workStage.stageStarted.payload.stageThreadId,
          requestedAt: iso(9),
          resolvedAt: iso(10),
          landedAt: iso(11),
        });
      }),
    ),
  FULL_PIPELINE_TIMEOUT_MS,
);

it.live(
  "replays Phase 4 config, playbook snapshot, backend override, and position after restart",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* seedPhase4ProjectAndTask(harness);
        const playbookVersion = yield* classifyWithBuiltInPlaybook({ harness, createdAt: iso(20) });

        const planStage = yield* startStage({
          harness,
          role: "plan",
          suffix: "restart-plan",
          instructions: "Plan enough to cross the auto gate before restart.",
          response: successfulTurnResponse("restart-plan", iso(21)),
          expectedInstanceId: DEFAULT_INSTANCE,
          createdAt: iso(21),
        });
        yield* completeStage({ harness, expectedStatus: "planning" });
        yield* requestPlanGate({
          harness,
          stageThreadId: planStage.stageStarted.payload.stageThreadId,
          createdAt: iso(22),
        });
        yield* setPmWorkBackend({ harness, createdAt: iso(23) });

        const rootDir = harness.rootDir;
        yield* harness.dispose;

        yield* Effect.acquireUseRelease(
          makeOrchestrationIntegrationHarness({
            provider: CODEX_PROVIDER,
            rootDir,
            additionalProviderInstances: [PROJECT_INSTANCE, TASK_INSTANCE],
          }),
          (restarted) =>
            Effect.gen(function* () {
              const restartedSnapshot = yield* latestSnapshot(restarted);
              const restartedProject = restartedSnapshot.projects.find(
                (project) => project.id === PROJECT_ID,
              );
              const restartedTask = restartedSnapshot.tasks.find((task) => task.id === TASK_ID);

              assert.deepEqual(restartedProject?.orchestratorConfig, PHASE4_CONFIG);
              assert.equal(restartedTask?.status, "planning");
              assert.equal(restartedTask?.playbookVersion, playbookVersion);
              assert.match(restartedTask?.playbookVersion ?? "", /^builtin:[0-9a-f]{12}$/);
              assert.equal(restartedTask?.roleModelSelections?.work?.instanceId, TASK_INSTANCE);
              assert.equal(restartedTask?.roleModelSelections?.work?.model, TASK_SELECTION.model);

              const planGate = (restartedSnapshot.pendingGates ?? []).find(
                (gate) => gate.gateId === gateId("plan"),
              );
              assert.equal(planGate?.status, "resolved");
              assert.equal(planGate?.origin, "system");

              yield* assertReviewStageRejected({ harness: restarted, createdAt: iso(24) });

              const workStage = yield* startStage({
                harness: restarted,
                role: "work",
                suffix: "restart-work",
                instructions: "Resume from the post-plan-gate position and implement.",
                response: successfulTurnResponse("restart-work", iso(25)),
                expectedInstanceId: TASK_INSTANCE,
                createdAt: iso(25),
              });
              assert.equal(workStage.stageStarted.payload.providerInstanceId, TASK_INSTANCE);
              assert.equal(workStage.stageStarted.payload.model, TASK_SELECTION.model);
              yield* completeStage({ harness: restarted, expectedStatus: "review" });

              yield* requestHumanLandGateAndLand({
                harness: restarted,
                stageThreadId: workStage.stageStarted.payload.stageThreadId,
                requestedAt: iso(26),
                resolvedAt: iso(27),
                landedAt: iso(28),
              });
            }),
          (restarted) => restarted.dispose,
        );
      }),
    ),
);
