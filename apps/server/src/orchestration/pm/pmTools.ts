import {
  ApprovalRequestId,
  CommandId,
  GateId,
  HelperRunId,
  MessageId,
  OrchestrationCancelTaskError,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationLatestTurn,
  type OrchestrationHelperRun,
  type OrchestrationMessageRole,
  type GedRoleCapabilityTiers,
  type OrchestrationCapabilityTier,
  type ProviderApprovalDecision,
  type OrchestrationGateKind,
  type OrchestrationReadModel,
  type OrchestrationStageRole,
  type OrchestrationTask,
  type OrchestrationTaskSplitChild,
  type OrchestrationThread,
  type OrchestrationThreadActivityTone,
  type ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { createHash } from "node:crypto";

import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { defaultTaskTypeRegistry } from "../TaskTypeRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProjectionPendingApprovalRepository } from "../../persistence/Services/ProjectionPendingApprovals.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { cancelOrchestrationTaskWithServices } from "../taskCancellation.ts";
import { landOrchestrationTaskWithServices } from "../taskLanding.ts";
import { inspectTaskWorktreeCompletion } from "../worktreeCompletion.ts";
import { interruptOrchestrationStageWithServices } from "../stageInterrupt.ts";
import { dispatchReleaseWithServices, releaseDispatchContentHash } from "../releaseDispatch.ts";
import { GitHubCli } from "../../sourceControl/GitHubCli.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";
import {
  commitOrchestratorTaskChanges,
  completeOrchestratorTaskWithoutChanges,
  discardOrchestratorTaskChanges,
  inspectOrchestratorTaskChanges,
  returnOrchestratorTaskChanges,
} from "../taskChangeReviewActions.ts";
import type { TaskWorktreeChanges } from "../taskChangeReview.ts";
import {
  commitDirectPmChanges,
  inspectDirectPmChanges,
  type DirectPmCheckEvidence,
} from "../directPmChanges.ts";
import {
  releaseTaskBranchReservation,
  reserveTaskBranch,
  type TaskBranchReservation,
} from "../taskBranchReservation.ts";
import { pmThreadIdForProject } from "./PmEventProjection.ts";

interface CreateTaskParameters {
  readonly projectId: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly taskType?: string;
  readonly supersedesTaskId?: string;
  readonly releaseSourceTaskId?: string;
}

interface SplitTaskChildParameters {
  readonly key: string;
  readonly title: string;
  readonly taskType?: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly dependsOnKeys?: ReadonlyArray<string>;
}

interface SplitTaskParameters {
  readonly parentTaskId: string;
  readonly idempotencyKey: string;
  readonly children: ReadonlyArray<SplitTaskChildParameters>;
}

interface ClassifyRequestParameters {
  readonly taskId: string;
  readonly taskType?: string;
  readonly playbookVersion?: string;
}

interface HandoffWorkerParameters {
  readonly taskId: string;
  readonly role: OrchestrationStageRole;
  readonly tier: OrchestrationCapabilityTier;
  readonly instructions: string;
}

interface SteerStageParameters {
  readonly taskId: string;
  readonly message: string;
  readonly stageThreadId?: string;
}

interface InterruptStageParameters {
  readonly taskId: string;
  readonly stageThreadId?: string;
}

interface RequestApprovalParameters {
  readonly taskId: string;
  readonly gate: OrchestrationGateKind;
  readonly contentHash: string;
  readonly stageThreadId?: string;
}

interface SetTaskTierParameters {
  readonly taskId: string;
  readonly role: OrchestrationStageRole;
  readonly tier: OrchestrationCapabilityTier;
}

interface InspectStageParameters {
  readonly taskId: string;
  readonly stageThreadId?: string;
}

interface StartHelperRunParameters {
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly tier?: OrchestrationCapabilityTier;
  readonly taskId?: string;
}

interface InspectHelperRunParameters {
  readonly projectId: string;
  readonly helperRunId: string;
}

interface InterruptHelperRunParameters extends InspectHelperRunParameters {}

interface InspectTaskChangesParameters {
  readonly taskId: string;
}

interface InspectDirectChangesParameters {
  readonly projectId: string;
}

interface CommitDirectChangesParameters {
  readonly projectId: string;
  readonly patch: string;
  readonly message: string;
  readonly rationale: string;
  readonly checks: ReadonlyArray<DirectPmCheckEvidence>;
}

interface CommitTaskChangesParameters {
  readonly taskId: string;
  readonly paths?: ReadonlyArray<string>;
  readonly patch?: string;
  readonly message: string;
}

interface DiscardTaskChangesParameters {
  readonly taskId: string;
  readonly paths: ReadonlyArray<string>;
}

interface ReturnTaskChangesParameters {
  readonly taskId: string;
  readonly instructions: string;
  readonly tier?: OrchestrationCapabilityTier;
}

interface CompleteTaskWithoutChangesParameters {
  readonly taskId: string;
}

interface ListPendingStageApprovalsParameters {
  readonly taskId: string;
}

interface RespondToStageApprovalParameters {
  readonly taskId: string;
  readonly requestId: string;
  readonly decision: ProviderApprovalDecision;
}

interface PendingStageApprovalSummary {
  readonly requestId: string;
  readonly stageThreadId: string;
  readonly stageRole: OrchestrationStageRole | null;
  readonly turnId: string | null;
  readonly requestKind: string | null;
  readonly detail: string | null;
  readonly createdAt: string;
}

interface CancelTaskParameters {
  readonly taskId: string;
}

interface LandTaskParameters {
  readonly taskId: string;
}

interface ReleaseParameters {
  readonly taskId: string;
  readonly workflow: string;
  readonly ref: string;
  readonly inputs?: Readonly<Record<string, string>>;
}

interface TaskRetentionParameters {
  readonly taskId: string;
}

interface GetTaskLedgerParameters {
  readonly projectId: string;
}

interface PmTaskAttemptSummary {
  readonly stageThreadId: string;
  readonly role: OrchestrationStageRole | null;
  readonly capabilityTier: OrchestrationCapabilityTier | null;
  readonly providerInstanceId: string | null;
  readonly model: string | null;
  readonly status: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

interface PmTaskSummary {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly currentStageThreadId: string | null;
  readonly supersedesTaskId: string | null;
  readonly supersededByTaskId: string | null;
  readonly roleCapabilityTiers: GedRoleCapabilityTiers;
  readonly parentTaskId: string | null;
  readonly childOrder: number | null;
  readonly aggregateProgress: OrchestrationTask["aggregateProgress"];
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly dependsOnTaskIds: ReadonlyArray<string>;
  readonly blockedByTaskIds: ReadonlyArray<string>;
  readonly attemptCount: number;
  readonly recentAttempts: ReadonlyArray<PmTaskAttemptSummary>;
  readonly prUrl: string | null;
  readonly releaseDispatch: OrchestrationTask["releaseDispatch"];
  readonly updatedAt: string;
}

interface PmToolContent {
  readonly type: "text";
  readonly text: string;
}

export interface PmToolResult<TDetails> {
  readonly content: ReadonlyArray<PmToolContent>;
  readonly details: TDetails;
}

export interface PmToolExecutor<TParams = unknown, TDetails = unknown> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly execute: (toolCallId: string, params: TParams) => Promise<PmToolResult<TDetails>>;
}

const textResult = <TDetails>(summary: string, details: TDetails): PmToolResult<TDetails> => ({
  content: [{ type: "text", text: summary }],
  details,
});

const latestStageThreadId = (task: OrchestrationTask | undefined): ThreadId | null =>
  task?.stageThreadIds.at(-1) ?? null;

const pmMessageId = (toolCallId: string) => MessageId.make(`pm-tool:${toolCallId}`);

function createTaskIdentity(params: CreateTaskParameters): {
  readonly taskId: TaskId;
  readonly commandId: CommandId;
  readonly pmMessageId: MessageId;
} {
  const projectId = params.projectId.trim();
  const idempotencyKey = params.idempotencyKey.trim();
  const title = params.title.trim();
  const taskType = params.taskType?.trim() || "feature";
  const supersedesTaskId = params.supersedesTaskId?.trim() || null;
  const releaseSourceTaskId = params.releaseSourceTaskId?.trim() || null;
  const identityDigest = createHash("sha256")
    .update(JSON.stringify([projectId, idempotencyKey]), "utf8")
    .digest("hex");
  const requestDigest = createHash("sha256")
    .update(
      JSON.stringify([
        projectId,
        idempotencyKey,
        title,
        taskType,
        supersedesTaskId,
        releaseSourceTaskId,
      ]),
      "utf8",
    )
    .digest("hex");
  return {
    taskId: TaskId.make(`pm-${identityDigest.slice(0, 32)}`),
    commandId: CommandId.make(`pm:create-task:${identityDigest.slice(0, 16)}:${requestDigest}`),
    pmMessageId: MessageId.make(`pm-create:${identityDigest}`),
  };
}

function splitTaskIdentity(params: SplitTaskParameters): {
  readonly commandId: CommandId;
  readonly childIdsByKey: ReadonlyMap<string, TaskId>;
} {
  const parentTaskId = params.parentTaskId.trim();
  const idempotencyKey = params.idempotencyKey.trim();
  const childIdsByKey = new Map(
    params.children.map((child) => {
      const key = child.key.trim();
      const digest = createHash("sha256")
        .update(JSON.stringify([parentTaskId, idempotencyKey, key]), "utf8")
        .digest("hex");
      return [key, TaskId.make(`pm-split-${digest.slice(0, 32)}`)] as const;
    }),
  );
  const requestDigest = createHash("sha256")
    .update(
      JSON.stringify([
        parentTaskId,
        idempotencyKey,
        params.children.map((child) => [
          child.key.trim(),
          child.title.trim(),
          child.taskType?.trim() || "feature",
          child.acceptanceCriteria.map((criterion) => criterion.trim()),
          (child.dependsOnKeys ?? []).map((key) => key.trim()),
        ]),
      ]),
      "utf8",
    )
    .digest("hex");
  return {
    commandId: CommandId.make(`pm:split-task:${requestDigest}`),
    childIdsByKey,
  };
}

function helperRunIdentity(params: StartHelperRunParameters): {
  readonly helperRunId: HelperRunId;
  readonly commandId: CommandId;
} {
  const projectId = params.projectId.trim();
  const taskId = params.taskId?.trim() || null;
  const idempotencyKey = params.idempotencyKey.trim();
  const identityDigest = createHash("sha256")
    .update(JSON.stringify([projectId, taskId, idempotencyKey]), "utf8")
    .digest("hex");
  const requestDigest = createHash("sha256")
    .update(JSON.stringify([identityDigest, params.prompt.trim(), params.tier ?? "cheap"]), "utf8")
    .digest("hex");
  return {
    helperRunId: HelperRunId.make(`pm-helper-${identityDigest.slice(0, 32)}`),
    commandId: CommandId.make(`pm:start-helper:${identityDigest.slice(0, 16)}:${requestDigest}`),
  };
}

interface InspectStageTurnDigest {
  readonly state: OrchestrationLatestTurn["state"];
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly elapsedSeconds: number | null;
}

interface InspectStageMessageDigest {
  readonly role: OrchestrationMessageRole;
  readonly createdAt: string;
  readonly text: string;
  readonly truncated: boolean;
}

interface InspectStageActivityDigest {
  readonly kind: string;
  readonly tone: OrchestrationThreadActivityTone;
  readonly summary: string;
  readonly createdAt: string;
}

interface InspectStageDigest {
  readonly stageThreadId: string;
  readonly stageRole: OrchestrationStageRole | null;
  readonly turn: InspectStageTurnDigest | null;
  readonly messageCount: number;
  readonly activityCount: number;
  readonly messages: ReadonlyArray<InspectStageMessageDigest>;
  readonly activities: ReadonlyArray<InspectStageActivityDigest>;
  readonly tokenUsage: ThreadTokenUsageSnapshot | null;
}

interface InspectStageDetails {
  readonly task: OrchestrationTask | null;
  readonly note?: string;
  readonly stageDigest: InspectStageDigest | null;
}

const MESSAGE_TAIL_LIMIT = 10;
const ACTIVITY_TAIL_LIMIT = 20;
const MESSAGE_TEXT_LIMIT = 500;
const TASK_LEDGER_RECENT_ATTEMPT_LIMIT = 3;

const summarizeTaskForPm = (
  task: OrchestrationTask,
  readModel: OrchestrationReadModel,
): PmTaskSummary => ({
  id: task.id,
  type: task.type,
  title: task.title,
  status: task.status,
  currentStageThreadId: task.currentStageThreadId,
  supersedesTaskId: task.supersedesTaskId ?? null,
  supersededByTaskId: task.supersededByTaskId ?? null,
  roleCapabilityTiers: task.roleCapabilityTiers ?? {},
  parentTaskId: task.parentTaskId ?? null,
  childOrder: task.childOrder ?? null,
  aggregateProgress: task.aggregateProgress ?? null,
  acceptanceCriteria: task.acceptanceCriteria ?? [],
  dependsOnTaskIds: task.dependsOnTaskIds ?? [],
  blockedByTaskIds: (task.dependsOnTaskIds ?? []).filter((dependencyId) => {
    const dependency = readModel.tasks.find((candidate) => candidate.id === dependencyId);
    return dependency === undefined || dependency.status !== "landed";
  }),
  attemptCount: task.stageThreadIds.length,
  recentAttempts: task.stageThreadIds.slice(-TASK_LEDGER_RECENT_ATTEMPT_LIMIT).map((threadId) => {
    const attempt = readModel.stageHistory[threadId];
    return {
      stageThreadId: threadId,
      role: attempt?.role ?? null,
      capabilityTier: attempt?.capabilityTier ?? null,
      providerInstanceId: attempt?.providerInstanceId ?? null,
      model: attempt?.model ?? null,
      status: attempt?.status ?? null,
      startedAt: attempt?.startedAt ?? null,
      endedAt: attempt?.endedAt ?? null,
    };
  }),
  prUrl: task.prUrl,
  releaseDispatch: task.releaseDispatch,
  updatedAt: task.updatedAt,
});

const truncateMessageText = (text: string): { text: string; truncated: boolean } => {
  if (text.length <= MESSAGE_TEXT_LIMIT) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MESSAGE_TEXT_LIMIT), truncated: true };
};

