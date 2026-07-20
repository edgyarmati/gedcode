// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationReadModel,
  type OrchestrationTask,
  type ProjectId,
  type TaskId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Result from "effect/Result";

import {
  ExternalProcessLaunchError,
  type ExternalLauncherShape,
} from "../process/externalLauncher.ts";
import {
  launchOwnedOrchestratorTarget,
  resolveOwnedOrchestratorLaunchTarget,
} from "./orchestratorLauncher.ts";

const projectId = "project-1" as ProjectId;
const taskId = "task-1" as TaskId;

function makeReadModel(input: {
  readonly workspaceRoot: string;
  readonly taskProjectId?: ProjectId;
  readonly worktreePath?: string | null;
  readonly taskStatus?: OrchestrationTask["status"];
}): OrchestrationReadModel {
  return {
    projects: [{ id: projectId, workspaceRoot: input.workspaceRoot }],
    tasks: [
      {
        id: taskId,
        projectId: input.taskProjectId ?? projectId,
        worktreePath: input.worktreePath ?? null,
        status: input.taskStatus ?? "implementing",
        prUrl: null,
      },
    ],
  } as unknown as OrchestrationReadModel;
}

function launcher(overrides: Partial<ExternalLauncherShape> = {}): ExternalLauncherShape {
  return {
    launchBrowser: () => Effect.void,
    launchEditor: () => Effect.void,
    launchFileManager: () => Effect.void,
    launchTerminal: () => Effect.void,
    ...overrides,
  };
}

it.effect("derives registered roots and rejects foreign or forged task worktrees", () =>
  Effect.gen(function* () {
    const workspaceRoot = "/repo/project";
    const expectedWorktree = path.resolve(workspaceRoot, ".gedcode/orchestrator/tasks/task-1");
    const readModel = makeReadModel({ workspaceRoot, worktreePath: expectedWorktree });

    assert.strictEqual(
      yield* resolveOwnedOrchestratorLaunchTarget(
        {
          target: { kind: "project-root", projectId },
          operation: { kind: "reveal" },
        },
        readModel,
      ),
      workspaceRoot,
    );
    assert.strictEqual(
      yield* resolveOwnedOrchestratorLaunchTarget(
        {
          target: { kind: "task-worktree", projectId, taskId },
          operation: { kind: "terminal" },
        },
        readModel,
      ),
      expectedWorktree,
    );

    const mismatch = yield* Effect.result(
      resolveOwnedOrchestratorLaunchTarget(
        {
          target: {
            kind: "task-worktree",
            projectId: "project-2" as ProjectId,
            taskId,
          },
          operation: { kind: "terminal" },
        },
        readModel,
      ),
    );
    assert.isTrue(Result.isFailure(mismatch));
    if (Result.isFailure(mismatch)) {
      assert.strictEqual(mismatch.failure.reason, "project-mismatch");
    }

    const forged = yield* Effect.result(
      resolveOwnedOrchestratorLaunchTarget(
        {
          target: { kind: "task-worktree", projectId, taskId },
          operation: { kind: "terminal" },
        },
        makeReadModel({ workspaceRoot, worktreePath: "/tmp/forged" }),
      ),
    );
    assert.isTrue(Result.isFailure(forged));
    if (Result.isFailure(forged)) {
      assert.strictEqual(forged.failure.reason, "target-not-owned");
    }
  }),
);

it.layer(NodeServices.layer)("launchOwnedOrchestratorTarget", (it) => {
  it.effect("launches the selected operation at the exact owned worktree", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped();
        const worktreePath = path.join(
          workspaceRoot,
          ".gedcode",
          "orchestrator",
          "tasks",
          String(taskId),
        );
        yield* fileSystem.makeDirectory(worktreePath, { recursive: true });
        const launched: string[] = [];
        const readModel = makeReadModel({ workspaceRoot, worktreePath });

        const result = yield* launchOwnedOrchestratorTarget(
          {
            target: { kind: "task-worktree", projectId, taskId },
            operation: { kind: "terminal" },
          },
          {
            snapshotQuery: { getCommandReadModel: () => Effect.succeed(readModel) },
            externalLauncher: launcher({
              launchTerminal: (cwd) => Effect.sync(() => void launched.push(cwd)),
            }),
            getCapabilities: () => ({ editors: [], reveal: false, terminal: true }),
          },
        );

        assert.deepEqual(launched, [worktreePath]);
        assert.strictEqual(result.launched, true);
      }),
    ),
  );

  it.effect("distinguishes unavailable capabilities from process launch failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped();
        const readModel = makeReadModel({ workspaceRoot });
        const input = {
          target: { kind: "project-root" as const, projectId },
          operation: { kind: "terminal" as const },
        };

        const unsupported = yield* Effect.result(
          launchOwnedOrchestratorTarget(input, {
            snapshotQuery: { getCommandReadModel: () => Effect.succeed(readModel) },
            externalLauncher: launcher(),
            getCapabilities: () => ({ editors: [], reveal: false, terminal: false }),
          }),
        );
        assert.isTrue(Result.isFailure(unsupported));
        if (Result.isFailure(unsupported)) {
          assert.strictEqual(unsupported.failure.reason, "capability-unavailable");
        }

        const failed = yield* Effect.result(
          launchOwnedOrchestratorTarget(input, {
            snapshotQuery: { getCommandReadModel: () => Effect.succeed(readModel) },
            externalLauncher: launcher({
              launchTerminal: () =>
                Effect.fail(
                  new ExternalProcessLaunchError({
                    operation: "terminal",
                    command: "terminal",
                    args: [],
                    message: "spawn failed",
                    cause: new Error("no display"),
                  }),
                ),
            }),
            getCapabilities: () => ({ editors: [], reveal: false, terminal: true }),
          }),
        );
        assert.isTrue(Result.isFailure(failed));
        if (Result.isFailure(failed)) {
          assert.strictEqual(failed.failure.reason, "launcher-failed");
        }
      }),
    ),
  );
});
