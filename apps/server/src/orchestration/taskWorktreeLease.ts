// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import type { OrchestrationProject, OrchestrationTask } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const TaskWorktreeLease = Schema.Struct({
  version: Schema.Literal(1),
  taskId: Schema.String,
  projectId: Schema.String,
  worktreePath: Schema.String,
  renewedAt: Schema.DateTimeUtcFromString,
});
type TaskWorktreeLease = typeof TaskWorktreeLease.Type;
const TaskWorktreeLeaseJson = Schema.fromJsonString(TaskWorktreeLease);
const decodeTaskWorktreeLeaseJson = Schema.decodeUnknownOption(TaskWorktreeLeaseJson);
const encodeTaskWorktreeLeaseJson = Schema.encodeSync(TaskWorktreeLeaseJson);

export const DEFAULT_ORPHAN_GRACE_PERIOD_MS = 30 * 60_000;

export function expectedTaskWorktreePath(input: {
  readonly workspaceRoot: string;
  readonly taskId: string;
}): string {
  return path.resolve(input.workspaceRoot, ".gedcode", "orchestrator", "tasks", input.taskId);
}

export function isDeterministicTaskWorktreePath(input: {
  readonly workspaceRoot: string;
  readonly taskId: string;
  readonly worktreePath: string;
}): boolean {
  return (
    path.resolve(input.worktreePath) ===
    expectedTaskWorktreePath({ workspaceRoot: input.workspaceRoot, taskId: input.taskId })
  );
}

export function taskOwnsWorktree(task: OrchestrationTask): boolean {
  return (
    (task.status !== "landed" && task.status !== "abandoned") ||
    (task.status === "landed" && task.prUrl === null)
  );
}

export function taskWorktreeLeasePath(input: {
  readonly workspaceRoot: string;
  readonly taskId: string;
}) {
  return path.resolve(
    input.workspaceRoot,
    ".gedcode",
    "orchestrator",
    "task-worktree-leases",
    `${input.taskId}.json`,
  );
}

export interface TaskWorktreeLeaseStoreOptions {
  readonly leaseDurationMs: number;
  readonly orphanGracePeriodMs: number;
  readonly nowMsOverride?: () => number;
}

export const makeTaskWorktreeLeaseStore = (options: TaskWorktreeLeaseStoreOptions) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const clock = yield* Clock.Clock;
    const currentTimeMs = options.nowMsOverride
      ? Effect.sync(options.nowMsOverride)
      : clock.currentTimeMillis;

    const readPathTimestampMs = Effect.fn("readTaskWorktreePathTimestamp")(function* (
      targetPath: string,
    ) {
      const info = yield* fileSystem.stat(targetPath);
      const timestamps = [info.mtime, info.birthtime].flatMap((timestamp) =>
        Option.isSome(timestamp) ? [timestamp.value.getTime()] : [],
      );
      return timestamps.length === 0 ? null : Math.max(...timestamps);
    });

    const read = Effect.fn("readTaskWorktreeLease")(function* (input: {
      readonly workspaceRoot: string;
      readonly taskId: string;
    }) {
      const leasePath = taskWorktreeLeasePath(input);
      const exists = yield* fileSystem.exists(leasePath);
      if (!exists) {
        return { lease: null, observedAtMs: null };
      }
      const [raw, observedAtMs] = yield* Effect.all([
        fileSystem.readFileString(leasePath),
        readPathTimestampMs(leasePath),
      ]);
      return {
        lease: Option.getOrNull(decodeTaskWorktreeLeaseJson(raw)),
        observedAtMs,
      };
    });

    const renew = Effect.fn("renewTaskWorktreeLease")(function* (input: {
      readonly task: OrchestrationTask;
      readonly project: OrchestrationProject;
    }) {
      const worktreePath = input.task.worktreePath;
      if (
        worktreePath === null ||
        !taskOwnsWorktree(input.task) ||
        !isDeterministicTaskWorktreePath({
          workspaceRoot: input.project.workspaceRoot,
          taskId: String(input.task.id),
          worktreePath,
        })
      ) {
        return;
      }
      const lease: TaskWorktreeLease = {
        version: 1,
        taskId: String(input.task.id),
        projectId: String(input.task.projectId),
        worktreePath: path.resolve(worktreePath),
        renewedAt: DateTime.makeUnsafe(yield* currentTimeMs),
      };
      const leasePath = taskWorktreeLeasePath({
        workspaceRoot: input.project.workspaceRoot,
        taskId: String(input.task.id),
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* fileSystem.makeDirectory(path.dirname(leasePath), { recursive: true });
          const tempDirectory = yield* fileSystem.makeTempDirectoryScoped({
            directory: path.dirname(leasePath),
            prefix: `${path.basename(leasePath)}.`,
          });
          const tempPath = path.join(tempDirectory, "lease.tmp");
          yield* fileSystem.writeFileString(tempPath, `${encodeTaskWorktreeLeaseJson(lease)}\n`);
          yield* fileSystem.rename(tempPath, leasePath);
        }),
      );
    });

    const release = Effect.fn("releaseTaskWorktreeLease")(function* (input: {
      readonly workspaceRoot: string;
      readonly taskId: string;
    }) {
      yield* fileSystem.remove(taskWorktreeLeasePath(input), { force: true });
    });

    const isOrphanProtected = Effect.fn("isOrphanTaskWorktreeProtected")(function* (input: {
      readonly workspaceRoot: string;
      readonly taskId: string;
      readonly worktreePath: string;
    }) {
      const nowMs = yield* currentTimeMs;
      const [leaseResult, worktreeTimestampResult] = yield* Effect.all([
        Effect.result(read({ workspaceRoot: input.workspaceRoot, taskId: input.taskId })),
        Effect.result(readPathTimestampMs(input.worktreePath)),
      ]);
      if (worktreeTimestampResult._tag === "Failure" || leaseResult._tag === "Failure") {
        return true;
      }

      const { lease, observedAtMs } = leaseResult.success;
      if (
        lease !== null &&
        lease.taskId === input.taskId &&
        path.resolve(lease.worktreePath) === path.resolve(input.worktreePath)
      ) {
        return (
          nowMs <
          DateTime.toEpochMillis(lease.renewedAt) +
            options.leaseDurationMs +
            options.orphanGracePeriodMs
        );
      }
      const newestObservedAt = Math.max(
        worktreeTimestampResult.success ?? Number.NEGATIVE_INFINITY,
        observedAtMs ?? Number.NEGATIVE_INFINITY,
      );
      return (
        !Number.isFinite(newestObservedAt) || nowMs < newestObservedAt + options.orphanGracePeriodMs
      );
    });

    return { renew, release, isOrphanProtected } as const;
  });