const elapsedSeconds = (turn: OrchestrationLatestTurn, now: DateTime.DateTime): number | null => {
  if (turn.startedAt === null) {
    return null;
  }
  const startedAtMs = DateTime.toEpochMillis(DateTime.makeUnsafe(turn.startedAt));
  const completedAtMs =
    turn.completedAt === null
      ? turn.state === "running"
        ? DateTime.toEpochMillis(now)
        : null
      : DateTime.toEpochMillis(DateTime.makeUnsafe(turn.completedAt));
  if (completedAtMs === null) {
    return null;
  }
  return Math.max(0, Math.floor((completedAtMs - startedAtMs) / 1000));
};

const latestTokenUsage = (thread: OrchestrationThread): ThreadTokenUsageSnapshot | null => {
  const activity = thread.activities.findLast((entry) => entry.kind === "context-window.updated");
  return activity ? (activity.payload as ThreadTokenUsageSnapshot) : null;
};

const formatTokenUsage = (usage: ThreadTokenUsageSnapshot | null): string =>
  usage === null
    ? "tokens n/a"
    : usage.maxTokens === undefined
      ? `${usage.usedTokens} tokens used`
      : `${usage.usedTokens}/${usage.maxTokens} tokens used`;

const formatElapsed = (seconds: number | null): string =>
  seconds === null ? "elapsed n/a" : `elapsed ${seconds}s`;

