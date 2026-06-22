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
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";
import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";
import { quotaStageResumeCommandId } from "../src/orchestration/stageResolution.ts";

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const DEFAULT_INSTANCE = ProviderInstanceId.make("codex");
const PROJECT_INSTANCE = ProviderInstanceId.make("codex_project");
const TASK_INSTANCE = ProviderInstanceId.make("codex_task");

const PROJECT_ID = ProjectId.make("project-p7");
const TASK_ID = TaskId.make("task-p7");
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

const WORK_PREFIX = "P7 work prefix: use the task-specific implementation checklist.";
const VERIFY_PREFIX = "P7 verify prefix: verify behavior and review code before handoff.";
const STAGE_PREFIX_MARKER = "----- BEGIN GEDCODE STAGE PROMPT PREFIX -----";
const FULL_PIPELINE_TIMEOUT_MS = 240_000;

const iso = (seconds: number) => `2026-06-22T12:00:${String(seconds).padStart(2, "0")}.000Z`;

const commandId = (suffix: string) => CommandId.make(`cmd-p7-${suffix}`);
const eventId = (suffix: string) => EventId.make(`evt-p7-${suffix}`);
const gateId = (suffix: string) => GateId.make(`gate-p7-${suffix}`);

class IntegrationProjectionTimeoutError extends Error {
  constructor(description: string) {
    super(`Timed out waiting for ${description}.`);
  }
}

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

function quotaBlockedTurnResponse(label: string, createdAt: string): TestTurnResponse {
  return {
    events: [
      {
        type: "turn.started",
        ...runtimeBase(`${label}-turn-started`, createdAt),
      },
      {
        type: "runtime.error",
        ...runtimeBase(`${label}-quota-error`, createdAt),
        providerInstanceId: TASK_INSTANCE,
        payload: {
          message: "rate limit exceeded",
          class: "rate_limit",
        },
      },
    ],
  };
}

function countOccurrences(value: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next < 0) {
      return count;
    }
    count += 1;
    offset = next + needle.length;
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

function userText(thread: OrchestrationThread): string {
  const userMessage = thread.messages.find((message) => message.role === "user");
  if (!userMessage) {
    throw new Error(`Thread '${thread.id}' has no user message.`);
  }
  return userMessage.text;
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
        entry.modelSelection.instanceId === input.expectedInstanceId &&
        entry.messages.some((message) => message.role === "user"),
      `stage thread '${input.suffix}' provider turn start`,
    );
    return { stageStarted, thread };
  });
}

function resumeStageAfterQuotaOk(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly blockedStageThreadId: ThreadId;
  readonly suffix: string;
  readonly response: TestTurnResponse;
  readonly expectedInstanceId: ProviderInstanceId;
  readonly clearedAt: string;
}): Effect.Effect<
  {
    readonly stageStarted: Extract<OrchestrationEvent, { type: "task.stage-started" }>;
    readonly thread: OrchestrationThread;
  },
  never
> {
  return Effect.gen(function* () {
    yield* input.harness.adapterHarness!.queueTurnResponseForNextSession(input.response);
    yield* input.harness.adapterHarness!.emitRuntimeEvent({
      type: "account.rate-limits.updated",
      eventId: eventId(`rate-limits-ok-${input.suffix}`),
      provider: CODEX_PROVIDER,
      providerInstanceId: input.expectedInstanceId,
      createdAt: input.clearedAt,
      threadId: input.blockedStageThreadId,
      payload: {
        status: "ok",
      },
    });
    const resumeCommandId = quotaStageResumeCommandId(input.blockedStageThreadId, 1);
    yield* input.harness.drainReactors;
    const events = yield* input.harness.waitForDomainEvent(
      (event) => event.type === "task.stage-started" && event.commandId === resumeCommandId,
    );
    const stageStarted = findStageStarted(events, resumeCommandId);
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
        entry.modelSelection.instanceId === input.expectedInstanceId &&
        entry.messages.some((message) => message.role === "user"),
      `quota-resumed stage thread '${input.suffix}' provider turn start`,
    );
    return { stageStarted, thread };
  });
}

function completeStage(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly role: OrchestrationStageRole;
  readonly stageThreadId: ThreadId;
  readonly suffix: string;
  readonly createdAt: string;
  readonly expectedStatus?: OrchestrationTask["status"];
}): Effect.Effect<OrchestrationTask, never> {
  return waitForTask(
    input.harness,
    (task) =>
      task.currentStageThreadId === null &&
      (input.expectedStatus === undefined || task.status === input.expectedStatus),
    `task after ${input.role} completion`,
  );
}

