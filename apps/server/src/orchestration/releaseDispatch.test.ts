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
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as VcsProcess from "../vcs/VcsProcess.ts";

import { createEmptyReadModel } from "./projector.ts";
import {
  dispatchReleaseWithServices,
  OrchestrationReleaseDispatchError,
  releaseDispatchContentHash,
} from "./releaseDispatch.ts";

const now = "2026-07-15T00:00:00.000Z";
const taskId = TaskId.make("task-release");
const projectId = ProjectId.make("project-release");
const parameters = { workflow: "release.yml", ref: "main", inputs: { version: "1.2.3" } };

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

function makeReadModel(
  releaseDispatch: OrchestrationTask["releaseDispatch"] = null,
): OrchestrationReadModel {
  const task: OrchestrationTask = {
    id: taskId,
    projectId,
    type: TaskTypeId.make("release"),
    title: "Release 1.2.3",
    status: "landed",
    branch: "orchestrator/task-release",
    worktreePath: "/repo/.gedcode/orchestrator/tasks/task-release",
    prUrl: "https://github.com/acme/repo/pull/2",
    pmMessageId: null,
    stageThreadIds: [],
    currentStageThreadId: null,
    dependsOnTaskIds: [TaskId.make("task-source")],
    cancellation: null,
    changeReview: null,
    verification: null,
    noChangesNeeded: null,
    landing: null,
    releaseDispatch,
    roleModelSelections: {},
    playbookVersion: "release@v1",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    deletedAt: null,
  };
  return {
    ...createEmptyReadModel(now),
    snapshotSequence: releaseDispatch === null ? 10 : 12,
    projects: [
      {
        id: projectId,
        title: "Release project",
        workspaceRoot: "/repo",
        repositoryIdentity: null,
        defaultModelSelection: null,
        roleModelSelections: {},
        rolePromptPrefixes: {},
        orchestratorConfig: {},
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    tasks: [task],
  };
}

it.effect("serializes repeated release dispatches into one GitHub workflow invocation", () =>
  Effect.gen(function* () {
    let readModel = makeReadModel();
    const githubArgs: ReadonlyArray<string>[] = [];
    const commands: string[] = [];
    let commandIndex = 0;
    const run = () =>
      dispatchReleaseWithServices(
        {
          snapshotQuery: { getCommandReadModel: () => Effect.succeed(readModel) },
          process: {
            run: () => Effect.succeed(processOutput("")),
          },
          github: {
            execute: ({ args }) =>
              Effect.sync(() => {
                githubArgs.push(args);
                return processOutput(args[0] === "repo" ? "acme/repo\n" : "");
              }),
          },
        },
        {
          taskId,
          ...parameters,
          commandId: (purpose) => Effect.succeed(CommandId.make(`${purpose}-${++commandIndex}`)),
          createdAt: Effect.succeed(now),
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command.type);
              if (command.type === "task.release.dispatch.request") {
                readModel = makeReadModel({
                  status: "dispatching",
                  workflow: command.workflow,
                  ref: command.ref,
                  inputs: command.inputs,
                  contentHash: command.contentHash,
                  workflowUrl: null,
                  failureMessage: null,
                  requestedAt: command.createdAt,
                  updatedAt: command.createdAt,
                });
              } else if (command.type === "task.release.dispatch.complete") {
                readModel = makeReadModel({
                  ...readModel.tasks[0]!.releaseDispatch!,
                  status: "dispatched",
                  workflowUrl: command.workflowUrl,
                  updatedAt: command.createdAt,
                });
              }
              return { sequence: commands.length + 10 };
            }),
        },
      );

    const results = yield* Effect.all([run(), run()], { concurrency: "unbounded" });
    assert.deepStrictEqual(commands, [
      "task.release.dispatch.request",
      "task.release.dispatch.complete",
    ]);
    assert.strictEqual(githubArgs.filter((args) => args[0] === "workflow").length, 1);
    assert.strictEqual(results.filter((result) => result.alreadyRequested).length, 1);
    assert.strictEqual(
      readModel.tasks[0]?.releaseDispatch?.workflowUrl,
      "https://github.com/acme/repo/actions/workflows/release.yml",
    );
  }),
);

it.effect("refuses a dirty repository before reserving or dispatching", () =>
  Effect.gen(function* () {
    let dispatched = false;
    const error = yield* Effect.flip(
      dispatchReleaseWithServices(
        {
          snapshotQuery: { getCommandReadModel: () => Effect.succeed(makeReadModel()) },
          process: {
            run: () => Effect.succeed(processOutput(" M package.json\n")),
          },
          github: { execute: () => Effect.die("GitHub must not run") },
        },
        {
          taskId,
          ...parameters,
          commandId: () => Effect.succeed(CommandId.make("unused")),
          createdAt: Effect.succeed(now),
          dispatch: () =>
            Effect.sync(() => {
              dispatched = true;
              return { sequence: 1 };
            }),
        },
      ),
    );
    assert.instanceOf(error, OrchestrationReleaseDispatchError);
    assert.strictEqual(error.reason, "dirty-worktree");
    assert.isFalse(dispatched);
  }),
);

it("hashes normalized workflow parameters deterministically", () => {
  assert.strictEqual(
    releaseDispatchContentHash({
      workflow: " release.yml ",
      ref: " main ",
      inputs: { version: "1.2.3", channel: "stable" },
    }),
    releaseDispatchContentHash({
      workflow: "release.yml",
      ref: "main",
      inputs: { channel: "stable", version: "1.2.3" },
    }),
  );
});
