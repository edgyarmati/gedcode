import {
  CommandId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskId,
  TaskTypeId,
  type ModelSelection,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import {
  makeOrchestrationIntegrationHarness,
  type OrchestrationIntegrationHarness,
} from "./OrchestrationEngineHarness.integration.ts";

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const PROJECT_ID = ProjectId.make("project-cancellation-recovery");
const TASK_ID = TaskId.make("task-cancellation-recovery");
const TASK_TYPE = TaskTypeId.make("feature");
const MODEL_SELECTION: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-default",
};

const commandId = (suffix: string) => CommandId.make(`cmd-cancellation-recovery-${suffix}`);
const iso = (seconds: number) => `2026-07-11T00:00:${String(seconds).padStart(2, "0")}.000Z`;

const readEvents = (harness: OrchestrationIntegrationHarness) =>
  Stream.runCollect(harness.engine.readEvents(0)).pipe(
    Effect.map((events): ReadonlyArray<OrchestrationEvent> => Array.from(events)),
  );

const countAbandonedEvents = (harness: OrchestrationIntegrationHarness) =>
  readEvents(harness).pipe(
    Effect.map(
      (events) =>
        events.filter(
          (event) => event.type === "task.abandoned" && event.payload.taskId === TASK_ID,
        ).length,
    ),
  );

it.live(
  "resumes a persisted cancellation reservation once across repeated restarts",
  () =>
    Effect.gen(function* () {
      const rootDir = yield* Effect.acquireUseRelease(
        makeOrchestrationIntegrationHarness({ provider: CODEX_PROVIDER }),
        (runtimeA) =>
          Effect.gen(function* () {
            yield* runtimeA.engine
              .dispatch({
                type: "project.create",
                commandId: commandId("project-create"),
                projectId: PROJECT_ID,
                title: "Cancellation recovery",
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
                taskType: TASK_TYPE,
                title: "Recover cancellation after restart",
                pmMessageId: null,
                branch: "orchestrator/cancellation-recovery",
                createdAt: iso(1),
              })
              .pipe(Effect.orDie);
            yield* runtimeA.engine
              .dispatch({
                type: "task.cancellation.request",
                commandId: commandId("cancellation-request"),
                taskId: TASK_ID,
                createdAt: iso(2),
              })
              .pipe(Effect.orDie);
            yield* runtimeA.engine
              .dispatch({
                type: "task.cancellation.phase.complete",
                commandId: commandId("interrupt-checkpoint"),
                taskId: TASK_ID,
                phase: "interrupt-turn",
                createdAt: iso(3),
              })
              .pipe(Effect.orDie);
            yield* runtimeA.waitForDomainEvent(
              (event) =>
                event.type === "task.cancellation-phase-completed" &&
                event.payload.taskId === TASK_ID &&
                event.payload.phase === "interrupt-turn",
            );
            assert.equal(yield* countAbandonedEvents(runtimeA), 0);
            return runtimeA.rootDir;
          }),
        (runtimeA) => runtimeA.dispose,
      );

      yield* Effect.acquireUseRelease(
        makeOrchestrationIntegrationHarness({
          provider: CODEX_PROVIDER,
          rootDir,
          taskCancellationReconciler: { enabled: true },
        }),
        (runtimeB) =>
          Effect.gen(function* () {
            const recoveredTask = (yield* runtimeB.snapshotQuery.getSnapshot()).tasks.find(
              (task) => task.id === TASK_ID,
            );
            assert.equal(recoveredTask?.status, "abandoned");
            assert.deepEqual(recoveredTask?.cancellation?.completedPhases, ["interrupt-turn"]);
            assert.equal(yield* countAbandonedEvents(runtimeB), 1);
          }),
        (runtimeB) => runtimeB.dispose,
      );

      yield* Effect.acquireUseRelease(
        makeOrchestrationIntegrationHarness({
          provider: CODEX_PROVIDER,
          rootDir,
          taskCancellationReconciler: { enabled: true },
        }),
        (runtimeC) =>
          Effect.gen(function* () {
            const terminalTask = (yield* runtimeC.snapshotQuery.getSnapshot()).tasks.find(
              (task) => task.id === TASK_ID,
            );
            assert.equal(terminalTask?.status, "abandoned");
            assert.equal(yield* countAbandonedEvents(runtimeC), 1);
          }),
        (runtimeC) => runtimeC.dispose,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  120_000,
);
