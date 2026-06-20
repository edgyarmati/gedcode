// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import type { OrchestrationEvent, OrchestrationReadModel } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import {
  increment,
  orchestrationWorktreeReaperOrphansRemovedTotal,
} from "../../observability/Metrics.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TaskWorktreeReactor,
  type TaskWorktreeReactorShape,
} from "../Services/TaskWorktreeReactor.ts";

type TerminalTaskEvent = Extract<OrchestrationEvent, { type: "task.landed" | "task.abandoned" }>;

type CleanupCandidate = {
  readonly taskId: string;
  readonly worktreePath: string | null;
  readonly workspaceRoot: string;
  readonly reason: "terminal" | "orphaned";
};

export interface TaskWorktreeReactorLiveOptions {
  readonly reaperIntervalMsOverride?: number;
}

function expectedTaskWorktreePath(input: {
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

export function listTerminalTaskWorktreeCleanupCandidates(
  readModel: OrchestrationReadModel,
): ReadonlyArray<CleanupCandidate> {
  const projectById = new Map(readModel.projects.map((project) => [String(project.id), project]));
  return readModel.tasks.flatMap((task) => {
    if (task.worktreePath === null || (task.status !== "landed" && task.status !== "abandoned")) {
      return [];
    }
    const project = projectById.get(String(task.projectId));
    if (!project) {
      return [];
    }
    return [
      {
        taskId: String(task.id),
        worktreePath: task.worktreePath,
        workspaceRoot: project.workspaceRoot,
        reason: "terminal" as const,
      },
    ];
  });
}

export const makeTaskWorktreeReactor = (options?: TaskWorktreeReactorLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const gitWorkflow = yield* GitWorkflowService;
    const vcsProcess = yield* VcsProcess;
    const fileSystem = yield* FileSystem.FileSystem;
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const reaperIntervalMs = Math.max(
      1,
      options?.reaperIntervalMsOverride ??
        settings.orchestratorDefaults.worktreeReaperIntervalMinutes * 60_000,
    );
    const cleanupSemaphore = yield* Semaphore.make(1);
    const cleanedWorktreePaths = new Set<string>();

    const cleanupTaskWorktree = Effect.fn("cleanupTaskWorktree")(function* (
      candidate: CleanupCandidate,
    ) {
      const taskId = candidate.taskId;
      const worktreePath = candidate.worktreePath;
      if (worktreePath === null) {
        return;
      }
      if (
        !isDeterministicTaskWorktreePath({
          workspaceRoot: candidate.workspaceRoot,
          taskId,
          worktreePath,
        })
      ) {
        yield* Effect.logWarning("task worktree cleanup skipped unexpected worktree path", {
          taskId,
          workspaceRoot: candidate.workspaceRoot,
          worktreePath,
        });
        return;
      }

      const normalizedWorktreePath = path.resolve(worktreePath);
      if (cleanedWorktreePaths.has(normalizedWorktreePath)) {
        return;
      }

      const exists = yield* fileSystem.exists(worktreePath);
      if (exists) {
        yield* gitWorkflow.removeWorktree({
          cwd: candidate.workspaceRoot,
          path: worktreePath,
          force: true,
        });
        cleanedWorktreePaths.add(normalizedWorktreePath);
        yield* increment(orchestrationWorktreeReaperOrphansRemovedTotal, {
          reason: candidate.reason,
        });
        yield* Effect.logInfo("task worktree cleanup removed worktree", {
          taskId,
          workspaceRoot: candidate.workspaceRoot,
          worktreePath,
          reason: candidate.reason,
        });
      }
      yield* vcsProcess.run({
        operation: "TaskWorktreeReactor.pruneWorktrees",
        command: "git",
        args: ["worktree", "prune"],
        cwd: candidate.workspaceRoot,
        timeoutMs: 15_000,
        maxOutputBytes: 256_000,
      });
    });

    const cleanupTaskWorktreeSafely = (candidate: CleanupCandidate) =>
      cleanupTaskWorktree(candidate).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("task worktree cleanup failed", {
            taskId: candidate.taskId,
            worktreePath: candidate.worktreePath,
            cause: Cause.pretty(cause),
          });
        }),
      );

    const resolveCandidate = Effect.fn("resolveTerminalTaskCleanupCandidate")(function* (
      event: TerminalTaskEvent,
    ) {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      return listTerminalTaskWorktreeCleanupCandidates(readModel).find(
        (candidate) => candidate.taskId === String(event.payload.taskId),
      );
    });

    const processTerminalTaskEvent = Effect.fn("processTerminalTaskEvent")(function* (
      event: TerminalTaskEvent,
    ) {
      const candidate = yield* resolveCandidate(event);
      if (!candidate) {
        return;
      }
      yield* cleanupSemaphore.withPermits(1)(cleanupTaskWorktreeSafely(candidate));
    });

    const processTerminalTaskEventSafely = (event: TerminalTaskEvent) =>
      processTerminalTaskEvent(event).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.failCause(cause);
          }
          return Effect.logWarning("task worktree reactor failed to process event", {
            eventType: event.type,
            taskId: String(event.payload.taskId),
            cause: Cause.pretty(cause),
          });
        }),
      );

    const worker = yield* makeDrainableWorker(processTerminalTaskEventSafely);

    const cleanupTerminalTaskWorktrees = Effect.fn("cleanupTerminalTaskWorktrees")(function* () {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      const candidates = listTerminalTaskWorktreeCleanupCandidates(readModel);
      yield* Effect.forEach(candidates, cleanupTaskWorktreeSafely, {
        concurrency: 1,
        discard: true,
      });
    });

    const cleanupTerminalTaskWorktreesSafely = cleanupSemaphore
      .withPermits(1)(cleanupTerminalTaskWorktrees())
      .pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("task worktree startup cleanup failed", {
            cause: Cause.pretty(cause),
          });
        }),
      );

    const readTaskWorktreeEntries = Effect.fn("readTaskWorktreeEntries")(function* (root: string) {
      return yield* fileSystem
        .readDirectory(root, { recursive: false })
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound" ? Effect.succeed([] as string[]) : Effect.fail(error),
          ),
        );
    });

    const listOrphanedTaskWorktreeCleanupCandidates = Effect.fn(
      "listOrphanedTaskWorktreeCleanupCandidates",
    )(function* () {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      const candidates: CleanupCandidate[] = [];

      for (const project of readModel.projects) {
        const root = path.resolve(project.workspaceRoot, ".gedcode", "orchestrator", "tasks");
        const entries = yield* readTaskWorktreeEntries(root);
        const projectTasks = readModel.tasks.filter((task) => task.projectId === project.id);
        const liveTaskIds = new Set(
          projectTasks
            .filter((task) => task.status !== "landed" && task.status !== "abandoned")
            .map((task) => String(task.id)),
        );

        for (const entry of entries) {
          const taskId = path.basename(entry);
          const worktreePath = expectedTaskWorktreePath({
            workspaceRoot: project.workspaceRoot,
            taskId,
          });
          if (
            taskId.length === 0 ||
            taskId !== entry ||
            !isDeterministicTaskWorktreePath({
              workspaceRoot: project.workspaceRoot,
              taskId,
              worktreePath,
            })
          ) {
            yield* Effect.logWarning("task worktree reaper skipped unexpected worktree path", {
              workspaceRoot: project.workspaceRoot,
              entry,
              worktreePath,
            });
            continue;
          }
          if (liveTaskIds.has(taskId)) {
            continue;
          }
          candidates.push({
            taskId,
            worktreePath,
            workspaceRoot: project.workspaceRoot,
            reason: "orphaned",
          });
        }
      }

      return candidates;
    });

    const reapOrphanedTaskWorktrees = Effect.fn("reapOrphanedTaskWorktrees")(function* () {
      const candidates = yield* listOrphanedTaskWorktreeCleanupCandidates();
      yield* Effect.forEach(candidates, cleanupTaskWorktreeSafely, {
        concurrency: 1,
        discard: true,
      });
    });

    const reapOrphanedTaskWorktreesSafely = cleanupSemaphore
      .withPermits(1)(reapOrphanedTaskWorktrees())
      .pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("task worktree orphan reaper failed", {
            cause: Cause.pretty(cause),
          });
        }),
        Effect.catchDefect((defect) =>
          Effect.logWarning("task worktree orphan reaper defect", { defect }),
        ),
      );

    const start: TaskWorktreeReactorShape["start"] = Effect.fn("start")(function* () {
      yield* cleanupTerminalTaskWorktreesSafely;
      yield* Effect.forkScoped(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (event.type !== "task.landed" && event.type !== "task.abandoned") {
            return Effect.void;
          }
          return worker.enqueue(event);
        }),
      );
      yield* Effect.forkScoped(
        reapOrphanedTaskWorktreesSafely.pipe(
          Effect.repeat(Schedule.spaced(Duration.millis(reaperIntervalMs))),
        ),
      );
    });

    return {
      start,
      drain: worker.drain,
    } satisfies TaskWorktreeReactorShape;
  });

export const makeTaskWorktreeReactorLive = (options?: TaskWorktreeReactorLiveOptions) =>
  Layer.effect(TaskWorktreeReactor, makeTaskWorktreeReactor(options));

export const TaskWorktreeReactorLive = makeTaskWorktreeReactorLive();
