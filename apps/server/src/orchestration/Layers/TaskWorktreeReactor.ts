// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import {
  CommandId,
  EventId,
  type ChangeRequest,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationTask,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { resolveOpenPrAsDraft } from "@t3tools/shared/orchestrator";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import {
  increment,
  orchestrationWorktreeReaperOrphansRemovedTotal,
} from "../../observability/Metrics.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { SourceControlProviderRegistry } from "../../sourceControl/SourceControlProviderRegistry.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  DEFAULT_ORPHAN_GRACE_PERIOD_MS,
  expectedTaskWorktreePath,
  isDeterministicTaskWorktreePath,
  makeTaskWorktreeLeaseStore,
  taskOwnsWorktree,
} from "../taskWorktreeLease.ts";
import { inspectTaskNoChangeEvidence } from "../taskNoChange.ts";
import {
  TaskWorktreeReactor,
  type TaskWorktreeReactorShape,
} from "../Services/TaskWorktreeReactor.ts";

type WorktreeLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | "task.created"
      | "task.split"
      | "task.landed"
      | "task.no-changes-needed"
      | "task.landing-retry-requested"
      | "task.abandoned";
  }
>;

type CleanupCandidate = {
  readonly taskId: string;
  readonly worktreePath: string | null;
  readonly workspaceRoot: string;
  readonly reason: "terminal" | "orphaned" | "split";
};

export interface TaskWorktreeReactorLiveOptions {
  readonly reaperIntervalMsOverride?: number;
  readonly orphanGracePeriodMsOverride?: number;
  readonly leaseDurationMsOverride?: number;
  readonly nowMsOverride?: () => number;
  readonly landingRetryDelayMsOverride?: number;
  readonly landingMaxAttemptsOverride?: number;
}

type LandedTaskContext = {
  readonly task: OrchestrationTask;
  readonly project: OrchestrationProject;
  readonly worktreePath: string;
};

type LegacyLandedTaskContext = {
  readonly task: OrchestrationTask;
  readonly project: OrchestrationProject;
  readonly worktreePath: string | null;
};

class TaskLandingPrError extends Data.TaggedError("TaskLandingPrError")<{
  readonly detail: string;
}> {}

