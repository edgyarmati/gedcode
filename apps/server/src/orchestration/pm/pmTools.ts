import {
  CommandId,
  GateId,
  ProviderInstanceId,
  MessageId,
  OrchestrationCancelTaskError,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type OrchestrationLatestTurn,
  type OrchestrationMessageRole,
  type GedRoleModelSelections,
  type ProviderOptionSelection,
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
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { cancelOrchestrationTaskWithServices } from "../taskCancellation.ts";
import { landOrchestrationTaskWithServices } from "../taskLanding.ts";
import { interruptOrchestrationStageWithServices } from "../stageInterrupt.ts";
import { dispatchReleaseWithServices, releaseDispatchContentHash } from "../releaseDispatch.ts";
import { GitHubCli } from "../../sourceControl/GitHubCli.ts";
import { VcsProcess } from "../../vcs/VcsProcess.ts";

interface CreateTaskParameters {
  readonly projectId: string;
  readonly title: string;
  readonly idempotencyKey: string;
  readonly taskType?: string;
  readonly branch?: string;
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

interface SetTaskBackendParameters {
  readonly taskId: string;
  readonly role: OrchestrationStageRole;
  readonly instanceId: string;
  readonly model: string;
  readonly options?: ReadonlyArray<ProviderOptionSelection>;
}

interface InspectStageParameters {
  readonly taskId: string;
  readonly stageThreadId?: string;
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
  readonly roleModelSelections: GedRoleModelSelections;
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
  const branch = params.branch?.trim() || null;
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
        branch,
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
  roleModelSelections: task.roleModelSelections ?? {},
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
  const crypto = yield* Crypto.Crypto;
  const runtimeContext = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(runtimeContext);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const commandId = (toolName: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`pm:${toolName}:${uuid}`)));
  const randomGateId = crypto.randomUUIDv4.pipe(Effect.map(GateId.make));

  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command).pipe(Effect.map((result) => result.sequence));

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
          const sequence = yield* dispatch({
            type: "task.create",
            commandId: identity.commandId,
            taskId: identity.taskId,
            projectId: ProjectId.make(params.projectId.trim()),
            taskType,
            title: params.title.trim(),
            pmMessageId: identity.pmMessageId,
            branch: params.branch?.trim() || null,
            dependsOnTaskIds: params.releaseSourceTaskId
              ? [TaskId.make(params.releaseSourceTaskId.trim())]
              : [],
            supersedesTaskId: params.supersedesTaskId
              ? TaskId.make(params.supersedesTaskId.trim())
              : null,
            createdAt: yield* nowIso,
          });
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
          const children: OrchestrationTaskSplitChild[] = [];
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
            children.push({
              taskId,
              taskType: yield* registeredTaskTypeId(child.taskType),
              title: child.title.trim(),
              acceptanceCriteria: child.acceptanceCriteria.map((criterion) => criterion.trim()),
              dependsOnTaskIds,
            });
          }
          const parentTaskId = TaskId.make(params.parentTaskId.trim());
          const sequence = yield* dispatch({
            type: "task.split",
            commandId: identity.commandId,
            taskId: parentTaskId,
            children,
            createdAt: yield* nowIso,
          });
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
            instructions: params.instructions,
            createdAt: yield* nowIso,
          });
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          const stageThreadId = latestStageThreadId(task);
          return textResult(
            stageThreadId
              ? `Started ${params.role} worker ${stageThreadId}.`
              : `Started ${params.role} worker.`,
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
          const sequence = yield* dispatch({
            type: "task.gate.request",
            commandId: yield* commandId("request-approval"),
            taskId,
            gateId,
            gate: params.gate as OrchestrationGateKind,
            contentHash: params.contentHash,
            stageThreadId:
              params.stageThreadId === undefined ? null : ThreadId.make(params.stageThreadId),
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

  const setTaskBackend: PmToolExecutor<
    SetTaskBackendParameters,
    { taskId: string; role: OrchestrationStageRole; sequence: number }
  > = {
    name: "setTaskBackend",
    label: "Set task backend",
    description:
      "Change which provider/model/options a task stage role runs on when asked. This overrides the project's per-role default for that task only; pass the provider's reasoning-effort option when selecting effort.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId);
          const role = params.role as OrchestrationStageRole;
          const roleModelSelections: GedRoleModelSelections = {
            ...task?.roleModelSelections,
            [role]: {
              instanceId: ProviderInstanceId.make(params.instanceId),
              model: params.model,
              ...(params.options === undefined ? {} : { options: [...params.options] }),
            },
          };
          const sequence = yield* dispatch({
            type: "task.role-selections.set",
            commandId: yield* commandId("set-task-backend"),
            taskId,
            roleModelSelections,
            origin: "pm-runtime",
            createdAt: yield* nowIso,
          });
          return textResult(`Set ${role} backend for task ${taskId}.`, { taskId, role, sequence });
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
          const { sequence, alreadyLanded, alreadyInProgress } =
            yield* landOrchestrationTaskWithServices(
              { snapshotQuery },
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
    setTaskBackend,
    inspectStage,
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
