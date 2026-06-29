import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type, type Static } from "@earendil-works/pi-ai";
import {
  CommandId,
  GateId,
  ProviderInstanceId,
  MessageId,
  ProjectId,
  TaskId,
  TaskTypeId,
  ThreadId,
  type GedRoleModelSelections,
  type OrchestrationGateKind,
  type OrchestrationStageRole,
  type OrchestrationTask,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { defaultPlaybookLoader } from "../PlaybookLoader.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const CreateTaskParameters = Type.Object({
  projectId: Type.String(),
  title: Type.String(),
  taskType: Type.Optional(Type.String()),
  branch: Type.Optional(Type.String()),
});
type CreateTaskParameters = Static<typeof CreateTaskParameters>;

const ClassifyRequestParameters = Type.Object({
  taskId: Type.String(),
  taskType: Type.Optional(Type.String()),
  playbookVersion: Type.Optional(Type.String()),
});
type ClassifyRequestParameters = Static<typeof ClassifyRequestParameters>;

const HandoffWorkerParameters = Type.Object({
  taskId: Type.String(),
  role: Type.Union([
    Type.Literal("classify"),
    Type.Literal("plan"),
    Type.Literal("review"),
    Type.Literal("work"),
    Type.Literal("verify"),
  ]),
  instructions: Type.String(),
});
type HandoffWorkerParameters = Static<typeof HandoffWorkerParameters>;

const RequestApprovalParameters = Type.Object({
  taskId: Type.String(),
  gate: Type.Union([Type.Literal("plan"), Type.Literal("land")]),
  contentHash: Type.String(),
  stageThreadId: Type.Optional(Type.String()),
});
type RequestApprovalParameters = Static<typeof RequestApprovalParameters>;

const SetTaskBackendParameters = Type.Object({
  taskId: Type.String(),
  role: Type.Union([
    Type.Literal("classify"),
    Type.Literal("plan"),
    Type.Literal("review"),
    Type.Literal("work"),
    Type.Literal("verify"),
  ]),
  instanceId: Type.String(),
  model: Type.String(),
});
type SetTaskBackendParameters = Static<typeof SetTaskBackendParameters>;

const InspectStageParameters = Type.Object({
  taskId: Type.String(),
});
type InspectStageParameters = Static<typeof InspectStageParameters>;

const GetTaskLedgerParameters = Type.Object({
  projectId: Type.String(),
});
type GetTaskLedgerParameters = Static<typeof GetTaskLedgerParameters>;

export interface PmToolResult<TDetails> {
  readonly content: AgentToolResult<TDetails>["content"];
  readonly details: TDetails;
}

export interface PmToolExecutor<TParams = unknown, TDetails = unknown> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly execute: (toolCallId: string, params: TParams) => Promise<PmToolResult<TDetails>>;
}

const textResult = <TDetails>(summary: string, details: TDetails): PmToolResult<TDetails> => ({
  content: [{ type: "text", text: summary }],
  details,
});

const latestStageThreadId = (task: OrchestrationTask | undefined): ThreadId | null =>
  task?.stageThreadIds.at(-1) ?? null;

const pmMessageId = (toolCallId: string) => MessageId.make(`pm-tool:${toolCallId}`);

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
    parameters: CreateTaskParameters,
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
    parameters: ClassifyRequestParameters,
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
    parameters: HandoffWorkerParameters,
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

  const requestApproval: PmToolExecutor<
    RequestApprovalParameters,
    { taskId: string; gateId: string; sequence: number }
  > = {
    name: "requestApproval",
    label: "Request approval",
    description: "Open a human approval gate for a task.",
    parameters: RequestApprovalParameters,
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
    parameters: SetTaskBackendParameters,
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

  const inspectStage: PmToolExecutor<InspectStageParameters, { task: OrchestrationTask | null }> = {
    name: "inspectStage",
    label: "Inspect stage",
    description: "Inspect the current projected task/stage state.",
    parameters: InspectStageParameters,
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const taskId = TaskId.make(params.taskId);
          const readModel = yield* snapshotQuery.getCommandReadModel();
          const task = readModel.tasks.find((entry) => entry.id === taskId) ?? null;
          return textResult(
            task ? `Task ${taskId} is ${task.status}.` : `Task ${taskId} not found.`,
            {
              task,
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
    parameters: GetTaskLedgerParameters,
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
    requestApproval,
    setTaskBackend,
    inspectStage,
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
        parameters: executor.parameters,
        execute: executor.execute,
      })) as ReadonlyArray<AgentTool>,
  ),
);
