// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

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
  type OrchestrationStageRole,
  type OrchestrationTask,
  type OrchestratorConfigJson,
  type OrchestratorGlobalDefaults,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const DEFAULT_INSTANCE = ProviderInstanceId.make("codex");
const TASK_TYPE = TaskTypeId.make("feature");
const DEFAULT_SELECTION: ModelSelection = {
  instanceId: DEFAULT_INSTANCE,
  model: "gpt-5-live-global",
};

const LIVE_GLOBAL_TIMEOUT_MS = 180_000;

const iso = (seconds: number) => `2026-06-23T13:00:${String(seconds).padStart(2, "0")}.000Z`;
const commandId = (suffix: string) => CommandId.make(`cmd-live-global-${suffix}`);
const eventId = (suffix: string) => EventId.make(`evt-live-global-${suffix}`);
const gateId = (suffix: string) => GateId.make(`gate-live-global-${suffix}`);
const projectId = (suffix: string) => ProjectId.make(`project-live-global-${suffix}`);
const taskId = (suffix: string) => TaskId.make(`task-live-global-${suffix}`);

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
    threadId: ThreadId.make("fixture-live-global-thread"),
    turnId: TurnId.make("fixture-live-global-turn"),
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

function readAllEvents(
  harness: OrchestrationIntegrationHarness,
): Effect.Effect<ReadonlyArray<OrchestrationEvent>, never> {
  return Stream.runCollect(harness.engine.readEvents(0)).pipe(
    Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk)),
    Effect.orDie,
  );
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

function withHarness<A, E, R>(
  use: (harness: OrchestrationIntegrationHarness) => Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    makeOrchestrationIntegrationHarness({ provider: CODEX_PROVIDER }),
    use,
    (harness) => harness.dispose,
  ).pipe(Effect.provide(NodeServices.layer));
}

function updateGlobalDefaults(
  harness: OrchestrationIntegrationHarness,
  update: (current: OrchestratorGlobalDefaults) => OrchestratorGlobalDefaults,
) {
  return Effect.gen(function* () {
    const settings = yield* harness.serverSettings.getSettings;
    yield* harness.serverSettings.updateSettings({
      orchestratorDefaults: update(settings.orchestratorDefaults),
    });
  });
}

function seedProjectAndTask(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly suffix: string;
  readonly projectId: ProjectId;
  readonly taskId: TaskId;
  readonly orchestratorConfig: OrchestratorConfigJson;
  readonly createdAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    yield* input.harness.engine
      .dispatch({
        type: "project.create",
        commandId: commandId(`${input.suffix}-project-create`),
        projectId: input.projectId,
        title: `Live Global ${input.suffix}`,
        workspaceRoot: input.harness.workspaceDir,
        defaultModelSelection: DEFAULT_SELECTION,
        orchestratorConfig: input.orchestratorConfig,
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);
    yield* input.harness.engine
      .dispatch({
        type: "task.create",
        commandId: commandId(`${input.suffix}-task-create`),
        taskId: input.taskId,
        projectId: input.projectId,
        taskType: TASK_TYPE,
        title: `Live global task ${input.suffix}`,
        pmMessageId: null,
        branch: `orchestrator/live-global-${input.suffix}`,
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);

    const task = yield* waitForTask(
      input.harness,
      input.taskId,
      (entry) => entry.branch !== null && entry.worktreePath !== null,
      `projected worktree path for ${input.suffix}`,
    );
    if (task.branch !== null && task.worktreePath !== null) {
      ensureGitWorktree({
        workspaceDir: input.harness.workspaceDir,
        branch: task.branch,
        worktreePath: task.worktreePath,
      });
    }
  });
}

function gateEventsFor(
  events: ReadonlyArray<OrchestrationEvent>,
  gateCommandId: CommandId,
): ReadonlyArray<
  Extract<OrchestrationEvent, { type: "task.gate-requested" | "task.gate-resolved" }>
> {
  return events.filter(
    (
      event,
    ): event is Extract<
      OrchestrationEvent,
      { type: "task.gate-requested" | "task.gate-resolved" }
    > =>
      (event.type === "task.gate-requested" || event.type === "task.gate-resolved") &&
      event.commandId === gateCommandId,
  );
}

