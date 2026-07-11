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
  type OrchestrationGateKind,
  type OrchestrationStageRole,
  type OrchestrationTask,
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

import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { TerminalManager } from "../../terminal/Services/Manager.ts";
import { cancelOrchestrationTaskWithServices } from "../taskCancellation.ts";
import { landOrchestrationTaskWithServices } from "../taskLanding.ts";

interface CreateTaskParameters {
  readonly projectId: string;
  readonly title: string;
  readonly taskType?: string;
  readonly branch?: string;
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

interface GetTaskLedgerParameters {
  readonly projectId: string;
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

export const makePmToolExecutors = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshotQuery = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const runtimeContext = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(runtimeContext);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const commandId = (toolName: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => CommandId.make(`pm:${toolName}:${uuid}`)));
  const randomTaskId = crypto.randomUUIDv4.pipe(Effect.map(TaskId.make));
  const randomGateId = crypto.randomUUIDv4.pipe(Effect.map(GateId.make));

  const dispatch = (command: Parameters<typeof engine.dispatch>[0]) =>
    engine.dispatch(command).pipe(Effect.map((result) => result.sequence));

  const createTask: PmToolExecutor<CreateTaskParameters, { taskId: string; sequence: number }> = {
    name: "createTask",
    label: "Create task",
    description: "Create a new orchestrator task for a project.",
    execute: (toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = yield* randomTaskId;
          const sequence = yield* dispatch({
            type: "task.create",
            commandId: yield* commandId("create-task"),
            taskId,
            projectId: ProjectId.make(params.projectId),
            taskType: TaskTypeId.make(params.taskType ?? "feature"),
            title: params.title,
            pmMessageId: pmMessageId(toolCallId),
            branch: params.branch ?? null,
            createdAt: yield* nowIso,
          });
          return textResult(`Created task ${taskId}.`, { taskId, sequence });
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
          const taskType = params.taskType ?? "feature";
          const resolvedPlaybook = defaultPlaybookLoader.resolve(taskType);
          const sequence = yield* dispatch({
            type: "task.classify",
            commandId: yield* commandId("classify-request"),
            taskId,
            taskType: TaskTypeId.make(taskType),
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
      "Start a detached worker stage for a task. Use classify for task typing, plan for implementation planning, review for pre-work plan critique, work for implementation, and verify for post-work validation before landing.",
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
            `Sent steering message to ${selectedStageThreadId}; provider behavior matches the human chat path, so active worker turns accept or reject steering according to the target provider.`,
            { taskId, stageThreadId: selectedStageThreadId, sequence },
          );
        }),
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
      "Change which provider/model a task stage role runs on when asked. This overrides the project's per-role default for that task only.",
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
    { taskId: string; sequence: number; alreadyLanded: boolean }
  > = {
    name: "landTask",
    label: "Land task",
    description:
      "Land a reviewed task after a human-approved land gate. This starts the existing landing workflow; it cannot approve the gate itself.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const { sequence, alreadyLanded } = yield* landOrchestrationTaskWithServices(
            { snapshotQuery },
            {
              taskId,
              commandId: commandId("land-task"),
              createdAt: nowIso,
              dispatch: (command) => engine.dispatch(command),
            },
          );
          return textResult(
            alreadyLanded ? `Task ${taskId} is already landed.` : `Started landing task ${taskId}.`,
            {
              taskId,
              sequence,
              alreadyLanded,
            },
          );
        }),
      ),
  };

  const getTaskLedger: PmToolExecutor<
    GetTaskLedgerParameters,
    { projectId: string; tasks: ReadonlyArray<OrchestrationTask> }
  > = {
    name: "getTaskLedger",
    label: "Get task ledger",
    description: "Read the projected task ledger for a project.",
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const projectId = ProjectId.make(params.projectId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const tasks = readModel.tasks.filter((task) => task.projectId === projectId);
          return textResult(`Found ${tasks.length} task(s).`, { projectId, tasks });
        }),
      ),
  };

  return [
    classifyRequest,
    createTask,
    handoffWorker,
    steerStage,
    requestApproval,
    setTaskBackend,
    inspectStage,
    cancelTask,
    landTask,
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