function requestAndApproveGate(input: {
  readonly harness: OrchestrationIntegrationHarness;
  readonly gate: "plan" | "land";
  readonly gateId: GateId;
  readonly contentHash: string;
  readonly stageThreadId: ThreadId | null;
  readonly suffix: string;
  readonly requestedAt: string;
  readonly resolvedAt: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.request",
        commandId: commandId(`gate-request-${input.suffix}`),
        taskId: TASK_ID,
        gateId: input.gateId,
        gate: input.gate,
        contentHash: input.contentHash,
        stageThreadId: input.stageThreadId,
        createdAt: input.requestedAt,
      })
      .pipe(Effect.orDie);
    yield* input.harness.engine
      .dispatch({
        type: "task.gate.resolve",
        commandId: commandId(`gate-resolve-${input.suffix}`),
        taskId: TASK_ID,
        gateId: input.gateId,
        gate: input.gate,
        approvedHash: input.contentHash,
        decision: "approved",
        origin: "human",
        createdAt: input.resolvedAt,
      })
      .pipe(Effect.orDie);
  });
}

function seedProjectAndTask(
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
        title: "P7 Project",
        workspaceRoot: harness.workspaceDir,
        defaultModelSelection: DEFAULT_SELECTION,
        roleModelSelections: {
          review: PROJECT_SELECTION,
          work: PROJECT_SELECTION,
        },
        rolePromptPrefixes: {
          work: WORK_PREFIX,
          verify: VERIFY_PREFIX,
        },
        orchestratorConfig: { enabled: true },
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
        title: "P7 pipeline task",
        pmMessageId: null,
        branch: "orchestrator/task-p7",
        createdAt: iso(1),
      })
      .pipe(Effect.orDie);
    yield* harness.engine
      .dispatch({
        type: "task.role-selections.set",
        commandId: commandId("task-role-selection-human"),
        taskId: TASK_ID,
        roleModelSelections: {
          work: TASK_SELECTION,
        },
        origin: "human",
        createdAt: iso(2),
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

it.live(
  "drives the full role pipeline with backend precedence and exactly-once prefixes",
  () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        yield* seedProjectAndTask(harness);

        const rejectedRoleSelection = yield* Effect.exit(
          harness.engine.dispatch({
            type: "task.role-selections.set",
            commandId: commandId("task-role-selection-pm-rejected"),
            taskId: TASK_ID,
            roleModelSelections: {},
            origin: "pm-runtime",
            createdAt: iso(3),
          }),
        );
        assert.equal(Exit.isFailure(rejectedRoleSelection), true);

        yield* harness.engine
          .dispatch({
            type: "task.classify",
            commandId: commandId("task-classify"),
            taskId: TASK_ID,
            taskType: TASK_TYPE,
            playbookVersion: "p7-playbook",
            createdAt: iso(4),
          })
          .pipe(Effect.orDie);

        const classifyStage = yield* startStage({
          harness,
          role: "classify",
          suffix: "classify",
          instructions: "Classify this task.",
          response: successfulTurnResponse("classify", iso(5)),
          expectedInstanceId: DEFAULT_INSTANCE,
          createdAt: iso(5),
        });
        assert.equal(classifyStage.stageStarted.payload.providerInstanceId, DEFAULT_INSTANCE);
        yield* completeStage({
          harness,
          role: "classify",
          stageThreadId: classifyStage.stageStarted.payload.stageThreadId,
          suffix: "classify",
          createdAt: iso(6),
          expectedStatus: "classified",
        });

        const planStage = yield* startStage({
          harness,
          role: "plan",
          suffix: "plan",
          instructions: "Plan the implementation.",
          response: successfulTurnResponse("plan", iso(7)),
          expectedInstanceId: DEFAULT_INSTANCE,
          createdAt: iso(7),
        });
        assert.equal(planStage.stageStarted.payload.providerInstanceId, DEFAULT_INSTANCE);
        yield* completeStage({
          harness,
          role: "plan",
          stageThreadId: planStage.stageStarted.payload.stageThreadId,
          suffix: "plan",
          createdAt: iso(8),
          expectedStatus: "planning",
        });

        const reviewStage = yield* startStage({
          harness,
          role: "review",
          suffix: "review",
          instructions: "Review the plan before the human gate.",
          response: successfulTurnResponse("review", iso(9)),
          expectedInstanceId: PROJECT_INSTANCE,
          createdAt: iso(9),
        });
        assert.equal(reviewStage.stageStarted.payload.providerInstanceId, PROJECT_INSTANCE);
        yield* completeStage({
          harness,
          role: "review",
          stageThreadId: reviewStage.stageStarted.payload.stageThreadId,
          suffix: "review",
          createdAt: iso(10),
          expectedStatus: "reviewing",
        });

        yield* requestAndApproveGate({
          harness,
          gate: "plan",
          gateId: gateId("plan"),
          contentHash: "sha256:p7-plan",
          stageThreadId: reviewStage.stageStarted.payload.stageThreadId,
          suffix: "plan",
          requestedAt: iso(11),
          resolvedAt: iso(12),
        });
        yield* waitForTask(harness, (task) => task.status === "planning", "approved plan gate");

        const blockedWorkStage = yield* startStage({
          harness,
          role: "work",
          suffix: "work-blocked",
          instructions: "Implement the approved plan.",
          response: quotaBlockedTurnResponse("work-blocked", iso(13)),
          expectedInstanceId: TASK_INSTANCE,
          createdAt: iso(13),
        });
        assert.equal(blockedWorkStage.stageStarted.payload.providerInstanceId, TASK_INSTANCE);
        assert.equal(blockedWorkStage.stageStarted.payload.model, TASK_SELECTION.model);
        const blockedTask = yield* waitForTask(
          harness,
          (task) =>
            task.status === "blocked-on-quota" &&
            task.currentStageThreadId === null &&
            task.stageThreadIds.includes(blockedWorkStage.stageStarted.payload.stageThreadId),
          "work stage quota block",
        );
        assert.equal(blockedTask.roleModelSelections?.work?.instanceId, TASK_INSTANCE);

        const blockedWorkThread = yield* harness.waitForThread(
          blockedWorkStage.stageStarted.payload.stageThreadId,
          (thread) => thread.session?.providerInstanceId === TASK_INSTANCE,
        );
        const blockedWorkUserText = userText(blockedWorkThread);
        assert.equal(countOccurrences(blockedWorkUserText, WORK_PREFIX), 1);
        assert.equal(countOccurrences(blockedWorkUserText, STAGE_PREFIX_MARKER), 1);

        const resumedWorkStage = yield* resumeStageAfterQuotaOk({
          harness,
          blockedStageThreadId: blockedWorkStage.stageStarted.payload.stageThreadId,
          suffix: "work-resumed",
          response: successfulTurnResponse("work-resumed", iso(14)),
          expectedInstanceId: TASK_INSTANCE,
          clearedAt: iso(14),
        });
        assert.equal(resumedWorkStage.stageStarted.payload.providerInstanceId, TASK_INSTANCE);
        const resumedWorkUserText = userText(resumedWorkStage.thread);
        assert.equal(countOccurrences(resumedWorkUserText, WORK_PREFIX), 1);
        assert.equal(countOccurrences(resumedWorkUserText, STAGE_PREFIX_MARKER), 1);
        yield* completeStage({
          harness,
          role: "work",
          stageThreadId: resumedWorkStage.stageStarted.payload.stageThreadId,
          suffix: "work-resumed",
          createdAt: iso(15),
          expectedStatus: "review",
        });

        const verifyStage = yield* startStage({
          harness,
          role: "verify",
          suffix: "verify",
          instructions: "Verify the implementation.",
          response: successfulTurnResponse("verify", iso(16)),
          expectedInstanceId: DEFAULT_INSTANCE,
          createdAt: iso(16),
        });
        assert.equal(verifyStage.stageStarted.payload.providerInstanceId, DEFAULT_INSTANCE);
        const verifyUserText = userText(verifyStage.thread);
        assert.equal(countOccurrences(verifyUserText, VERIFY_PREFIX), 1);
        assert.equal(countOccurrences(verifyUserText, STAGE_PREFIX_MARKER), 1);
        yield* completeStage({
          harness,
          role: "verify",
          stageThreadId: verifyStage.stageStarted.payload.stageThreadId,
          suffix: "verify",
          createdAt: iso(17),
          expectedStatus: "verifying",
        });

        yield* requestAndApproveGate({
          harness,
          gate: "land",
          gateId: gateId("land"),
          contentHash: "sha256:p7-land",
          stageThreadId: verifyStage.stageStarted.payload.stageThreadId,
          suffix: "land",
          requestedAt: iso(18),
          resolvedAt: iso(19),
        });
        yield* harness.engine
          .dispatch({
            type: "task.land",
            commandId: commandId("task-land"),
            taskId: TASK_ID,
            createdAt: iso(20),
          })
          .pipe(Effect.orDie);

        const landedTask = yield* waitForTask(
          harness,
          (task) => task.status === "landed",
          "landed",
        );
        assert.deepEqual(landedTask.stageThreadIds, [
          classifyStage.stageStarted.payload.stageThreadId,
          planStage.stageStarted.payload.stageThreadId,
          reviewStage.stageStarted.payload.stageThreadId,
          blockedWorkStage.stageStarted.payload.stageThreadId,
          resumedWorkStage.stageStarted.payload.stageThreadId,
          verifyStage.stageStarted.payload.stageThreadId,
        ]);

        const snapshot = yield* latestSnapshot(harness);
        assert.equal(
          snapshot.stageHistory[blockedWorkStage.stageStarted.payload.stageThreadId]?.status,
          "blocked",
        );
        assert.equal(
          snapshot.stageHistory[resumedWorkStage.stageStarted.payload.stageThreadId]?.status,
          "completed",
        );
        assert.equal(
          snapshot.stageHistory[verifyStage.stageStarted.payload.stageThreadId]?.providerInstanceId,
          DEFAULT_INSTANCE,
        );
      }),
    ),
  FULL_PIPELINE_TIMEOUT_MS,
);

