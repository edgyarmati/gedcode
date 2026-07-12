// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ProviderInstanceId, TaskId, TaskTypeId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { makeOrchestrationIntegrationHarness } from "./OrchestrationEngineHarness.integration.ts";

const projectId = ProjectId.make("project-shared-workspace-lease");
const taskId = TaskId.make("task-shared-workspace-lease");
const createdAt = "2026-07-12T05:00:00.000Z";

function waitForFile(filePath: string) {
  return Effect.gen(function* () {
    const deadline = (yield* Clock.currentTimeMillis) + 5_000;
    while (!existsSync(filePath)) {
      if ((yield* Clock.currentTimeMillis) >= deadline) {
        return yield* Effect.die(new Error(`Timed out waiting for '${filePath}'.`));
      }
      yield* Effect.sleep(10);
    }
  });
}

it.layer(NodeServices.layer)(
  "keeps a worktree owned by a task in a separate runtime database",
  (it) => {
    it.effect("shares the filesystem lease across independent event stores", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem;
          const testRoot = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "gedcode-worktree-lease-integration-",
          });
          const workspaceDir = path.join(testRoot, "workspace");
          const owner = yield* makeOrchestrationIntegrationHarness({
            rootDir: path.join(testRoot, "owner-state"),
            workspaceDir,
            startReactors: false,
            taskWorktreeReactor: {
              enabled: true,
              reaperIntervalMsOverride: 60_000,
              leaseDurationMsOverride: 180_000,
              orphanGracePeriodMsOverride: 60_000,
            },
          });

          yield* Effect.addFinalizer(() => owner.dispose);
          yield* owner.engine
            .dispatch({
              type: "project.create",
              commandId: CommandId.make("cmd-shared-lease-owner-project"),
              projectId,
              title: "Shared workspace",
              workspaceRoot: workspaceDir,
              defaultModelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5-codex",
              },
              orchestratorConfig: {},
              createdAt,
            })
            .pipe(Effect.orDie);
          yield* owner.engine
            .dispatch({
              type: "task.create",
              commandId: CommandId.make("cmd-shared-lease-owner-task"),
              taskId,
              projectId,
              taskType: TaskTypeId.make("feature"),
              title: "Keep this worktree",
              pmMessageId: null,
              branch: "orchestrator/shared-workspace-lease",
              createdAt,
            })
            .pipe(Effect.orDie);

          const worktreePath = path.join(
            workspaceDir,
            ".gedcode",
            "orchestrator",
            "tasks",
            String(taskId),
          );
          execFileSync(
            "git",
            ["worktree", "add", "-b", "orchestrator/shared-workspace-lease", worktreePath, "HEAD"],
            { cwd: workspaceDir, stdio: "ignore" },
          );
          yield* owner.startTaskWorktreeReactor;

          const leasePath = path.join(
            workspaceDir,
            ".gedcode",
            "orchestrator",
            "task-worktree-leases",
            `${String(taskId)}.json`,
          );
          yield* waitForFile(leasePath);

          const observer = yield* makeOrchestrationIntegrationHarness({
            rootDir: path.join(testRoot, "observer-state"),
            workspaceDir,
            startReactors: false,
            taskWorktreeReactor: {
              enabled: true,
              reaperIntervalMsOverride: 60_000,
              leaseDurationMsOverride: 180_000,
              orphanGracePeriodMsOverride: 60_000,
            },
          });
          yield* Effect.addFinalizer(() => observer.dispose);
          yield* observer.engine
            .dispatch({
              type: "project.create",
              commandId: CommandId.make("cmd-shared-lease-observer-project"),
              projectId,
              title: "Shared workspace",
              workspaceRoot: workspaceDir,
              defaultModelSelection: {
                instanceId: ProviderInstanceId.make("codex"),
                model: "gpt-5-codex",
              },
              orchestratorConfig: {},
              createdAt,
            })
            .pipe(Effect.orDie);
          yield* observer.startTaskWorktreeReactor;
          yield* Effect.yieldNow;
          yield* Effect.yieldNow;

          assert.equal(observer.landingMocks?.removeWorktreeCalls.length, 0);
          assert.isTrue(existsSync(worktreePath));
          assert.isTrue(existsSync(leasePath));
        }),
      ),
    );
  },
);
