// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationTask,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  TaskWorktreeReactor,
  type TaskWorktreeReactorShape,
} from "../Services/TaskWorktreeReactor.ts";

type TerminalTaskEvent = Extract<OrchestrationEvent, { type: "task.landed" | "task.abandoned" }>;

type CleanupCandidate = {
  readonly task: OrchestrationTask;
  readonly workspaceRoot: string;
};

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
    return [{ task, workspaceRoot: project.workspaceRoot }];
  });
}

export const makeTaskWorktreeReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const vcsProcess = yield* VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;

  const cleanupTaskWorktree = Effect.fn("cleanupTaskWorktree")(function* (
    candidate: CleanupCandidate,
  ) {
    const taskId = String(candidate.task.id);
    const worktreePath = candidate.task.worktreePath;
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

    const exists = yield* fileSystem.exists(worktreePath);
    if (exists) {
      yield* gitWorkflow.removeWorktree({
        cwd: candidate.workspaceRoot,
        path: worktreePath,
        force: true,
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
          taskId: String(candidate.task.id),
          worktreePath: candidate.task.worktreePath,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const resolveCandidate = Effect.fn("resolveTerminalTaskCleanupCandidate")(function* (
    event: TerminalTaskEvent,
  ) {
    const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
    return listTerminalTaskWorktreeCleanupCandidates(readModel).find(
      (candidate) => candidate.task.id === event.payload.taskId,
    );
  });

  const processTerminalTaskEvent = Effect.fn("processTerminalTaskEvent")(function* (
    event: TerminalTaskEvent,
  ) {
    const candidate = yield* resolveCandidate(event);
    if (!candidate) {
      return;
    }
    yield* cleanupTaskWorktreeSafely(candidate);
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

  const cleanupTerminalTaskWorktreesSafely = cleanupTerminalTaskWorktrees().pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return Effect.void;
      }
      return Effect.logWarning("task worktree startup cleanup failed", {
        cause: Cause.pretty(cause),
      });
    }),
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
  });

  return {
    start,
    drain: worker.drain,
  } satisfies TaskWorktreeReactorShape;
});

export const TaskWorktreeReactorLive = Layer.effect(TaskWorktreeReactor, makeTaskWorktreeReactor);