it.live("reloads blocked-stage pipeline position and role overrides across engine restart", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      yield* seedProjectAndTask(harness);
      yield* harness.engine
        .dispatch({
          type: "task.classify",
          commandId: commandId("restart-task-classify"),
          taskId: TASK_ID,
          taskType: TASK_TYPE,
          playbookVersion: "p7-playbook",
          createdAt: iso(21),
        })
        .pipe(Effect.orDie);

      const blockedWorkStage = yield* startStage({
        harness,
        role: "work",
        suffix: "restart-work-blocked",
        instructions: "Implement enough to block, then resume after restart.",
        response: quotaBlockedTurnResponse("restart-work-blocked", iso(22)),
        expectedInstanceId: TASK_INSTANCE,
        createdAt: iso(22),
      });
      yield* waitForTask(
        harness,
        (task) => task.status === "blocked-on-quota" && task.currentStageThreadId === null,
        "blocked stage before restart",
      );
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
            const restartedTask = restartedSnapshot.tasks.find((task) => task.id === TASK_ID);
            assert.equal(restartedTask?.status, "blocked-on-quota");
            assert.equal(restartedTask?.currentStageThreadId, null);
            assert.equal(restartedTask?.roleModelSelections?.work?.instanceId, TASK_INSTANCE);

            const blockedHistory =
              restartedSnapshot.stageHistory[blockedWorkStage.stageStarted.payload.stageThreadId];
            assert.equal(blockedHistory?.status, "blocked");
            assert.equal(blockedHistory?.providerInstanceId, TASK_INSTANCE);
            assert.equal(blockedHistory?.role, "work");

            const blockedQuotaRow = restartedSnapshot.quotaBlockedStages.find(
              (stage) =>
                stage.stageThreadId === blockedWorkStage.stageStarted.payload.stageThreadId,
            );
            assert.equal(blockedQuotaRow?.status, "blocked");
            assert.equal(blockedQuotaRow?.providerInstanceId, TASK_INSTANCE);

            const resumedWorkStage = yield* resumeStageAfterQuotaOk({
              harness: restarted,
              blockedStageThreadId: blockedWorkStage.stageStarted.payload.stageThreadId,
              suffix: "restart-work-resumed",
              response: successfulTurnResponse("restart-work-resumed", iso(23)),
              expectedInstanceId: TASK_INSTANCE,
              clearedAt: iso(23),
            });
            assert.equal(resumedWorkStage.stageStarted.payload.providerInstanceId, TASK_INSTANCE);
            const resumedUserText = userText(resumedWorkStage.thread);
            assert.equal(countOccurrences(resumedUserText, WORK_PREFIX), 1);
            assert.equal(countOccurrences(resumedUserText, STAGE_PREFIX_MARKER), 1);

            const resumedSnapshot = yield* latestSnapshot(restarted);
            const resumedQuotaRow = resumedSnapshot.quotaBlockedStages.find(
              (stage) =>
                stage.stageThreadId === blockedWorkStage.stageStarted.payload.stageThreadId,
            );
            assert.equal(resumedQuotaRow?.status, "resumed");
            assert.equal(resumedQuotaRow?.resumedAt, iso(23));
          }),
        (restarted) => restarted.dispose,
      );
    }),
  ),
);