export function listTerminalTaskWorktreeCleanupCandidates(
  readModel: OrchestrationReadModel,
): ReadonlyArray<CleanupCandidate> {
  const projectById = new Map(readModel.projects.map((project) => [String(project.id), project]));
  return readModel.tasks.flatMap((task) => {
    if (
      task.worktreePath === null ||
      (task.status !== "landed" &&
        task.status !== "no-changes-needed" &&
        task.status !== "abandoned")
    ) {
      return [];
    }
    if (task.status === "landed" && task.prUrl === null) {
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

function listPendingLandedTaskContexts(
  readModel: OrchestrationReadModel,
): ReadonlyArray<LandedTaskContext> {
  const projectById = new Map(readModel.projects.map((project) => [String(project.id), project]));
  return readModel.tasks.flatMap((task) => {
    if (
      task.status !== "landed" ||
      task.prUrl !== null ||
      task.worktreePath === null ||
      task.landing?.status === "failed"
    ) {
      return [];
    }
    const project = projectById.get(String(task.projectId));
    if (!project) {
      return [];
    }
    return [{ task, project, worktreePath: task.worktreePath }];
  });
}

function listLegacyLandedTaskContexts(
  readModel: OrchestrationReadModel,
): ReadonlyArray<LegacyLandedTaskContext> {
  const projectById = new Map(readModel.projects.map((project) => [String(project.id), project]));
  return readModel.tasks.flatMap((task) => {
    if (
      task.status !== "landed" ||
      task.prUrl !== null ||
      (task.landing?.status !== "failed" && task.worktreePath !== null)
    ) {
      return [];
    }
    const project = projectById.get(String(task.projectId));
    return project === undefined ? [] : [{ task, project, worktreePath: task.worktreePath }];
  });
}

function taskPrOpenedCommandId(taskId: string): CommandId {
  return CommandId.make(`task-pr-opened:${taskId}`);
}

function taskPrOpenFailedCommandId(taskId: string): CommandId {
  return CommandId.make(`task-pr-open-failed:${taskId}`);
}

function taskLandingFailedCommandId(taskId: string, landingStartedAt: string): CommandId {
  return CommandId.make(`task-landing-failed:${taskId}:${landingStartedAt}`);
}

function taskNoChangesCommandId(taskId: string): CommandId {
  return CommandId.make(`task-no-changes-needed:${taskId}`);
}

function taskAutoArchiveCommandId(taskId: string): CommandId {
  return CommandId.make(`task-auto-archive:${taskId}`);
}

export function listSuccessfulUnarchivedTasks(
  readModel: OrchestrationReadModel,
): ReadonlyArray<OrchestrationTask> {
  return readModel.tasks.filter(
    (task) =>
      task.archivedAt === null &&
      task.deletedAt === null &&
      (task.status === "no-changes-needed" || (task.status === "landed" && task.prUrl !== null)),
  );
}

function landingFailureActivityId(taskId: string): EventId {
  return EventId.make(`task-pr-open-failed:${taskId}`);
}

function firstTaskThread(task: OrchestrationTask) {
  return task.currentStageThreadId ?? task.stageThreadIds.at(-1) ?? null;
}

function createPrBody(input: {
  readonly task: OrchestrationTask;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly commitSummary: string;
  readonly diffSummary: string;
}): string {
  const commitSummary = input.commitSummary.trim() || `Task: ${input.task.title}`;
  const diffSummary = input.diffSummary.trim() || "No diff stats were available.";
  return [
    "## Summary",
    "",
    commitSummary,
    "",
    "## Diff stats",
    "",
    "```",
    diffSummary,
    "```",
    "",
    `Base: ${input.baseRefName}`,
    `Head: ${input.headRefName}`,
    "",
    "Opened by GedCode orchestrator",
    "",
  ].join("\n");
}

function errorDetail(cause: Cause.Cause<unknown>): string {
  const failure = Cause.findErrorOption(cause);
  if (Option.isSome(failure)) {
    const error = failure.value;
    if (typeof error === "object" && error !== null) {
      if ("detail" in error && typeof error.detail === "string" && error.detail.trim() !== "") {
        return error.detail.trim();
      }
      if ("message" in error && typeof error.message === "string" && error.message.trim() !== "") {
        return error.message.trim();
      }
    }
    if (typeof error === "string" && error.trim() !== "") {
      return error.trim();
    }
  }
  return Cause.pretty(cause)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function landingPrError(detail: string): TaskLandingPrError {
  return new TaskLandingPrError({ detail });
}

function explicitOpenPrAsDraftConfig(project: OrchestrationProject) {
  const raw = project.orchestratorConfig ?? {};
  return typeof raw.openPrAsDraft === "boolean" ? { openPrAsDraft: raw.openPrAsDraft } : {};
}

export const makeTaskWorktreeReactor = (options?: TaskWorktreeReactorLiveOptions) =>
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const gitWorkflow = yield* GitWorkflowService;
    const sourceControlProviders = yield* SourceControlProviderRegistry;
    const vcsProcess = yield* VcsProcess;
    const fileSystem = yield* FileSystem.FileSystem;
    const serverSettings = yield* ServerSettingsService;
    const settings = yield* serverSettings.getSettings;
    const reaperIntervalMs = Math.max(
      1,
      options?.reaperIntervalMsOverride ??
        settings.orchestratorDefaults.worktreeReaperIntervalMinutes * 60_000,
    );
    const orphanGracePeriodMs = Math.max(
      0,
      options?.orphanGracePeriodMsOverride ?? DEFAULT_ORPHAN_GRACE_PERIOD_MS,
    );
    const leaseDurationMs = Math.max(1, options?.leaseDurationMsOverride ?? reaperIntervalMs * 3);
    const leaseStore = yield* makeTaskWorktreeLeaseStore({
      leaseDurationMs,
      orphanGracePeriodMs,
      ...(options?.nowMsOverride ? { nowMsOverride: options.nowMsOverride } : {}),
    });
    const landingRetryDelayMs = Math.max(1, options?.landingRetryDelayMsOverride ?? 1_000);
    const landingMaxAttempts = Math.max(1, options?.landingMaxAttemptsOverride ?? 3);
    const cleanupSemaphore = yield* Semaphore.make(1);
    const cleanedWorktreePaths = new Set<string>();

    const refreshLiveTaskWorktreeLeases = Effect.fn("refreshLiveTaskWorktreeLeases")(function* (
      readModel: OrchestrationReadModel,
    ) {
      const projectById = new Map(
        readModel.projects.map((project) => [String(project.id), project]),
      );
      yield* Effect.forEach(
        readModel.tasks,
        (task) => {
          const project = projectById.get(String(task.projectId));
          return project ? leaseStore.renew({ task, project }) : Effect.void;
        },
        { concurrency: 1, discard: true },
      );
    });

    const refreshLiveTaskWorktreeLeasesSafely = (readModel: OrchestrationReadModel) =>
      refreshLiveTaskWorktreeLeases(readModel).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("task worktree lease refresh failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      );

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

      if (
        candidate.reason === "orphaned" &&
        (yield* leaseStore.isOrphanProtected({
          workspaceRoot: candidate.workspaceRoot,
          taskId,
          worktreePath,
        }))
      ) {
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
      yield* leaseStore.release({
        workspaceRoot: candidate.workspaceRoot,
        taskId,
      });
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

    const cleanupLandedTaskContext = (context: LandedTaskContext) =>
      cleanupTaskWorktreeSafely({
        taskId: String(context.task.id),
        worktreePath: context.worktreePath,
        workspaceRoot: context.project.workspaceRoot,
        reason: "terminal",
      });

    const repairLandedTaskWithoutChanges = Effect.fn("repairLandedTaskWithoutChanges")(function* (
      context: LegacyLandedTaskContext,
    ) {
      const taskId = String(context.task.id);
      const branch = context.task.branch;
      if (branch === null) {
        return false;
      }
      if (
        context.worktreePath !== null &&
        !isDeterministicTaskWorktreePath({
          workspaceRoot: context.project.workspaceRoot,
          taskId,
          worktreePath: context.worktreePath,
        })
      ) {
        yield* Effect.logWarning("legacy task repair skipped unexpected worktree path", {
          taskId,
          workspaceRoot: context.project.workspaceRoot,
          worktreePath: context.worktreePath,
        });
        return false;
      }

      const worktreeExists =
        context.worktreePath !== null && (yield* fileSystem.exists(context.worktreePath));
      const evidenceExit = yield* Effect.exit(
        inspectTaskNoChangeEvidence({
          repositoryPath: context.project.workspaceRoot,
          branch,
          ...(worktreeExists ? { worktreePath: context.worktreePath as string } : {}),
          process: vcsProcess,
        }),
      );
      if (evidenceExit._tag === "Failure") {
        yield* Effect.logWarning("task no-change eligibility inspection failed", {
          taskId,
          branch,
          cause: Cause.pretty(evidenceExit.cause),
        });
        return false;
      }

      const evidence = evidenceExit.value;
      if (evidence.dirty || evidence.baseHead !== evidence.head) {
        return false;
      }
      const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* orchestrationEngine.dispatch({
        type: "task.no-changes-needed",
        commandId: taskNoChangesCommandId(taskId),
        taskId: context.task.id,
        baseHead: evidence.baseHead,
        head: evidence.head,
        worktreeCompletion: { head: evidence.head, dirty: false },
        createdAt,
      });
      if (context.worktreePath !== null) {
        yield* cleanupSemaphore.withPermits(1)(
          cleanupLandedTaskContext({ ...context, worktreePath: context.worktreePath }),
        );
      }
      return true;
    });

    const appendLandingFailureActivity = Effect.fn("appendLandingFailureActivity")(
      function* (input: {
        readonly context: LandedTaskContext;
        readonly detail: string;
        readonly branchPushed: boolean;
      }) {
        const threadId = firstTaskThread(input.context.task);
        if (threadId === null) {
          yield* Effect.logWarning("landing PR open failed with no task thread to annotate", {
            taskId: String(input.context.task.id),
            detail: input.detail,
            branchPushed: input.branchPushed,
          });
          return;
        }

        const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        yield* orchestrationEngine
          .dispatch({
            type: "thread.activity.append",
            commandId: taskPrOpenFailedCommandId(String(input.context.task.id)),
            threadId,
            activity: {
              id: landingFailureActivityId(String(input.context.task.id)),
              tone: "error",
              kind: "task.landing.pr-open-failed",
              summary: `Landing: PR open failed - ${input.detail}; branch pushed: ${
                input.branchPushed ? "yes" : "no"
              }`,
              payload: {
                taskId: String(input.context.task.id),
                branch: input.context.task.branch,
                worktreePath: input.context.worktreePath,
                branchPushed: input.branchPushed,
              },
              turnId: null,
              createdAt,
            },
            createdAt,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("landing PR failure activity append failed", {
                taskId: String(input.context.task.id),
                cause: Cause.pretty(cause),
              }),
            ),
          );
      },
    );

    const recordLandingFailure = Effect.fn("recordLandingFailure")(function* (input: {
      readonly context: LandedTaskContext;
      readonly detail: string;
      readonly branchPushed: boolean;
    }) {
      const taskId = String(input.context.task.id);
      const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* orchestrationEngine.dispatch({
        type: "task.pr.open.failed",
        commandId: taskLandingFailedCommandId(
          taskId,
          input.context.task.landing?.updatedAt ?? input.context.task.updatedAt,
        ),
        taskId: input.context.task.id,
        message: input.detail,
        branchPushed: input.branchPushed,
        createdAt,
      });
    });

    const openTaskPrAndRecord = Effect.fn("openTaskPrAndRecord")(function* (input: {
      readonly context: LandedTaskContext;
      readonly onBranchPushed: Effect.Effect<void, never>;
    }) {
      const { context } = input;
      const taskId = String(context.task.id);
      const branch = context.task.branch;
      if (branch === null) {
        return yield* landingPrError(`Task '${taskId}' has no branch to push.`);
      }
      if (
        !isDeterministicTaskWorktreePath({
          workspaceRoot: context.project.workspaceRoot,
          taskId,
          worktreePath: context.worktreePath,
        })
      ) {
        return yield* landingPrError(
          `Task '${taskId}' has unexpected worktree path '${context.worktreePath}'.`,
        );
      }

      const handle = yield* sourceControlProviders.resolveHandle({ cwd: context.worktreePath });
      if (handle.provider.kind === "unknown") {
        return yield* landingPrError(
          `No supported source-control provider is configured for '${context.worktreePath}'.`,
        );
      }

      const baseRefName = yield* handle.provider.getDefaultBranch({ cwd: context.worktreePath });
      if (baseRefName === null) {
        return yield* landingPrError(
          `Could not resolve the default branch for '${context.worktreePath}'.`,
        );
      }

      const currentSettings = yield* serverSettings.getSettings;
      const openPrAsDraft = resolveOpenPrAsDraft({
        config: explicitOpenPrAsDraftConfig(context.project),
        defaults: currentSettings.orchestratorDefaults,
      });

      yield* gitWorkflow.pushCurrentBranch({
        cwd: context.worktreePath,
        fallbackBranch: branch,
        remoteName: handle.context?.remoteName ?? null,
      });
      yield* input.onBranchPushed;

      const existing = yield* handle.provider.listChangeRequests({
        cwd: context.worktreePath,
        headSelector: branch,
        state: "open",
        limit: 1,
      });
      const changeRequest: ChangeRequest =
        existing[0] ??
        (yield* Effect.scoped(
          Effect.gen(function* () {
            const rangeContext = yield* gitWorkflow.readRangeContext({
              cwd: context.worktreePath,
              baseRef: baseRefName,
            });
            const bodyFile = yield* fileSystem.makeTempFileScoped({
              prefix: "gedcode-task-pr-",
              suffix: ".md",
            });
            yield* fileSystem.writeFileString(
              bodyFile,
              createPrBody({
                task: context.task,
                baseRefName,
                headRefName: branch,
                commitSummary: rangeContext.commitSummary,
                diffSummary: rangeContext.diffSummary,
              }),
            );
            return yield* handle.provider.createChangeRequest({
              cwd: context.worktreePath,
              baseRefName,
              headSelector: branch,
              title: context.task.title,
              bodyFile,
              draft: openPrAsDraft,
            });
          }),
        ));

      const createdAt = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
      yield* orchestrationEngine.dispatch({
        type: "task.pr.opened",
        commandId: taskPrOpenedCommandId(taskId),
        taskId: context.task.id,
        prUrl: changeRequest.url,
        prNumber: changeRequest.number,
        createdAt,
      });
    });

    const processLandedTaskContext = Effect.fn("processLandedTaskContext")(function* (
      context: LandedTaskContext,
    ) {
      if (context.task.prUrl !== null) {
        yield* cleanupSemaphore.withPermits(1)(cleanupLandedTaskContext(context));
        return;
      }

      if (yield* repairLandedTaskWithoutChanges(context)) {
        return;
      }

      let branchPushed = false;
      const landing = openTaskPrAndRecord({
        context,
        onBranchPushed: Effect.sync(() => {
          branchPushed = true;
        }),
      }).pipe(
        Effect.retry(
          Schedule.spaced(Duration.millis(landingRetryDelayMs)).pipe(
            Schedule.both(Schedule.recurs(landingMaxAttempts - 1)),
          ),
        ),
      );
      const exit = yield* Effect.exit(landing);
      if (exit._tag === "Success") {
        yield* cleanupSemaphore.withPermits(1)(cleanupLandedTaskContext(context));
        return;
      }

      const detail = errorDetail(exit.cause);
      yield* recordLandingFailure({ context, detail, branchPushed }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("landing PR failure task state update failed", {
            taskId: String(context.task.id),
            cause: Cause.pretty(cause),
          }),
        ),
      );
      yield* appendLandingFailureActivity({ context, detail, branchPushed });
      yield* Effect.logWarning("landing PR open failed; leaving task worktree intact", {
        taskId: String(context.task.id),
        branch: context.task.branch,
        worktreePath: context.worktreePath,
        branchPushed,
        cause: Cause.pretty(exit.cause),
      });
    });

    const resolveLandedTaskContext = Effect.fn("resolveLandedTaskContext")(function* (
      taskId: string,
    ) {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      return listPendingLandedTaskContexts(readModel).find(
        (context) => String(context.task.id) === taskId,
      );
    });

    const resolveCandidate = Effect.fn("resolveTerminalTaskCleanupCandidate")(function* (
      event: Exclude<WorktreeLifecycleEvent, { type: "task.created" | "task.split" }>,
    ) {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      return listTerminalTaskWorktreeCleanupCandidates(readModel).find(
        (candidate) => candidate.taskId === String(event.payload.taskId),
      );
    });

    const processWorktreeLifecycleEvent = Effect.fn("processWorktreeLifecycleEvent")(function* (
      event: WorktreeLifecycleEvent,
    ) {
      if (event.type === "task.created") {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        const task = readModel.tasks.find((candidate) => candidate.id === event.payload.taskId);
        if (!task) {
          return;
        }
        const project = readModel.projects.find((candidate) => candidate.id === task.projectId);
        if (project) {
          yield* leaseStore.renew({ task, project });
        }
        return;
      }
      if (event.type === "task.split") {
        const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
        const task = readModel.tasks.find((candidate) => candidate.id === event.payload.taskId);
        const project = readModel.projects.find((candidate) => candidate.id === task?.projectId);
        if (task !== undefined && project !== undefined) {
          yield* cleanupSemaphore.withPermits(1)(
            cleanupTaskWorktreeSafely({
              taskId: String(task.id),
              worktreePath: expectedTaskWorktreePath({
                workspaceRoot: project.workspaceRoot,
                taskId: String(task.id),
              }),
              workspaceRoot: project.workspaceRoot,
              reason: "split",
            }),
          );
        }
        return;
      }
      if (event.type === "task.landed" || event.type === "task.landing-retry-requested") {
        const context = yield* resolveLandedTaskContext(String(event.payload.taskId));
        if (context) {
          yield* processLandedTaskContext(context);
          return;
        }
      }

      const candidate = yield* resolveCandidate(event);
      if (!candidate) {
        return;
      }
      yield* cleanupSemaphore.withPermits(1)(cleanupTaskWorktreeSafely(candidate));
    });

    const processWorktreeLifecycleEventSafely = (event: WorktreeLifecycleEvent) =>
      processWorktreeLifecycleEvent(event).pipe(
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

    const worker = yield* makeDrainableWorker(processWorktreeLifecycleEventSafely);

    const processPendingLandedTasks = Effect.fn("processPendingLandedTasks")(function* (
      readModel: OrchestrationReadModel,
    ) {
      const contexts = listPendingLandedTaskContexts(readModel);
      yield* Effect.forEach(contexts, processLandedTaskContext, {
        concurrency: 1,
        discard: true,
      });
    });

    const processPendingLandedTasksSafely = (readModel: OrchestrationReadModel) =>
      processPendingLandedTasks(readModel).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("task worktree startup landing PR processing failed", {
            cause: Cause.pretty(cause),
          });
        }),
      );

    const repairLegacyLandedTasks = Effect.fn("repairLegacyLandedTasks")(function* (
      readModel: OrchestrationReadModel,
    ) {
      yield* Effect.forEach(
        listLegacyLandedTaskContexts(readModel),
        repairLandedTaskWithoutChanges,
        { concurrency: 1, discard: true },
      );
    });

    const repairLegacyLandedTasksSafely = (readModel: OrchestrationReadModel) =>
      repairLegacyLandedTasks(readModel).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("legacy landed task no-change reconciliation failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const archiveSuccessfulTerminalTasks = Effect.fn("archiveSuccessfulTerminalTasks")(function* (
      readModel: OrchestrationReadModel,
    ) {
      yield* Effect.forEach(
        listSuccessfulUnarchivedTasks(readModel),
        (task) =>
          orchestrationEngine.dispatch({
            type: "task.archive",
            commandId: taskAutoArchiveCommandId(String(task.id)),
            taskId: task.id,
          }),
        { concurrency: 1, discard: true },
      );
    });

    const archiveSuccessfulTerminalTasksSafely = (readModel: OrchestrationReadModel) =>
      archiveSuccessfulTerminalTasks(readModel).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("successful terminal task archive reconciliation failed", {
            cause: Cause.pretty(cause),
          }),
        ),
      );

    const cleanupTerminalTaskWorktrees = Effect.fn("cleanupTerminalTaskWorktrees")(function* (
      readModel: OrchestrationReadModel,
    ) {
      const candidates = listTerminalTaskWorktreeCleanupCandidates(readModel);
      yield* Effect.forEach(candidates, cleanupTaskWorktreeSafely, {
        concurrency: 1,
        discard: true,
      });
    });

    const cleanupTerminalTaskWorktreesSafely = (readModel: OrchestrationReadModel) =>
      cleanupSemaphore
        .withPermits(1)(cleanupTerminalTaskWorktrees(readModel))
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
          projectTasks.filter(taskOwnsWorktree).map((task) => String(task.id)),
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

    const refreshLeasesAndReapOrphanedTaskWorktrees = Effect.fn(
      "refreshLeasesAndReapOrphanedTaskWorktrees",
    )(function* () {
      const readModel = yield* projectionSnapshotQuery.getCommandReadModel();
      yield* refreshLiveTaskWorktreeLeases(readModel);
      yield* reapOrphanedTaskWorktrees();
    });

    const reapOrphanedTaskWorktreesSafely = cleanupSemaphore
      .withPermits(1)(refreshLeasesAndReapOrphanedTaskWorktrees())
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
      // Subscribe before reading the startup snapshot. Events committed while
      // startup reconciliation is running are then available from both the
      // durable replay and this buffered live stream, closing the former gap
      // between the snapshot scan and hot-stream subscription.
      const liveEvents = yield* Stream.toQueue(orchestrationEngine.streamDomainEvents, {
        capacity: "unbounded",
      });
      const startupReadModelExit = yield* Effect.exit(
        projectionSnapshotQuery.getCommandReadModel(),
      );
      const startupSequence =
        startupReadModelExit._tag === "Success" ? startupReadModelExit.value.snapshotSequence : 0;
      let lastWorktreeLifecycleSequence = startupSequence;

      const enqueueWorktreeLifecycleEventOnce = (event: OrchestrationEvent) => {
        if (
          (event.type !== "task.created" &&
            event.type !== "task.split" &&
            event.type !== "task.landed" &&
            event.type !== "task.no-changes-needed" &&
            event.type !== "task.landing-retry-requested" &&
            event.type !== "task.abandoned") ||
          event.sequence <= lastWorktreeLifecycleSequence
        ) {
          return Effect.void;
        }
        lastWorktreeLifecycleSequence = event.sequence;
        return worker.enqueue(event);
      };

      if (startupReadModelExit._tag === "Success") {
        yield* refreshLiveTaskWorktreeLeasesSafely(startupReadModelExit.value);
        yield* archiveSuccessfulTerminalTasksSafely(startupReadModelExit.value);
        yield* repairLegacyLandedTasksSafely(startupReadModelExit.value);
        yield* processPendingLandedTasksSafely(startupReadModelExit.value);
        yield* cleanupTerminalTaskWorktreesSafely(startupReadModelExit.value);
      } else {
        yield* Effect.logWarning("task worktree startup snapshot query failed", {
          cause: Cause.pretty(startupReadModelExit.cause),
        });
      }
      yield* orchestrationEngine.readEvents(startupSequence).pipe(
        Stream.runForEach(enqueueWorktreeLifecycleEventOnce),
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) {
            return Effect.void;
          }
          return Effect.logWarning("task worktree startup event replay failed", {
            fromSequenceExclusive: startupSequence,
            cause: Cause.pretty(cause),
          });
        }),
      );
      yield* Effect.forkScoped(
        Stream.runForEach(Stream.fromQueue(liveEvents), enqueueWorktreeLifecycleEventOnce),
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