const buildInspectStageDigest = (input: {
  readonly thread: OrchestrationThread;
  readonly stageRole: OrchestrationStageRole | null;
  readonly now: DateTime.DateTime;
}): InspectStageDigest => {
  const { thread, stageRole, now } = input;
  const messages = thread.messages.slice(-MESSAGE_TAIL_LIMIT).map((message) => {
    const truncated = truncateMessageText(message.text);
    return {
      role: message.role,
      createdAt: message.createdAt,
      text: truncated.text,
      truncated: truncated.truncated,
    };
  });
  const activities = thread.activities.slice(-ACTIVITY_TAIL_LIMIT).map((activity) => ({
    kind: activity.kind,
    tone: activity.tone,
    summary: activity.summary,
    createdAt: activity.createdAt,
  }));

  return {
    stageThreadId: thread.id,
    stageRole,
    turn:
      thread.latestTurn === null
        ? null
        : {
            state: thread.latestTurn.state,
            requestedAt: thread.latestTurn.requestedAt,
            startedAt: thread.latestTurn.startedAt,
            completedAt: thread.latestTurn.completedAt,
            elapsedSeconds: elapsedSeconds(thread.latestTurn, now),
          },
    messageCount: thread.messages.length,
    activityCount: thread.activities.length,
    messages,
    activities,
    tokenUsage: latestTokenUsage(thread),
  };
};