function requestGate(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly suffix: string;
  readonly taskId: TaskId;
  readonly gate: "plan" | "land";
  readonly contentHash: string;
  readonly createdAt: string;
  readonly expectAutoResolved: boolean;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const requestGateId = gateId(`${input.suffix}-${input.gate}`);
    const gateCommandId = commandId(`${input.suffix}-gate-request-${input.gate}`);
    const worktreeCompletion =
      input.gate === "land"
        ? yield* waitForTask(
            input.harness,
            input.taskId,
            (task) => task.status === "review" && task.verification !== null,
            `verified task for ${input.suffix} land gate`,
          ).pipe(Effect.map((task) => ({ head: task.verification!.head, dirty: false })))
        : undefined;
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.request",
        commandId: gateCommandId,
        taskId: input.taskId,
        gateId: requestGateId,
        gate: input.gate,
        contentHash: input.contentHash,
        stageThreadId: ThreadId.make(`thread-live-global-${input.suffix}-${input.gate}`),
        ...(worktreeCompletion === undefined ? {} : { worktreeCompletion }),
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);

    yield* input.harness.waitForDomainEvent(
      (event) =>
        event.commandId === gateCommandId &&
        event.type === (input.expectAutoResolved ? "task.gate-resolved" : "task.gate-requested"),
    );

    const events = yield* readAllEvents(input.harness);
    const gateEvents = gateEventsFor(events, gateCommandId);
    assert.deepEqual(
      gateEvents.map((event) => event.type),
      input.expectAutoResolved
        ? ["task.gate-requested", "task.gate-resolved"]
        : ["task.gate-requested"],
    );
    if (input.expectAutoResolved) {
      const resolved = gateEvents.find(
        (event): event is Extract<OrchestrationEvent, { type: "task.gate-resolved" }> =>
          event.type === "task.gate-resolved",
      );
      assert.deepInclude(resolved?.payload, {
        taskId: input.taskId,
        gateId: requestGateId,
        gate: input.gate,
        approvedHash: input.contentHash,
        decision: "approved",
        origin: "system",
        updatedAt: input.createdAt,
      });
    }
  });
}

function startAndCompleteStage(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly suffix: string;
  readonly taskId: TaskId;
  readonly role: OrchestrationStageRole;
  readonly createdAt: string;
}): Effect.Effect<Extract<OrchestrationEvent, { type: "task.stage-started" }>, never> {
  return Effect.gen(function* () {
    yield* input.harness.adapterHarness!.queueTurnResponseForNextSession(
      successfulTurnResponse(input.suffix, input.createdAt),
    );
    const stageCommandId = commandId(`${input.suffix}-stage-start-${input.role}`);
    yield* input.harness.engine
      .dispatch({
        type: "task.stage.start",
        commandId: stageCommandId,
        taskId: input.taskId,
        role: input.role,
        instructions: `Run ${input.role} for ${input.suffix}.`,
        createdAt: input.createdAt,
      })
      .pipe(Effect.orDie);
    const events = yield* input.harness.waitForDomainEvent(
      (event) => event.type === "task.stage-started" && event.commandId === stageCommandId,
    );
    const stageStarted = events.find(
      (event): event is Extract<OrchestrationEvent, { type: "task.stage-started" }> =>
        event.type === "task.stage-started" && event.commandId === stageCommandId,
    );
    if (stageStarted === undefined) {
      return yield* Effect.die(new Error(`Missing task.stage-started for ${stageCommandId}.`));
    }
    yield* input.harness.drainReactors;
    yield* waitForTask(
      input.harness,
      input.taskId,
      (task) => task.currentStageThreadId === null,
      `completed ${input.role} stage for ${input.suffix}`,
    );
    return stageStarted;
  });
}

