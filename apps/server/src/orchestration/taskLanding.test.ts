import {
  CommandId,
  ProjectId,
  TaskId,
  TaskTypeId,
  type OrchestrationReadModel,
  type OrchestrationTask,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createEmptyReadModel } from "./projector.ts";
import { landOrchestrationTaskWithServices, OrchestrationLandTaskError } from "./taskLanding.ts";

const now = "2026-07-11T00:00:00.000Z";
const taskId = TaskId.make("task-land");

const makeTask = (
  status: OrchestrationTask["status"],
  landing: OrchestrationTask["landing"] = null,
): OrchestrationTask => ({
  id: taskId,
  projectId: ProjectId.make("project-land"),
  type: TaskTypeId.make("feature"),
  title: "Land safely",
  status,
  branch: "orchestrator/task-land",
  worktreePath: "/repo/.gedcode/orchestrator/tasks/task-land",
  prUrl: null,
  pmMessageId: null,
  stageThreadIds: [],
  currentStageThreadId: null,
  cancellation: null,
  landing,
  roleModelSelections: {},
  playbookVersion: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  deletedAt: null,
});

const makeReadModel = (
  status: OrchestrationTask["status"],
  sequence = 10,
  landing: OrchestrationTask["landing"] = null,
) => ({
  ...createEmptyReadModel(now),
  snapshotSequence: sequence,
  tasks: [makeTask(status, landing)],
});

it.effect("dispatches landing once and returns an idempotent result after landing", () =>
  Effect.gen(function* () {
    let readModel: OrchestrationReadModel = makeReadModel("review");
    const commands: string[] = [];
    const services = {
      snapshotQuery: {
        getCommandReadModel: () => Effect.succeed(readModel),
      },
    };
    const runLanding = landOrchestrationTaskWithServices(services, {
      taskId,
      commandId: Effect.succeed(CommandId.make("cmd-land")),
      createdAt: Effect.succeed(now),
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command.type);
          readModel = makeReadModel("landed", 11, {
            status: "opening-pr",
            failureMessage: null,
            branchPushed: false,
            updatedAt: now,
          });
          return { sequence: 11 };
        }),
    });

    const first = yield* runLanding;
    const second = yield* runLanding;

    assert.deepStrictEqual(first, {
      sequence: 11,
      alreadyLanded: false,
      alreadyInProgress: false,
    });
    assert.deepStrictEqual(second, {
      sequence: 11,
      alreadyLanded: false,
      alreadyInProgress: true,
    });
    assert.deepStrictEqual(commands, ["task.land"]);
  }),
);

it.effect("serializes concurrent landing attempts into one command", () =>
  Effect.gen(function* () {
    let readModel: OrchestrationReadModel = makeReadModel("review");
    let dispatchCount = 0;
    const services = {
      snapshotQuery: {
        getCommandReadModel: () => Effect.succeed(readModel),
      },
    };
    const runLanding = () =>
      landOrchestrationTaskWithServices(services, {
        taskId,
        commandId: Effect.yieldNow.pipe(Effect.as(CommandId.make("cmd-land-concurrent"))),
        createdAt: Effect.succeed(now),
        dispatch: () =>
          Effect.sync(() => {
            dispatchCount += 1;
            readModel = makeReadModel("landed", 11);
            return { sequence: 11 };
          }),
      });

    const results = yield* Effect.all([runLanding(), runLanding()], {
      concurrency: "unbounded",
    });

    assert.strictEqual(dispatchCount, 1);
    assert.strictEqual(results.filter((result) => result.alreadyInProgress).length, 1);
  }),
);

it.effect("retries one exhausted landing attempt and coalesces repeated requests", () =>
  Effect.gen(function* () {
    let readModel: OrchestrationReadModel = makeReadModel("landed", 20, {
      status: "failed",
      failureMessage: "provider unavailable",
      branchPushed: false,
      updatedAt: now,
    });
    const commands: string[] = [];
    const runLanding = landOrchestrationTaskWithServices(
      {
        snapshotQuery: { getCommandReadModel: () => Effect.succeed(readModel) },
      },
      {
        taskId,
        commandId: Effect.succeed(CommandId.make("cmd-land-retry")),
        createdAt: Effect.succeed("2026-07-12T01:00:00.000Z"),
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command.type);
            readModel = makeReadModel("landed", 21, {
              status: "opening-pr",
              failureMessage: null,
              branchPushed: false,
              updatedAt: "2026-07-12T01:00:00.000Z",
            });
            return { sequence: 21 };
          }),
      },
    );

    const first = yield* runLanding;
    const second = yield* runLanding;

    assert.deepStrictEqual(commands, ["task.landing.retry"]);
    assert.deepStrictEqual(first, {
      sequence: 21,
      alreadyLanded: false,
      alreadyInProgress: false,
    });
    assert.isTrue(second.alreadyInProgress);
  }),
);

it.effect("returns a typed error without dispatching when the task is missing", () =>
  Effect.gen(function* () {
    let dispatched = false;
    const error = yield* Effect.flip(
      landOrchestrationTaskWithServices(
        {
          snapshotQuery: {
            getCommandReadModel: () => Effect.succeed(createEmptyReadModel(now)),
          },
        },
        {
          taskId,
          commandId: Effect.succeed(CommandId.make("cmd-land-missing")),
          createdAt: Effect.succeed(now),
          dispatch: () =>
            Effect.sync(() => {
              dispatched = true;
              return { sequence: 1 };
            }),
        },
      ),
    );

    assert.instanceOf(error, OrchestrationLandTaskError);
    assert.isFalse(dispatched);
  }),
);