class PmToolExecutionError extends Data.TaggedError("PmToolExecutionError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

function registeredTaskTypeId(
  requestedTaskType: string | undefined,
): Effect.Effect<TaskTypeId, PmToolExecutionError> {
  const taskTypeId = requestedTaskType?.trim() || "feature";
  const definition = defaultTaskTypeRegistry.get(taskTypeId);
  return definition === undefined
    ? Effect.fail(
        new PmToolExecutionError({
          detail: `Unknown orchestration task type '${taskTypeId}'. Registered task types: ${defaultTaskTypeRegistry.ids().join(", ")}.`,
        }),
      )
    : Effect.succeed(definition.id);
}

export const makePmToolExecutors = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const pendingApprovalRepository = yield* ProjectionPendingApprovalRepository;
  const crypto = yield* Crypto.Crypto;
  const runtimeContext = yield* Effect.context<never>();
  const vcsProcess = Context.getOption(runtimeContext, VcsProcess);
  const branchReservationsByTaskId = new Map<
    TaskId,
    { readonly cwd: string; readonly reservation: TaskBranchReservation }
  >();
  const runPromise = Effect.runPromiseWith(runtimeContext);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const commandId = (toolName: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`pm:${toolName}:${uuid}`)));
  const randomGateId = crypto.randomUUIDv4.pipe(Effect.map(GateId.make));

  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command).pipe(Effect.map((result) => result.sequence));

  const taskChangeReviewServices = Effect.gen(function* () {
    const process = Context.getOption(runtimeContext, VcsProcess);
    if (Option.isNone(process)) {
      return yield* new PmToolExecutionError({
        detail: "Task change-review git services are unavailable.",
      });
    }
    return { snapshotQuery, vcsProcess: process.value };
  });

  const directPmChangeServices = Effect.gen(function* () {
    const process = Context.getOption(runtimeContext, VcsProcess);
    if (Option.isNone(process)) {
      return yield* new PmToolExecutionError({
        detail: "Direct PM git services are unavailable.",
      });
    }
    return { vcsProcess: process.value };
  });

  const resolveDirectProject = Effect.fn("PmTools.resolveDirectProject")(function* (
    requestedProjectId: string,
  ) {
    const requestedId = ProjectId.make(requestedProjectId.trim());
    const readModel = yield* snapshotQuery.getCommandReadModel();
    const project = readModel.projects.find(
      (candidate) => candidate.id === requestedId && candidate.deletedAt === null,
    );
    if (project === undefined) {
      return yield* new PmToolExecutionError({
        detail: `Project '${requestedId}' was not found.`,
      });
    }
    return project;
  });

  const reserveBranchForTask = Effect.fn("PmTools.reserveBranchForTask")(function* (input: {
    readonly taskId: TaskId;
    readonly projectId: ProjectId;
    readonly taskType: TaskTypeId;
    readonly title: string;
  }) {
    const readModel = yield* snapshotQuery.getCommandReadModel();
    const existingTask = readModel.tasks.find((task) => task.id === input.taskId);
    if (existingTask?.branch) {
      return { branch: existingTask.branch, newlyReserved: null } as const;
    }
    const cached = branchReservationsByTaskId.get(input.taskId);
    if (cached) {
      return { branch: cached.reservation.branch, newlyReserved: null } as const;
    }
    const project = readModel.projects.find(
      (candidate) => candidate.id === input.projectId && candidate.deletedAt === null,
    );
    if (!project) {
      return yield* new PmToolExecutionError({
        detail: `Project '${input.projectId}' was not found before reserving its task branch.`,
      });
    }
    if (Option.isNone(vcsProcess)) {
      return yield* new PmToolExecutionError({
        detail: "Task branch reservation services are unavailable.",
      });
    }
    const reservation = yield* reserveTaskBranch({
      vcsProcess: vcsProcess.value,
      cwd: project.workspaceRoot,
      taskType: input.taskType,
      title: input.title,
    }).pipe(Effect.mapError((cause) => new PmToolExecutionError({ detail: cause.detail })));
    const owned = { cwd: project.workspaceRoot, reservation } as const;
    branchReservationsByTaskId.set(input.taskId, owned);
    return { branch: reservation.branch, newlyReserved: owned } as const;
  });

  const releaseNewReservations = (
    reservations: ReadonlyArray<{
      readonly taskId: TaskId;
      readonly cwd: string;
      readonly reservation: TaskBranchReservation;
    }>,
  ) =>
    Option.isNone(vcsProcess)
      ? Effect.void
      : Effect.forEach(
          reservations,
          (owned) =>
            releaseTaskBranchReservation({
              vcsProcess: vcsProcess.value,
              cwd: owned.cwd,
              reservation: owned.reservation,
            }).pipe(
              Effect.tap(() => Effect.sync(() => branchReservationsByTaskId.delete(owned.taskId))),
              Effect.catch((cause) =>
                Effect.logWarning("failed to compensate task branch reservation", {
                  taskId: owned.taskId,
                  branch: owned.reservation.branch,
                  cause,
                }),
              ),
            ),
          { discard: true },
        );

  const resolveOwnedHelperRun = Effect.fn("PmTools.resolveOwnedHelperRun")(function* (
    params: InspectHelperRunParameters,
  ) {
    const projectId = ProjectId.make(params.projectId.trim());
    const helperRunId = HelperRunId.make(params.helperRunId.trim());
    const readModel = yield* snapshotQuery.getCommandReadModel();
    const run = (readModel.helperRuns ?? []).find(
      (candidate) => candidate.id === helperRunId && candidate.projectId === projectId,
    );
    if (run === undefined) {
      return yield* new PmToolExecutionError({
        detail: `Helper run '${helperRunId}' was not found in project '${projectId}'.`,
      });
    }
    return run;
  });

  const taskChangeReviewActionInput = (taskId: TaskId) => ({
    taskId,
    commandId,
    createdAt: nowIso,
    dispatch: engine.dispatch,
  });

  const createTask: PmToolExecutor<CreateTaskParameters, { taskId: string; sequence: number }> = {
    name: "createTask",
    label: "Create task",
    description:
      "Create or reuse one orchestrator task for a project. Supply a stable idempotencyKey derived from the originating PM request and logical task; reuse that exact key for retries. Set supersedesTaskId only when intentionally replacing one settled terminal task. A release task must set releaseSourceTaskId to one fully landed feature task in the same project.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const identity = createTaskIdentity(params);
          const taskType = yield* registeredTaskTypeId(params.taskType);
          const projectId = ProjectId.make(params.projectId.trim());
          const reserved = yield* reserveBranchForTask({
            taskId: identity.taskId,
            projectId,
            taskType,
            title: params.title.trim(),
          });
          const sequence = yield* dispatch({
            type: "task.create",
            commandId: identity.commandId,
            taskId: identity.taskId,
            projectId,
            taskType,
            title: params.title.trim(),
            pmMessageId: identity.pmMessageId,
            branch: reserved.branch,
            dependsOnTaskIds: params.releaseSourceTaskId
              ? [TaskId.make(params.releaseSourceTaskId.trim())]
              : [],
            supersedesTaskId: params.supersedesTaskId
              ? TaskId.make(params.supersedesTaskId.trim())
              : null,
            createdAt: yield* nowIso,
          }).pipe(
            Effect.onError(() =>
              reserved.newlyReserved === null
                ? Effect.void
                : releaseNewReservations([{ taskId: identity.taskId, ...reserved.newlyReserved }]),
            ),
          );
          return textResult(`Created or reused task ${identity.taskId}.`, {
            taskId: identity.taskId,
            sequence,
          });
        }),
      ),
  };

  const splitTask: PmToolExecutor<
    SplitTaskParameters,
    { parentTaskId: string; childTaskIds: ReadonlyArray<string>; sequence: number }
  > = {
    name: "splitTask",
    label: "Split task",
    description:
      "Atomically split one inactive parent into 2-8 ordered child tasks. Supply a stable idempotencyKey, a unique key per child, explicit acceptance criteria, and dependencies by earlier child key. Reuse the exact request for retries.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const identity = splitTaskIdentity(params);
          if (identity.childIdsByKey.size !== params.children.length) {
            return yield* new PmToolExecutionError({ detail: "Split child keys must be unique." });
          }
          const parentTaskId = TaskId.make(params.parentTaskId.trim());
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const parent = readModel.tasks.find((task) => task.id === parentTaskId);
          if (!parent) {
            return yield* new PmToolExecutionError({
              detail: `Parent task '${parentTaskId}' was not found before reserving child branches.`,
            });
          }
          const children: OrchestrationTaskSplitChild[] = [];
          const newlyReserved: Array<{
            readonly taskId: TaskId;
            readonly cwd: string;
            readonly reservation: TaskBranchReservation;
          }> = [];
          for (const child of params.children) {
            const key = child.key.trim();
            const taskId = identity.childIdsByKey.get(key);
            if (taskId === undefined) {
              return yield* new PmToolExecutionError({
                detail: `Could not derive an identity for split child '${key}'.`,
              });
            }
            const dependsOnTaskIds: TaskId[] = [];
            for (const dependencyKeyValue of child.dependsOnKeys ?? []) {
              const dependencyKey = dependencyKeyValue.trim();
              const dependencyTaskId = identity.childIdsByKey.get(dependencyKey);
              if (dependencyTaskId === undefined) {
                return yield* new PmToolExecutionError({
                  detail: `Split child '${key}' references unknown dependency key '${dependencyKey}'.`,
                });
              }
              dependsOnTaskIds.push(dependencyTaskId);
            }
            const taskType = yield* registeredTaskTypeId(child.taskType);
            const reserved = yield* reserveBranchForTask({
              taskId,
              projectId: parent.projectId,
              taskType,
              title: child.title.trim(),
            }).pipe(Effect.onError(() => releaseNewReservations(newlyReserved)));
            if (reserved.newlyReserved !== null) {
              newlyReserved.push({ taskId, ...reserved.newlyReserved });
            }
            children.push({
              taskId,
              taskType,
              title: child.title.trim(),
              branch: reserved.branch,
              acceptanceCriteria: child.acceptanceCriteria.map((criterion) => criterion.trim()),
              dependsOnTaskIds,
            });
          }
          const sequence = yield* dispatch({
            type: "task.split",
            commandId: identity.commandId,
            taskId: parentTaskId,
            children,
            createdAt: yield* nowIso,
          }).pipe(Effect.onError(() => releaseNewReservations(newlyReserved)));
          return textResult(`Split task ${parentTaskId} into ${children.length} children.`, {
            parentTaskId,
            childTaskIds: children.map((child) => child.taskId),
            sequence,
          });
        }),
      ),
  };

  const classifyRequest: PmToolExecutor<
    ClassifyRequestParameters,
    { taskId: string; sequence: number }
  > = {
    name: "classifyRequest",
    label: "Classify request",
    description: "Classify an existing task into a task type/playbook.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const taskType = yield* registeredTaskTypeId(params.taskType);
          const resolvedPlaybook = defaultPlaybookLoader.resolve(taskType);
          const sequence = yield* dispatch({
            type: "task.classify",
            commandId: yield* commandId("classify-request"),
            taskId,
            taskType,
            playbookVersion: resolvedPlaybook?.playbookVersion ?? null,
            createdAt: yield* nowIso,
          });
          return textResult(`Classified task ${taskId}.`, { taskId, sequence });
        }),
      ),
  };

  const handoffWorker: PmToolExecutor<
    HandoffWorkerParameters,
    { taskId: string; sequence: number; stageThreadId: string | null; awaitedTurnId: null }
  > = {
    name: "handoffWorker",
    label: "Handoff worker",
    description:
      "Start a detached worker stage for a task. Use plan for bounded technical exploration, implementation planning, or a second plan critique; work for implementation; and verify for independent post-work validation before landing. Task typing is owned by classifyRequest, not a worker.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const sequence = yield* dispatch({
            type: "task.stage.start",
            commandId: yield* commandId("handoff-worker"),
            taskId,
            role: params.role as OrchestrationStageRole,
            capabilityTier: params.tier,
            instructions: params.instructions,
            createdAt: yield* nowIso,
          });
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          const stageThreadId = latestStageThreadId(task);
          return textResult(
            stageThreadId
              ? `Started ${params.tier} ${params.role} worker ${stageThreadId}.`
              : `Started ${params.tier} ${params.role} worker.`,
            { taskId, sequence, stageThreadId, awaitedTurnId: null },
          );
        }),
      ),
  };

  const steerStage: PmToolExecutor<
    SteerStageParameters,
    { taskId: string; stageThreadId: string; sequence: number }
  > = {
    name: "steerStage",
    label: "Steer stage",
    description:
      "Send a user message into a running or idle worker stage thread to correct course, add context, or answer the worker without cancelling and re-handing off.",
    execute: (toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          if (!task) {
            return yield* new PmToolExecutionError({
              detail: `Task '${taskId}' was not found.`,
            });
          }

          const selectedStageThreadId =
            params.stageThreadId === undefined
              ? latestStageThreadId(task)
              : ThreadId.make(params.stageThreadId);
          if (selectedStageThreadId === null) {
            return yield* new PmToolExecutionError({
              detail: `Task '${taskId}' has no stage thread to steer yet.`,
            });
          }
          if (!task.stageThreadIds.includes(selectedStageThreadId)) {
            return yield* new PmToolExecutionError({
              detail: `Stage thread '${selectedStageThreadId}' does not belong to task '${taskId}'.`,
            });
          }
          const thread = readModel.threads.find((entry) => entry.id === selectedStageThreadId);
          if (!thread) {
            return yield* new PmToolExecutionError({
              detail: `Stage thread '${selectedStageThreadId}' was not found.`,
            });
          }

          const sequence = yield* dispatch({
            type: "thread.turn.start",
            commandId: yield* commandId("steer-stage"),
            threadId: selectedStageThreadId,
            message: {
              messageId: pmMessageId(toolCallId),
              role: "user",
              text: params.message,
              attachments: [],
            },
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: yield* nowIso,
          });
          return textResult(
            `Queued steering request for ${selectedStageThreadId}. The worker activity records whether the provider started a turn, accepted live steering, queued it for the active turn, or rejected the request.`,
            { taskId, stageThreadId: selectedStageThreadId, sequence },
          );
        }),
      ),
  };

  const interruptStage: PmToolExecutor<
    InterruptStageParameters,
    {
      taskId: string;
      stageThreadId: string;
      sequence: number;
      status: "requested";
    }
  > = {
    name: "interruptStage",
    label: "Interrupt stage",
    description:
      "Immediately request interruption of the active worker turn. The durable stage outcome arrives separately after the provider acknowledges interruption.",
    execute: (_toolCallId, params) =>
      runPromise(
        interruptOrchestrationStageWithServices(
          { snapshotQuery },
          {
            taskId: TaskId.make(params.taskId),
            ...(params.stageThreadId === undefined
              ? {}
              : { stageThreadId: ThreadId.make(params.stageThreadId) }),
            commandId: commandId("interrupt-stage"),
            createdAt: nowIso,
            dispatch,
          },
        ).pipe(
          Effect.map((details) =>
            textResult(
              `Requested interruption of worker ${details.stageThreadId}. Wait for the durable interrupted-stage settlement before retrying or replacing it.`,
              details,
            ),
          ),
        ),
      ),
  };

  const requestApproval: PmToolExecutor<
    RequestApprovalParameters,
    { taskId: string; gateId: string; sequence: number }
  > = {
    name: "requestApproval",
    label: "Request approval",
    description: "Open a human approval gate for a task.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const gateId = yield* randomGateId;
          const taskId = TaskId.make(params.taskId);
          const worktreeCompletion =
            params.gate === "land"
              ? yield* Effect.gen(function* () {
                  const readModel = yield* snapshotQuery.getCommandReadModel();
                  const task = readModel.tasks.find((entry) => entry.id === taskId);
                  if (!task?.worktreePath) {
                    return yield* new PmToolExecutionError({
                      detail: `Task '${taskId}' does not have an owned worktree to inspect before land approval.`,
                    });
                  }
                  const process = Context.getOption(runtimeContext, VcsProcess);
                  if (Option.isNone(process)) {
                    return yield* new PmToolExecutionError({
                      detail: "The VCS process service is unavailable for land approval.",
                    });
                  }
                  return yield* inspectTaskWorktreeCompletion({
                    worktreePath: task.worktreePath,
                    process: process.value,
                  });
                })
              : undefined;
          const sequence = yield* dispatch({
            type: "task.gate.request",
            commandId: yield* commandId("request-approval"),
            taskId,
            gateId,
            gate: params.gate as OrchestrationGateKind,
            contentHash: params.contentHash,
            stageThreadId:
              params.stageThreadId === undefined ? null : ThreadId.make(params.stageThreadId),
            ...(worktreeCompletion === undefined ? {} : { worktreeCompletion }),
            createdAt: yield* nowIso,
          });
          return textResult(`Requested ${params.gate} approval ${gateId}.`, {
            taskId,
            gateId,
            sequence,
          });
        }),
      ),
  };

  const setTaskTier: PmToolExecutor<
    SetTaskTierParameters,
    {
      taskId: string;
      role: OrchestrationStageRole;
      tier: OrchestrationCapabilityTier;
      sequence: number;
    }
  > = {
    name: "setTaskTier",
    label: "Set task tier",
    description:
      "Set a semantic Cheap, Smart, or Genius default for one task stage role. The configured project/global preset resolves the harness, model, and thinking options when the attempt starts.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          const role = params.role as OrchestrationStageRole;
          const roleCapabilityTiers: GedRoleCapabilityTiers = {
            ...task?.roleCapabilityTiers,
            [role]: params.tier,
          };
          const sequence = yield* dispatch({
            type: "task.capability-tiers.set",
            commandId: yield* commandId("set-task-tier"),
            taskId,
            roleCapabilityTiers,
            origin: "pm-runtime",
            createdAt: yield* nowIso,
          });
          return textResult(`Set ${role} to ${params.tier} for task ${taskId}.`, {
            taskId,
            role,
            tier: params.tier,
            sequence,
          });
        }),
      ),
  };

  const inspectStage: PmToolExecutor<InspectStageParameters, InspectStageDetails> = {
    name: "inspectStage",
    label: "Inspect stage",
    description:
      "Inspect the current projected task/stage state and return a compact live tail of the selected worker stage thread.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId) ?? null;
          if (!task) {
            return textResult(`Task ${taskId} not found.`, {
              task,
              stageDigest: null,
            });
          }

          const selectedStageThreadId =
            params.stageThreadId === undefined
              ? latestStageThreadId(task)
              : ThreadId.make(params.stageThreadId);
          if (selectedStageThreadId === null) {
            const note = `Task '${taskId}' has no stage thread yet.`;
            return textResult(`Task ${taskId} is ${task.status}; no stage thread yet.`, {
              task,
              note,
              stageDigest: null,
            });
          }
          if (!task.stageThreadIds.includes(selectedStageThreadId)) {
            return yield* new PmToolExecutionError({
              detail: `Stage thread '${selectedStageThreadId}' does not belong to task '${taskId}'.`,
            });
          }

          const threadOption = yield* snapshotQuery.getThreadDetailById(selectedStageThreadId);
          if (Option.isNone(threadOption)) {
            return yield* new PmToolExecutionError({
              detail: `Stage thread '${selectedStageThreadId}' was not found.`,
            });
          }
          const stageRole = readModel.stageHistory[selectedStageThreadId]?.role ?? null;
          const stageDigest = buildInspectStageDigest({
            thread: threadOption.value,
            stageRole,
            now: yield* DateTime.now,
          });
          const turnState = stageDigest.turn?.state ?? "no turn";
          const roleText = stageDigest.stageRole ?? "stage";
          return textResult(
            `Task ${taskId} is ${task.status}; ${roleText} ${selectedStageThreadId} turn ${turnState}, ${formatElapsed(stageDigest.turn?.elapsedSeconds ?? null)}, messages ${stageDigest.messages.length}/${stageDigest.messageCount}, activities ${stageDigest.activities.length}/${stageDigest.activityCount}, ${formatTokenUsage(stageDigest.tokenUsage)}.`,
            {
              task,
              stageDigest,
            },
          );
        }),
      ),
  };

  const startHelperRun: PmToolExecutor<
    StartHelperRunParameters,
    {
      helperRunId: string;
      projectId: string;
      taskId: string | null;
      tier: string;
      sequence: number;
    }
  > = {
    name: "startHelperRun",
    label: "Start read-only helper",
    description:
      "Start or reuse one persisted read-only context-gathering helper attached to this PM conversation or an active task. Cheap is the default; choose Smart or Genius only when the exploration requires more judgment. Reuse the exact idempotencyKey on retries.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const projectId = ProjectId.make(params.projectId.trim());
          const identity = helperRunIdentity(params);
          const tier = params.tier ?? "cheap";
          const taskId = params.taskId?.trim() ? TaskId.make(params.taskId.trim()) : null;
          const sequence = yield* dispatch({
            type: "helper.run.request",
            commandId: identity.commandId,
            helperRunId: identity.helperRunId,
            projectId,
            attachment:
              taskId === null
                ? { kind: "pm", threadId: pmThreadIdForProject({ id: projectId }) }
                : { kind: "task", taskId },
            tier,
            prompt: params.prompt.trim(),
            createdAt: yield* nowIso,
          });
          return textResult(
            `Started or reused ${tier} read-only helper ${identity.helperRunId}${taskId === null ? " for the PM" : ` for task ${taskId}`}. Wait for its automatic completion re-entry instead of polling.`,
            {
              helperRunId: identity.helperRunId,
              projectId,
              taskId,
              tier,
              sequence,
            },
          );
        }),
      ),
  };

  const inspectHelperRun: PmToolExecutor<
    InspectHelperRunParameters,
    { helperRun: OrchestrationHelperRun }
  > = {
    name: "inspectHelperRun",
    label: "Inspect helper run",
    description:
      "Inspect one persisted helper status and its bounded result or failure. Use for an explicit operator request or one bounded diagnostic, never for polling.",
    execute: (_toolCallId, params) =>
      runPromise(
        resolveOwnedHelperRun(params).pipe(
          Effect.map((helperRun) =>
            textResult(
              `Helper ${helperRun.id} is ${helperRun.status}${helperRun.result === null ? "" : "; its bounded result is included in details"}.`,
              { helperRun },
            ),
          ),
        ),
      ),
  };

  const interruptHelperRun: PmToolExecutor<
    InterruptHelperRunParameters,
    { helperRunId: string; projectId: string; sequence: number }
  > = {
    name: "interruptHelperRun",
    label: "Interrupt helper run",
    description:
      "Interrupt one pending or running read-only helper. Its durable interrupted state and provider shutdown are handled asynchronously.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const helperRun = yield* resolveOwnedHelperRun(params);
          if (helperRun.status !== "pending" && helperRun.status !== "running") {
            return yield* new PmToolExecutionError({
              detail: `Helper run '${helperRun.id}' is already ${helperRun.status}.`,
            });
          }
          const sequence = yield* dispatch({
            type: "helper.run.interrupt",
            commandId: yield* commandId("interrupt-helper"),
            helperRunId: helperRun.id,
            createdAt: yield* nowIso,
          });
          return textResult(`Requested interruption of helper ${helperRun.id}.`, {
            helperRunId: helperRun.id,
            projectId: helperRun.projectId,
            sequence,
          });
        }),
      ),
  };

  const inspectTaskChanges: PmToolExecutor<
    InspectTaskChangesParameters,
    { taskId: string; changes: TaskWorktreeChanges }
  > = {
    name: "inspectTaskChanges",
    label: "Inspect task changes",
    description:
      "Inspect one task-owned worktree's current HEAD, changed paths, staged state, and bounded tracked diff. Use this before resolving a change review; untracked files are listed but their contents are not exposed automatically.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const services = yield* taskChangeReviewServices;
          const changes = yield* inspectOrchestratorTaskChanges(services, taskId);
          return textResult(
            `Task ${taskId} has ${changes.paths.length} changed path(s) at ${changes.head}${changes.staged ? " with staged changes" : ""}.`,
            { taskId, changes },
          );
        }),
      ),
  };

  const inspectDirectChanges: PmToolExecutor<
    InspectDirectChangesParameters,
    { projectId: string; changes: TaskWorktreeChanges }
  > = {
    name: "inspectDirectChanges",
    label: "Inspect direct PM changes",
    description:
      "Inspect the primary project checkout's current HEAD, changed paths, staged state, and bounded tracked diff before a direct PM commit. This does not create a task or expose untracked file contents automatically.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const project = yield* resolveDirectProject(params.projectId);
          const services = yield* directPmChangeServices;
          const changes = yield* inspectDirectPmChanges({
            workspaceRoot: project.workspaceRoot,
            process: services.vcsProcess,
          });
          return textResult(
            `Project ${project.id} has ${changes.paths.length} changed path(s) at ${changes.head}${changes.staged ? " with staged changes" : ""}.`,
            { projectId: project.id, changes },
          );
        }),
      ),
  };

  const commitDirectChanges: PmToolExecutor<
    CommitDirectChangesParameters,
    {
      projectId: string;
      commit: string;
      rationale: string;
      checks: ReadonlyArray<DirectPmCheckEvidence>;
      changes: TaskWorktreeChanges;
    }
  > = {
    name: "commitDirectChanges",
    label: "Commit direct PM changes",
    description:
      "Commit one exact reviewed patch for a bounded low-risk primary-checkout edit after proportional checks. Requires rationale and observed check outcomes, rejects pre-staged state, preserves unselected hunks (including other edits in the same file), and creates no task, worktree, gate, PR, or landing action. Do not use for migrations, public contracts, security-sensitive logic, broad edits, or uncertain work.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const project = yield* resolveDirectProject(params.projectId);
          const services = yield* directPmChangeServices;
          const result = yield* commitDirectPmChanges({
            workspaceRoot: project.workspaceRoot,
            process: services.vcsProcess,
            patch: params.patch,
            message: params.message,
            rationale: params.rationale,
            checks: params.checks,
          });
          return textResult(
            result.changes.dirty
              ? `Committed bounded direct change ${result.commit} for project ${project.id}; ${result.changes.paths.length} unrelated changed path(s) remain.`
              : `Committed bounded direct change ${result.commit} for project ${project.id}; the checkout is clean.`,
            { projectId: project.id, ...result },
          );
        }),
      ),
  };

  const commitTaskChanges: PmToolExecutor<
    CommitTaskChangesParameters,
    { taskId: string; commit: string; changes: TaskWorktreeChanges }
  > = {
    name: "commitTaskChanges",
    label: "Commit task changes",
    description:
      "Commit only explicitly selected changed paths in a task-owned worktree with a descriptive message. Refuses pre-staged or foreign paths, preserves unselected changes, and keeps change review pending when changes remain.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const services = yield* taskChangeReviewServices;
          const result = yield* commitOrchestratorTaskChanges(services, {
            ...taskChangeReviewActionInput(taskId),
            ...(params.paths === undefined ? {} : { paths: params.paths }),
            ...(params.patch === undefined ? {} : { patch: params.patch }),
            message: params.message,
          });
          return textResult(
            result.changes.dirty
              ? `Committed selected changes for task ${taskId}; ${result.changes.paths.length} changed path(s) still require review.`
              : `Committed selected changes and resolved change review for task ${taskId}.`,
            { taskId, commit: result.commit, changes: result.changes },
          );
        }),
      ),
  };

  const discardTaskChanges: PmToolExecutor<
    DiscardTaskChangesParameters,
    { taskId: string; changes: TaskWorktreeChanges }
  > = {
    name: "discardTaskChanges",
    label: "Discard task changes",
    description:
      "Permanently discard only explicitly selected changed paths in a task-owned worktree. Use only for changes confirmed outside task intent. Unselected changes are preserved and remain in change review.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const services = yield* taskChangeReviewServices;
          const result = yield* discardOrchestratorTaskChanges(services, {
            ...taskChangeReviewActionInput(taskId),
            paths: params.paths,
          });
          return textResult(
            result.changes.dirty
              ? `Discarded selected changes for task ${taskId}; ${result.changes.paths.length} changed path(s) still require review.`
              : `Discarded selected changes and resolved change review for task ${taskId}.`,
            { taskId, changes: result.changes },
          );
        }),
      ),
  };

  const returnTaskChanges: PmToolExecutor<
    ReturnTaskChangesParameters,
    { taskId: string; stageThreadId: string | null; sequence: number }
  > = {
    name: "returnTaskChanges",
    label: "Return changes to worker",
    description:
      "Return a pending task change review to a fresh work attempt with precise revision instructions. The prior review is recorded as returned and verification remains invalid until the new work settles.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const services = yield* taskChangeReviewServices;
          const result = yield* returnOrchestratorTaskChanges(services, {
            ...taskChangeReviewActionInput(taskId),
            instructions: params.instructions.trim(),
            ...(params.tier === undefined ? {} : { capabilityTier: params.tier }),
          });
          const { sequence, stageThreadId } = result;
          return textResult(`Returned task ${taskId} changes to work stage ${stageThreadId}.`, {
            taskId,
            stageThreadId,
            sequence,
          });
        }),
      ),
  };

  const completeTaskWithoutChanges: PmToolExecutor<
    CompleteTaskWithoutChangesParameters,
    { taskId: string; baseHead: string; head: string; sequence: number }
  > = {
    name: "completeTaskWithoutChanges",
    label: "Complete task without changes",
    description:
      "Complete and archive a settled task only when its task branch has no commits beyond its creation baseline and its owned worktree is clean. Use after accepting a worker result that correctly requires no repository changes.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const services = yield* taskChangeReviewServices;
          const result = yield* completeOrchestratorTaskWithoutChanges(
            services,
            taskChangeReviewActionInput(taskId),
          );
          return textResult(`Completed and archived task ${taskId} without repository changes.`, {
            taskId,
            baseHead: result.baseHead,
            head: result.head,
            sequence: result.sequence,
          });
        }),
      ),
  };

  const listPendingStageApprovals: PmToolExecutor<
    ListPendingStageApprovalsParameters,
    { taskId: string; approvals: ReadonlyArray<PendingStageApprovalSummary> }
  > = {
    name: "listPendingStageApprovals",
    label: "List pending worker approvals",
    description:
      "List unresolved provider permission requests for worker stage threads owned by one task. Use this after a permission-request re-entry instead of polling.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          if (!task) {
            return yield* new PmToolExecutionError({ detail: `Task '${taskId}' was not found.` });
          }
          const rows = (yield* Effect.forEach(
            task.stageThreadIds,
            (threadId) => pendingApprovalRepository.listByThreadId({ threadId }),
            { concurrency: 1 },
          ))
            .flat()
            .filter((row) => row.status === "pending");
          const approvals = yield* Effect.forEach(rows, (row) =>
            Effect.gen(function* () {
              const thread = yield* snapshotQuery
                .getThreadDetailById(row.threadId)
                .pipe(Effect.map(Option.getOrNull));
              const activity = thread?.activities.findLast((candidate) => {
                if (candidate.kind !== "approval.requested") return false;
                const payload = candidate.payload;
                return (
                  typeof payload === "object" &&
                  payload !== null &&
                  "requestId" in payload &&
                  payload.requestId === row.requestId
                );
              });
              const payload =
                typeof activity?.payload === "object" && activity.payload !== null
                  ? (activity.payload as Record<string, unknown>)
                  : null;
              return {
                requestId: row.requestId,
                stageThreadId: row.threadId,
                stageRole: readModel.stageHistory[row.threadId]?.role ?? null,
                turnId: row.turnId,
                requestKind: typeof payload?.requestKind === "string" ? payload.requestKind : null,
                detail: typeof payload?.detail === "string" ? payload.detail : null,
                createdAt: row.createdAt,
              } satisfies PendingStageApprovalSummary;
            }),
          );
          return textResult(`Found ${approvals.length} pending worker approval(s).`, {
            taskId,
            approvals,
          });
        }),
      ),
  };

  const respondToStageApproval: PmToolExecutor<
    RespondToStageApprovalParameters,
    { taskId: string; requestId: string; decision: ProviderApprovalDecision; sequence: number }
  > = {
    name: "respondToStageApproval",
    label: "Resolve worker approval",
    description:
      "Resolve one still-pending worker permission request owned by the specified task. Apply least privilege: prefer one-action accept, reserve acceptForSession for a stable repeated need, and decline unrelated or scope-expanding access.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const requestId = ApprovalRequestId.make(params.requestId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          if (!task) {
            return yield* new PmToolExecutionError({ detail: `Task '${taskId}' was not found.` });
          }
          const pending = yield* pendingApprovalRepository
            .getByRequestId({ requestId })
            .pipe(Effect.map(Option.getOrNull));
          if (pending === null || pending.status !== "pending") {
            return yield* new PmToolExecutionError({
              detail: `Approval request '${requestId}' is not pending.`,
            });
          }
          if (!task.stageThreadIds.includes(pending.threadId)) {
            return yield* new PmToolExecutionError({
              detail: `Approval request '${requestId}' does not belong to task '${taskId}'.`,
            });
          }
          const sequence = yield* dispatch({
            type: "thread.approval.respond",
            commandId: yield* commandId("respond-stage-approval"),
            threadId: pending.threadId,
            requestId,
            decision: params.decision,
            createdAt: yield* nowIso,
          });
          return textResult(`Resolved worker approval ${requestId} with ${params.decision}.`, {
            taskId,
            requestId,
            decision: params.decision,
            sequence,
          });
        }),
      ),
  };

  const cancelTask: PmToolExecutor<CancelTaskParameters, { taskId: string; sequence: number }> = {
    name: "cancelTask",
    label: "Cancel task",
    description:
      "Cancel/abandon a task and free its worktree slot — use to clear a stuck or stale task. Works on any non-terminal task.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const providerServiceOption = Context.getOption(runtimeContext, ProviderService);
          if (Option.isNone(providerServiceOption)) {
            return yield* new OrchestrationCancelTaskError({
              taskId,
              phase: "stop-session",
              message: "ProviderService is unavailable for task cancellation.",
            });
          }
          const terminalManagerOption = Context.getOption(runtimeContext, TerminalManager);
          if (Option.isNone(terminalManagerOption)) {
            return yield* new OrchestrationCancelTaskError({
              taskId,
              phase: "close-terminals",
              message: "TerminalManager is unavailable for task cancellation.",
            });
          }
          const result = yield* cancelOrchestrationTaskWithServices(
            {
              snapshotQuery,
              providerService: providerServiceOption.value,
              terminalManager: terminalManagerOption.value,
            },
            {
              taskId,
              commandId: commandId("cancel-task"),
              createdAt: nowIso,
              dispatch: (command) =>
                dispatch(command).pipe(Effect.map((sequence) => ({ sequence }))),
            },
          );
          return textResult(`Cancelled task ${taskId}.`, { taskId, sequence: result.sequence });
        }),
      ),
  };

  const landTask: PmToolExecutor<
    LandTaskParameters,
    { taskId: string; sequence: number; alreadyLanded: boolean; alreadyInProgress: boolean }
  > = {
    name: "landTask",
    label: "Land task",
    description:
      "Land a reviewed task after a human-approved land gate, or retry its exhausted PR-opening failure. This starts the existing landing workflow; it cannot approve the gate itself.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const vcsProcess = Context.getOption(runtimeContext, VcsProcess);
          if (Option.isNone(vcsProcess)) {
            return yield* new PmToolExecutionError({
              detail: "The VCS process service is unavailable for landing.",
            });
          }
          const { sequence, alreadyLanded, alreadyInProgress } =
            yield* landOrchestrationTaskWithServices(
              {
                snapshotQuery,
                vcsProcess: vcsProcess.value,
              },
              {
                taskId,
                commandId: commandId("land-task"),
                createdAt: nowIso,
                dispatch: (command) => engine.dispatch(command),
              },
            );
          const summary = alreadyLanded
            ? `Task ${taskId} is already landed.`
            : alreadyInProgress
              ? `Task ${taskId} landing is already in progress.`
              : `Started landing task ${taskId}.`;
          return textResult(summary, {
            taskId,
            sequence,
            alreadyLanded,
            alreadyInProgress,
          });
        }),
      ),
  };

  const requestReleaseApproval: PmToolExecutor<
    ReleaseParameters,
    { taskId: string; gateId: string; sequence: number; contentHash: string }
  > = {
    name: "requestReleaseApproval",
    label: "Request release approval",
    description:
      "Open the mandatory human approval gate for exact GitHub Actions workflow dispatch parameters. Reuse the same workflow, ref, and inputs with dispatchRelease after approval.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const gateId = yield* randomGateId;
          const contentHash = releaseDispatchContentHash({
            workflow: params.workflow,
            ref: params.ref,
            inputs: params.inputs ?? {},
          });
          const sequence = yield* dispatch({
            type: "task.gate.request",
            commandId: yield* commandId("request-release-approval"),
            taskId,
            gateId,
            gate: "release",
            contentHash,
            stageThreadId: null,
            createdAt: yield* nowIso,
          });
          return textResult(`Requested release approval ${gateId}.`, {
            taskId,
            gateId,
            sequence,
            contentHash,
          });
        }),
      ),
  };

  const dispatchRelease: PmToolExecutor<ReleaseParameters, unknown> = {
    name: "dispatchRelease",
    label: "Dispatch release",
    description:
      "Dispatch the exact human-approved GitHub Actions workflow once. Refuses dirty repositories and returns the durable authoritative dispatch status and workflow URL.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const github = Context.getOption(runtimeContext, GitHubCli);
          const process = Context.getOption(runtimeContext, VcsProcess);
          if (Option.isNone(github) || Option.isNone(process)) {
            return yield* new PmToolExecutionError({
              detail: "GitHub release dispatch services are unavailable.",
            });
          }
          const result = yield* dispatchReleaseWithServices(
            { snapshotQuery, github: github.value, process: process.value },
            {
              taskId,
              workflow: params.workflow,
              ref: params.ref,
              inputs: params.inputs ?? {},
              commandId,
              createdAt: nowIso,
              dispatch: (command) => engine.dispatch(command),
            },
          );
          return textResult(
            result.alreadyRequested
              ? `Release dispatch for task ${taskId} was already requested.`
              : `Dispatched release workflow for task ${taskId}.`,
            result,
          );
        }),
      ),
  };

  const makeTaskRetentionTool = (input: {
    readonly name: "archiveTask" | "restoreTask" | "deleteTask";
    readonly label: string;
    readonly description: string;
    readonly commandType: "task.archive" | "task.restore" | "task.delete";
    readonly completedVerb: string;
  }): PmToolExecutor<TaskRetentionParameters, { taskId: string; sequence: number }> => ({
    name: input.name,
    label: input.label,
    description: input.description,
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const result = yield* engine.dispatch({
            type: input.commandType,
            commandId: yield* commandId(input.name),
            taskId,
          });
          return textResult(`${input.completedVerb} task ${taskId}.`, {
            taskId,
            sequence: result.sequence,
          });
        }),
      ),
  });

  const archiveTask = makeTaskRetentionTool({
    name: "archiveTask",
    label: "Archive task",
    description:
      "Archive a settled abandoned or fully landed task so it no longer appears in the active task ledger. The task can be restored later.",
    commandType: "task.archive",
    completedVerb: "Archived",
  });

  const restoreTask = makeTaskRetentionTool({
    name: "restoreTask",
    label: "Restore task",
    description: "Restore an archived task to the active task ledger.",
    commandType: "task.restore",
    completedVerb: "Restored",
  });

  const deleteTask = makeTaskRetentionTool({
    name: "deleteTask",
    label: "Delete task permanently",
    description:
      "Permanently hide a settled task with an append-only deletion tombstone. Event history is retained, but the task cannot be restored or changed afterward.",
    commandType: "task.delete",
    completedVerb: "Deleted",
  });

  const getTaskLedger: PmToolExecutor<
    GetTaskLedgerParameters,
    { projectId: string; lastActionCursor: number; tasks: ReadonlyArray<PmTaskSummary> }
  > = {
    name: "getTaskLedger",
    label: "Get task ledger",
    description:
      "Read bounded task summaries for a project. The response cursor identifies the projected state and each task includes only its three most recent stage attempts.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const projectId = ProjectId.make(params.projectId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const tasks = readModel.tasks.filter(
            (task) =>
              task.projectId === projectId && task.archivedAt === null && task.deletedAt === null,
          );
          return textResult(`Found ${tasks.length} task(s).`, {
            projectId,
            lastActionCursor: readModel.snapshotSequence,
            tasks: tasks.map((task) => summarizeTaskForPm(task, readModel)),
          });
        }),
      ),
  };

  return [
    classifyRequest,
    createTask,
    splitTask,
    handoffWorker,
    steerStage,
    interruptStage,
    requestApproval,
    setTaskTier,
    inspectStage,
    startHelperRun,
    inspectHelperRun,
    interruptHelperRun,
    inspectDirectChanges,
    commitDirectChanges,
    inspectTaskChanges,
    commitTaskChanges,
    discardTaskChanges,
    returnTaskChanges,
    completeTaskWithoutChanges,
    listPendingStageApprovals,
    respondToStageApproval,
    cancelTask,
    landTask,
    requestReleaseApproval,
    dispatchRelease,
    archiveTask,
    restoreTask,
    deleteTask,
    getTaskLedger,
  ] as const;
});

export const makePmTools = makePmToolExecutors.pipe(
  Effect.map(
    (tools) =>
      tools.map((executor) => ({
        name: executor.name,
        label: executor.label,
        description: executor.description,
        execute: executor.execute,
      })) as ReadonlyArray<PmToolExecutor>,
  ),
);
