import {
  CommandId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { TestTurnResponse } from "./TestProviderAdapter.integration.ts";
import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const PROVIDER = ProviderDriverKind.make("codex");
const INSTANCE_ID = ProviderInstanceId.make("codex");
const PROJECT_ID = ProjectId.make("project-orphan-stage-recovery");
const TASK_ID = TaskId.make("task-orphan-stage-recovery");
const MODEL_SELECTION: ModelSelection = {
  instanceId: INSTANCE_ID,
  model: "gpt-5-default",
};
const commandId = (suffix: string) => CommandId.make(`cmd-orphan-stage-${suffix}`);
const iso = (seconds: number) => `2026-07-11T01:00:${String(seconds).padStart(2, "0")}.000Z`;

const readEvents = (harness: OrchestrationIntegrationHarness) =>
  Stream.runCollect(harness.engine.readEvents(0)).pipe(
    Effect.map((events): ReadonlyArray<OrchestrationEvent> => Array.from(events)),
  );

const successfulTurnResponse = (): TestTurnResponse => ({
  events: [
    {
      type: "turn.started",
      eventId: EventId.make("evt-orphan-retry-turn-started"),
      provider: PROVIDER,
      threadId: ThreadId.make("fixture-thread"),
      turnId: TurnId.make("fixture-turn"),
      createdAt: iso(6),
    },
    {
      type: "message.delta",
      eventId: EventId.make("evt-orphan-retry-message"),
      provider: PROVIDER,
      threadId: ThreadId.make("fixture-thread"),
      turnId: TurnId.make("fixture-turn"),
      delta: "retry completed\n",
      createdAt: iso(6),
    },
    {
      type: "turn.completed",
      eventId: EventId.make("evt-orphan-retry-turn-completed"),
      provider: PROVIDER,
      threadId: ThreadId.make("fixture-thread"),
      turnId: TurnId.make("fixture-turn"),
      status: "completed",
      createdAt: iso(6),
    },
  ],
});

it.live(
  "settles an orphaned active stage after restart and permits a fresh handoff",
  () =>
    Effect.gen(function* () {
      const runtimeA = yield* makeOrchestrationIntegrationHarness({
        provider: PROVIDER,
        startReactors: false,
      });
      const rootDir = runtimeA.rootDir;

      yield* runtimeA.engine
        .dispatch({
          type: "project.create",
          commandId: commandId("project-create"),
          projectId: PROJECT_ID,
          title: "Orphan stage recovery",
          workspaceRoot: runtimeA.workspaceDir,
          defaultModelSelection: MODEL_SELECTION,
          orchestratorConfig: {},
          createdAt: iso(0),
        })
        .pipe(Effect.orDie);
      yield* runtimeA.engine
        .dispatch({
          type: "task.create",
          commandId: commandId("task-create"),
          taskId: TASK_ID,
          projectId: PROJECT_ID,
          taskType: TaskTypeId.make("feature"),
          title: "Recover an orphaned worker",
          pmMessageId: null,
          branch: "orchestrator/orphan-stage-recovery",
          createdAt: iso(1),
        })
        .pipe(Effect.orDie);
      yield* runtimeA.engine
        .dispatch({
          type: "task.stage.start",
          commandId: commandId("first-stage-start"),
          taskId: TASK_ID,
          role: "work",
          instructions: "Start work before the server exits.",
          createdAt: iso(2),
        })
        .pipe(Effect.orDie);

      const firstStageEvent = (yield* readEvents(runtimeA)).find(
        (event) => event.type === "task.stage-started" && event.payload.taskId === TASK_ID,
      );
      assert.equal(firstStageEvent?.type, "task.stage-started");
      if (firstStageEvent?.type !== "task.stage-started") return;
      const firstStageThreadId = firstStageEvent.payload.stageThreadId;
      const firstThread = (yield* runtimeA.snapshotQuery.getSnapshot()).threads.find(
        (thread) => thread.id === firstStageThreadId,
      );
      assert.ok(firstThread);
      yield* runtimeA.engine
        .dispatch({
          type: "thread.session.set",
          commandId: commandId("orphan-session-running"),
          threadId: firstStageThreadId,
          session: {
            threadId: firstStageThreadId,
            status: "running",
            providerName: "codex",
            providerInstanceId: INSTANCE_ID,
            runtimeMode: firstThread.runtimeMode,
            activeTurnId: TurnId.make("orphan-turn"),
            lastError: null,
            updatedAt: iso(3),
          },
          createdAt: iso(3),
        })
        .pipe(Effect.orDie);
      yield* runtimeA.dispose;

      const runtimeB = yield* makeOrchestrationIntegrationHarness({
        provider: PROVIDER,
        rootDir,
        orphanTurnReconciler: { enabled: true },
      });
      const recovered = yield* runtimeB.snapshotQuery.getSnapshot();
      const recoveredTask = recovered.tasks.find((task) => task.id === TASK_ID);
      const recoveredThread = recovered.threads.find((thread) => thread.id === firstStageThreadId);
      assert.equal(recoveredTask?.status, "blocked");
      assert.equal(recoveredTask?.currentStageThreadId, null);
      assert.equal(recovered.stageHistory[firstStageThreadId]?.status, "interrupted");
      assert.equal(recoveredThread?.session?.status, "interrupted");
      assert.equal(recoveredThread?.session?.activeTurnId, null);
      assert.equal(
        (yield* readEvents(runtimeB)).filter(
          (event) => event.type === "task.stage-interrupted" && event.payload.taskId === TASK_ID,
        ).length,
        1,
      );

      assert.ok(runtimeB.adapterHarness);
      yield* runtimeB.adapterHarness.queueTurnResponseForNextSession(successfulTurnResponse());
      yield* runtimeB.engine
        .dispatch({
          type: "task.stage.start",
          commandId: commandId("retry-stage-start"),
          taskId: TASK_ID,
          role: "work",
          instructions: "Continue from the recovered worktree in a fresh worker.",
          createdAt: iso(5),
        })
        .pipe(Effect.orDie);
      const retriedTask = (yield* runtimeB.snapshotQuery.getSnapshot()).tasks.find(
        (task) => task.id === TASK_ID,
      );
      assert.equal(retriedTask?.status, "working");
      assert.notEqual(retriedTask?.currentStageThreadId, firstStageThreadId);
      assert.ok(retriedTask?.currentStageThreadId);

      yield* runtimeB.dispose;
    }).pipe(Effect.provide(NodeServices.layer)),
  120_000,
);