function assertStageRejected(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly suffix: string;
  readonly taskId: TaskId;
  readonly role: OrchestrationStageRole;
  readonly createdAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const stageCommandId = commandId(`${input.suffix}-stage-start-${input.role}`);
    const result = yield* Effect.exit(
      input.harness.engine.dispatch({
        type: "task.stage.start",
        commandId: stageCommandId,
        taskId: input.taskId,
        role: input.role,
        instructions: `Rejected ${input.role} for ${input.suffix}.`,
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

it.live(
  "proves sparse projects inherit gate policy live and explicit gate overrides win",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* updateGlobalDefaults(harness, (current) => ({
          ...current,
          gatePolicy: { ...current.gatePolicy, plan: "auto", land: "require-approval" },
        }));
        const inheritedTask = taskId("gate-inherited");
        yield* seedProjectAndTask({
          harness,
          suffix: "gate-inherited",
          projectId: projectId("gate-inherited"),
          taskId: inheritedTask,
          orchestratorConfig: {
            enabled: true,
            taskTypes: [{ id: "feature" }],
          },
          createdAt: iso(0),
        });

        yield* requestGate({
          harness,
          suffix: "gate-inherited-auto",
          taskId: inheritedTask,
          gate: "plan",
          contentHash: "sha256:live-global-plan-auto",
          createdAt: iso(1),
          expectAutoResolved: true,
        });

        yield* updateGlobalDefaults(harness, (current) => ({
          ...current,
          gatePolicy: {
            ...current.gatePolicy,
            plan: "require-approval",
            land: "require-approval",
          },
        }));
        yield* requestGate({
          harness,
          suffix: "gate-inherited-require",
          taskId: inheritedTask,
          gate: "plan",
          contentHash: "sha256:live-global-plan-require",
          createdAt: iso(2),
          expectAutoResolved: false,
        });

        yield* updateGlobalDefaults(harness, (current) => ({
          ...current,
          gatePolicy: { ...current.gatePolicy, plan: "auto", land: "require-approval" },
        }));
        const explicitTask = taskId("gate-explicit");
        yield* seedProjectAndTask({
          harness,
          suffix: "gate-explicit",
          projectId: projectId("gate-explicit"),
          taskId: explicitTask,
          orchestratorConfig: {
            enabled: true,
            taskTypes: [{ id: "feature", gatePolicy: { plan: "require-approval" } }],
          },
          createdAt: iso(3),
        });
        yield* requestGate({
          harness,
          suffix: "gate-explicit-require",
          taskId: explicitTask,
          gate: "plan",
          contentHash: "sha256:live-global-plan-explicit",
          createdAt: iso(4),
          expectAutoResolved: false,
        });
      }),
    ),
  LIVE_GLOBAL_TIMEOUT_MS,
);

it.live(
  "proves sparse projects inherit stages while explicit values win",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* updateGlobalDefaults(harness, (current) => ({
          ...current,
          stages: ["plan", "work"],
        }));

        const inheritedStageTask = taskId("stage-inherited");
        yield* seedProjectAndTask({
          harness,
          suffix: "stage-inherited",
          projectId: projectId("stage-inherited"),
          taskId: inheritedStageTask,
          orchestratorConfig: {
            taskTypes: [{ id: "feature" }],
          },
          createdAt: iso(10),
        });
        yield* assertStageRejected({
          harness,
          suffix: "stage-inherited-verify",
          taskId: inheritedStageTask,
          role: "verify",
          createdAt: iso(11),
        });

        const explicitStageTask = taskId("stage-explicit");
        yield* seedProjectAndTask({
          harness,
          suffix: "stage-explicit",
          projectId: projectId("stage-explicit"),
          taskId: explicitStageTask,
          orchestratorConfig: {
            taskTypes: [
              {
                id: "feature",
                stages: ["plan", "work", "verify"],
              },
            ],
          },
          createdAt: iso(12),
        });
        yield* startAndCompleteStage({
          harness,
          suffix: "stage-explicit-verify",
          taskId: explicitStageTask,
          role: "verify",
          createdAt: iso(13),
        });
      }),
    ),
  LIVE_GLOBAL_TIMEOUT_MS,
);

it.live(
  "proves land is never auto-resolved even if the live global default is malformed",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* harness.unsafeUpdateServerSettingsForTest((settings) => ({
          ...settings,
          orchestratorDefaults: {
            ...settings.orchestratorDefaults,
            gatePolicy: {
              ...settings.orchestratorDefaults.gatePolicy,
              land: "auto" as "require-approval",
            },
          },
        }));

        const landTask = taskId("land-global-auto");
        yield* seedProjectAndTask({
          harness,
          suffix: "land-global-auto",
          projectId: projectId("land-global-auto"),
          taskId: landTask,
          orchestratorConfig: {
            enabled: true,
            taskTypes: [{ id: "feature" }],
          },
          createdAt: iso(30),
        });
        yield* startAndCompleteStage({
          harness,
          suffix: "land-global-auto-work",
          taskId: landTask,
          role: "work",
          createdAt: iso(30),
        });
        yield* startAndCompleteStage({
          harness,
          suffix: "land-global-auto-verify",
          taskId: landTask,
          role: "verify",
          createdAt: iso(31),
        });
        yield* requestGate({
          harness,
          suffix: "land-global-auto",
          taskId: landTask,
          gate: "land",
          contentHash: "sha256:live-global-land",
          createdAt: iso(32),
          expectAutoResolved: false,
        });

        const snapshot = yield* harness.snapshotQuery.getSnapshot().pipe(Effect.orDie);
        const pendingLandGate = (snapshot.pendingGates ?? []).find(
          (gate) => gate.gateId === gateId("land-global-auto-land"),
        );
        assert.equal(pendingLandGate?.status, "pending");
        assert.equal(pendingLandGate?.origin, null);
      }),
    ),
  LIVE_GLOBAL_TIMEOUT_MS,
);
