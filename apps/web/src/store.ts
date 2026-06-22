import type {
  EnvironmentId,
  MessageId,
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationMessage,
  OrchestrationPendingGate,
  OrchestrationPmQuotaBlock,
  OrchestrationProposedPlan,
  OrchestrationReadModel,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamEvent,
  OrchestrationSession,
  OrchestrationSessionStatus,
  OrchestrationTask,
  OrchestrationThread,
  OrchestrationThreadShell,
  OrchestrationThreadActivity,
  OrchestratorProjectDetailSnapshot,
  OrchestratorProjectStreamItem,
  OrchestratorTaskDetailSnapshot,
  OrchestratorTaskStreamItem,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { isProviderDriverKind, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import type { GateId, TaskId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { resolveModelSlugForProvider } from "@t3tools/shared/model";
import { create } from "zustand";
import {
  type ChatMessage,
  type Project,
  type OrchestratorPendingGate,
  type OrchestratorTask,
  type ProposedPlan,
  type SidebarThreadSummary,
  type Thread,
  type ThreadSession,
  type ThreadShell,
  type ThreadTurnState,
  type TurnDiffSummary,
} from "./types";
import { resolveEnvironmentHttpUrl } from "./environments/runtime";
import { sanitizeThreadErrorMessage } from "./rpc/transportError";
import { getThreadFromEnvironmentState } from "./threadDerivation";
const isProviderDriverKindValue = Schema.is(ProviderDriverKind);

// Minimal per-task quota-block surface for the task-board badge. Sourced from
// the project snapshot's `quotaBlockedStages` and the streamed `task.stage-blocked`
// event; intentionally not the full contract row (no branded retry bookkeeping).
export interface TaskQuotaBlock {
  readonly resetAt: string | null;
  readonly providerInstanceId: ProviderInstanceId;
  readonly stageThreadId: ThreadId;
}

export type ProjectPmQuotaBlock = OrchestrationPmQuotaBlock;

export interface EnvironmentState {
  projectIds: ProjectId[];
  projectById: Record<ProjectId, Project>;
  taskIds: string[];
  taskIdsByProjectId: Record<ProjectId, string[]>;
  taskById: Record<string, OrchestratorTask>;
  pendingGateIdsByTaskId: Record<string, string[]>;
  pendingGateById: Record<string, OrchestratorPendingGate>;
  // Active quota-blocked stage per task (at most one stage is active at a time).
  // Seeded from the project snapshot and kept live by `task.stage-blocked`
  // (set) / `task.stage-started` (clear) events. Drives the "resets ~HH:MM"
  // task-board badge; the badge itself is gated on `task.status`.
  quotaBlockedStageByTaskId: Record<string, TaskQuotaBlock>;
  // Active PM-provider quota block per project. Seeded from the project snapshot,
  // updated live from PM-thread quota-paused activity, and cleared when the PM
  // starts speaking again.
  pmQuotaBlockByProjectId: Record<string, ProjectPmQuotaBlock>;

  // ---------------------------------------------------------------------------
  // Thread bookkeeping — written by BOTH shell stream and detail stream.
  // Both streams ensure the thread is registered here; the bookkeeping is
  // additive (append-only IDs) so concurrent writes are safe.
  // ---------------------------------------------------------------------------
  threadIds: ThreadId[];
  threadIdsByProjectId: Record<ProjectId, ThreadId[]>;

  // ---------------------------------------------------------------------------
  // Thread shell / session / turn — written by BOTH shell stream and detail
  // stream.  The shell stream is the *authoritative* source (server pre-
  // computes these from the projection pipeline), but the detail stream also
  // writes them so the active thread has up-to-date state even if the shell
  // event hasn't arrived yet.  Structural equality checks in both write
  // functions prevent unnecessary React re-renders when both streams deliver
  // equivalent data.
  // ---------------------------------------------------------------------------
  threadShellById: Record<ThreadId, ThreadShell>;
  threadSessionById: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById: Record<ThreadId, ThreadTurnState>;

  // ---------------------------------------------------------------------------
  // Thread detail content — written ONLY by the detail stream
  // (writeThreadState / syncServerThreadDetail).  The shell stream never
  // touches these.
  // ---------------------------------------------------------------------------
  messageIdsByThreadId: Record<ThreadId, MessageId[]>;
  messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>>;
  activityIdsByThreadId: Record<ThreadId, string[]>;
  activityByThreadId: Record<ThreadId, Record<string, OrchestrationThreadActivity>>;
  proposedPlanIdsByThreadId: Record<ThreadId, string[]>;
  proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>>;
  turnDiffIdsByThreadId: Record<ThreadId, TurnId[]>;
  turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>>;

  // ---------------------------------------------------------------------------
  // Sidebar summary — written ONLY by the shell stream
  // (writeThreadShellState / mapThreadShell).  Pre-computed server-side with
  // fields like latestUserMessageAt, hasPendingApprovals, etc.  The detail
  // stream must NOT write here; the shell stream is the single source of
  // truth for sidebar data.
  // ---------------------------------------------------------------------------
  sidebarThreadSummaryById: Record<ThreadId, SidebarThreadSummary>;

  bootstrapComplete: boolean;
}

export interface AppState {
  activeEnvironmentId: EnvironmentId | null;
  environmentStateById: Record<string, EnvironmentState>;
}

export interface ScopedTaskRef {
  readonly environmentId: EnvironmentId;
  readonly taskId: TaskId;
}

const initialEnvironmentState: EnvironmentState = {
  projectIds: [],
  projectById: {},
  taskIds: [],
  taskIdsByProjectId: {},
  taskById: {},
  pendingGateIdsByTaskId: {},
  pendingGateById: {},
  quotaBlockedStageByTaskId: {},
  pmQuotaBlockByProjectId: {},
  threadIds: [],
  threadIdsByProjectId: {},
  threadShellById: {},
  threadSessionById: {},
  threadTurnStateById: {},
  messageIdsByThreadId: {},
  messageByThreadId: {},
  activityIdsByThreadId: {},
  activityByThreadId: {},
  proposedPlanIdsByThreadId: {},
  proposedPlanByThreadId: {},
  turnDiffIdsByThreadId: {},
  turnDiffSummaryByThreadId: {},
  sidebarThreadSummaryById: {},
  bootstrapComplete: false,
};

const initialState: AppState = {
  activeEnvironmentId: null,
  environmentStateById: {},
};

const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;
const MAX_THREAD_PROPOSED_PLANS = 200;
const MAX_THREAD_ACTIVITIES = 500;
const EMPTY_THREAD_IDS: ThreadId[] = [];
const EMPTY_TASK_IDS: string[] = [];
const EMPTY_GATE_IDS: string[] = [];

function arraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Accepts the open `instanceId` string carried on `ModelSelection`; malformed
// values pass through unchanged, while valid slugs use any registered alias
// table for model normalization.
function normalizeModelSelection<T extends { instanceId: string; model: string }>(selection: T): T {
  if (!isProviderDriverKind(selection.instanceId)) {
    return selection;
  }
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.instanceId, selection.model),
  };
}

function mapProjectScripts(scripts: ReadonlyArray<Project["scripts"][number]>): Project["scripts"] {
  return scripts.map((script) => ({ ...script }));
}

function mapSession(session: OrchestrationSession): ThreadSession {
  return {
    provider: toLegacyProvider(session.providerName),
    providerInstanceId: session.providerInstanceId ?? undefined,
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
}

function mapMessage(environmentId: EnvironmentId, message: OrchestrationMessage): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: resolveEnvironmentHttpUrl({
      environmentId,
      pathname: attachmentPreviewRoutePath(attachment.id),
    }),
  }));

  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

function mapProposedPlan(proposedPlan: OrchestrationProposedPlan): ProposedPlan {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

function mapTurnDiffSummary(checkpoint: OrchestrationCheckpointSummary): TurnDiffSummary {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}

function mapProject(
  project:
    | OrchestrationReadModel["projects"][number]
    | OrchestrationShellSnapshot["projects"][number],
  environmentId: EnvironmentId,
): Project {
  return {
    id: project.id,
    environmentId,
    name: project.title,
    cwd: project.workspaceRoot,
    repositoryIdentity: project.repositoryIdentity ?? null,
    defaultModelSelection: project.defaultModelSelection
      ? normalizeModelSelection(project.defaultModelSelection)
      : null,
    roleModelSelections: Object.fromEntries(
      Object.entries(project.roleModelSelections ?? {}).map(([role, selection]) => [
        role,
        normalizeModelSelection(selection),
      ]),
    ),
    rolePromptPrefixes: { ...project.rolePromptPrefixes },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scripts: mapProjectScripts(project.scripts),
  };
}

function mapOrchestratorTask(
  task: OrchestrationTask,
  environmentId: EnvironmentId,
): OrchestratorTask {
  return {
    ...task,
    stageThreadIds: [...task.stageThreadIds],
    roleModelSelections: Object.fromEntries(
      Object.entries(task.roleModelSelections ?? {}).map(([role, selection]) => [
        role,
        normalizeModelSelection(selection),
      ]),
    ),
    environmentId,
  };
}

function mapOrchestratorPendingGate(
  pendingGate: OrchestrationPendingGate,
  environmentId: EnvironmentId,
): OrchestratorPendingGate {
  return {
    ...pendingGate,
    environmentId,
  };
}

function mapThread(thread: OrchestrationThread, environmentId: EnvironmentId): Thread {
  return {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    ...(thread.gedWorkflowEnabled !== undefined
      ? { gedWorkflowEnabled: thread.gedWorkflowEnabled }
      : {}),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    session: thread.session ? mapSession(thread.session) : null,
    messages: thread.messages.map((message) => mapMessage(environmentId, message)),
    proposedPlans: thread.proposedPlans.map(mapProposedPlan),
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    turnDiffSummaries: thread.checkpoints.map(mapTurnDiffSummary),
    activities: thread.activities.map((activity) => ({ ...activity })),
  };
}

function mapThreadShell(
  thread: OrchestrationThreadShell,
  environmentId: EnvironmentId,
): {
  shell: ThreadShell;
  session: ThreadSession | null;
  turnState: ThreadTurnState;
  summary: SidebarThreadSummary;
} {
  const shell: ThreadShell = {
    id: thread.id,
    environmentId,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    ...(thread.gedWorkflowEnabled !== undefined
      ? { gedWorkflowEnabled: thread.gedWorkflowEnabled }
      : {}),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: sanitizeThreadErrorMessage(thread.session?.lastError),
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
  };
  const session = thread.session ? mapSession(thread.session) : null;
  const turnState: ThreadTurnState = {
    latestTurn: thread.latestTurn,
    pendingSourceProposedPlan: thread.latestTurn?.sourceProposedPlan,
  };
  const summary: SidebarThreadSummary = {
    id: thread.id,
    environmentId,
    projectId: thread.projectId,
    title: thread.title,
    interactionMode: thread.interactionMode,
    session,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    latestTurn: thread.latestTurn,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    latestUserMessageAt: thread.latestUserMessageAt,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
  };
  return {
    shell,
    session,
    turnState,
    summary,
  };
}

function toThreadShell(thread: Thread): ThreadShell {
  return {
    id: thread.id,
    environmentId: thread.environmentId,
    codexThreadId: thread.codexThreadId,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    ...(thread.gedWorkflowEnabled !== undefined
      ? { gedWorkflowEnabled: thread.gedWorkflowEnabled }
      : {}),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: thread.error,
    createdAt: thread.createdAt,
    archivedAt: thread.archivedAt,
    updatedAt: thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
  };
}

function toThreadTurnState(thread: Thread): ThreadTurnState {
  return {
    latestTurn: thread.latestTurn,
    ...(thread.pendingSourceProposedPlan
      ? { pendingSourceProposedPlan: thread.pendingSourceProposedPlan }
      : {}),
  };
}

function sourceProposedPlansEqual(
  left: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
  right: OrchestrationLatestTurn["sourceProposedPlan"] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.threadId === right.threadId && left.planId === right.planId;
}

function latestTurnsEqual(
  left: OrchestrationLatestTurn | null | undefined,
  right: OrchestrationLatestTurn | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.turnId === right.turnId &&
    left.state === right.state &&
    left.requestedAt === right.requestedAt &&
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.assistantMessageId === right.assistantMessageId &&
    sourceProposedPlansEqual(left.sourceProposedPlan, right.sourceProposedPlan)
  );
}

function threadSessionsEqual(
  left: ThreadSession | null | undefined,
  right: ThreadSession | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.provider === right.provider &&
    left.status === right.status &&
    left.orchestrationStatus === right.orchestrationStatus &&
    left.activeTurnId === right.activeTurnId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastError === right.lastError
  );
}

function sidebarThreadSummariesEqual(
  left: SidebarThreadSummary | undefined,
  right: SidebarThreadSummary,
): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.interactionMode === right.interactionMode &&
    threadSessionsEqual(left.session, right.session) &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath &&
    left.latestUserMessageAt === right.latestUserMessageAt &&
    left.hasPendingApprovals === right.hasPendingApprovals &&
    left.hasPendingUserInput === right.hasPendingUserInput &&
    left.hasActionableProposedPlan === right.hasActionableProposedPlan
  );
}

function threadShellsEqual(left: ThreadShell | undefined, right: ThreadShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.environmentId === right.environmentId &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    left.modelSelection === right.modelSelection &&
    left.gedWorkflowEnabled === right.gedWorkflowEnabled &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.archivedAt === right.archivedAt &&
    left.updatedAt === right.updatedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath
  );
}

function threadTurnStatesEqual(left: ThreadTurnState | undefined, right: ThreadTurnState): boolean {
  return (
    left !== undefined &&
    latestTurnsEqual(left.latestTurn, right.latestTurn) &&
    sourceProposedPlansEqual(left.pendingSourceProposedPlan, right.pendingSourceProposedPlan)
  );
}

function appendId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

function removeId<T extends string>(ids: readonly T[], id: T): T[] {
  return ids.filter((value) => value !== id);
}

function buildMessageSlice(thread: Thread): {
  ids: MessageId[];
  byId: Record<MessageId, ChatMessage>;
} {
  return {
    ids: thread.messages.map((message) => message.id),
    byId: Object.fromEntries(
      thread.messages.map((message) => [message.id, message] as const),
    ) as Record<MessageId, ChatMessage>,
  };
}

function buildActivitySlice(thread: Thread): {
  ids: string[];
  byId: Record<string, OrchestrationThreadActivity>;
} {
  return {
    ids: thread.activities.map((activity) => activity.id),
    byId: Object.fromEntries(
      thread.activities.map((activity) => [activity.id, activity] as const),
    ) as Record<string, OrchestrationThreadActivity>,
  };
}

function buildProposedPlanSlice(thread: Thread): {
  ids: string[];
  byId: Record<string, ProposedPlan>;
} {
  return {
    ids: thread.proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(
      thread.proposedPlans.map((plan) => [plan.id, plan] as const),
    ) as Record<string, ProposedPlan>,
  };
}

function buildTurnDiffSlice(thread: Thread): {
  ids: TurnId[];
  byId: Record<TurnId, TurnDiffSummary>;
} {
  return {
    ids: thread.turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(
      thread.turnDiffSummaries.map((summary) => [summary.turnId, summary] as const),
    ) as Record<TurnId, TurnDiffSummary>,
  };
}

function getProjects(state: EnvironmentState): Project[] {
  return state.projectIds.flatMap((projectId) => {
    const project = state.projectById[projectId];
    return project ? [project] : [];
  });
}

function getThreads(state: EnvironmentState): Thread[] {
  return state.threadIds.flatMap((threadId) => {
    const thread = getThreadFromEnvironmentState(state, threadId);
    return thread ? [thread] : [];
  });
}

function getTasks(state: EnvironmentState): OrchestratorTask[] {
  return state.taskIds.flatMap((taskId) => {
    const task = state.taskById[taskId];
    return task ? [task] : [];
  });
}

function pendingGatesForTask(state: EnvironmentState, taskId: string): OrchestratorPendingGate[] {
  return (state.pendingGateIdsByTaskId[taskId] ?? EMPTY_GATE_IDS).flatMap((gateId) => {
    const gate = state.pendingGateById[gateId];
    return gate ? [gate] : [];
  });
}

function writeTaskState(state: EnvironmentState, task: OrchestratorTask): EnvironmentState {
  const taskKey = String(task.id);
  const previousTask = state.taskById[taskKey];
  const previousProjectId = previousTask?.projectId;
  let nextState = state;

  if (!state.taskIds.includes(taskKey)) {
    nextState = {
      ...nextState,
      taskIds: [...nextState.taskIds, taskKey],
    };
  }

  if (previousProjectId !== task.projectId) {
    let taskIdsByProjectId = nextState.taskIdsByProjectId;
    if (previousProjectId) {
      const previousIds = taskIdsByProjectId[previousProjectId] ?? EMPTY_TASK_IDS;
      const nextIds = removeId(previousIds, taskKey);
      if (nextIds.length === 0) {
        const { [previousProjectId]: _removed, ...rest } = taskIdsByProjectId;
        taskIdsByProjectId = rest as Record<ProjectId, string[]>;
      } else if (!arraysEqual(previousIds, nextIds)) {
        taskIdsByProjectId = {
          ...taskIdsByProjectId,
          [previousProjectId]: nextIds,
        };
      }
    }
    const projectTaskIds = taskIdsByProjectId[task.projectId] ?? EMPTY_TASK_IDS;
    const nextProjectTaskIds = appendId(projectTaskIds, taskKey);
    if (!arraysEqual(projectTaskIds, nextProjectTaskIds)) {
      taskIdsByProjectId = {
        ...taskIdsByProjectId,
        [task.projectId]: nextProjectTaskIds,
      };
    }
    if (taskIdsByProjectId !== nextState.taskIdsByProjectId) {
      nextState = {
        ...nextState,
        taskIdsByProjectId,
      };
    }
  }

  return {
    ...nextState,
    taskById: {
      ...nextState.taskById,
      [taskKey]: task,
    },
  };
}

function updateTaskState(
  state: EnvironmentState,
  taskId: string,
  update: (task: OrchestratorTask) => OrchestratorTask,
): EnvironmentState {
  const task = state.taskById[taskId];
  if (!task) {
    return state;
  }
  const nextTask = update(task);
  return nextTask === task ? state : writeTaskState(state, nextTask);
}

function setTaskQuotaBlock(
  state: EnvironmentState,
  taskId: string,
  block: TaskQuotaBlock,
): EnvironmentState {
  return {
    ...state,
    quotaBlockedStageByTaskId: {
      ...state.quotaBlockedStageByTaskId,
      [taskId]: block,
    },
  };
}

function clearTaskQuotaBlock(state: EnvironmentState, taskId: string): EnvironmentState {
  if (state.quotaBlockedStageByTaskId[taskId] === undefined) {
    return state;
  }
  const nextQuota = { ...state.quotaBlockedStageByTaskId };
  delete nextQuota[taskId];
  return { ...state, quotaBlockedStageByTaskId: nextQuota };
}

function setProjectPmQuotaBlock(
  state: EnvironmentState,
  projectId: ProjectId,
  block: ProjectPmQuotaBlock,
): EnvironmentState {
  return {
    ...state,
    pmQuotaBlockByProjectId: {
      ...state.pmQuotaBlockByProjectId,
      [projectId]: block,
    },
  };
}

function clearProjectPmQuotaBlock(state: EnvironmentState, projectId: ProjectId): EnvironmentState {
  if (state.pmQuotaBlockByProjectId[projectId] === undefined) {
    return state;
  }
  const nextQuota = { ...state.pmQuotaBlockByProjectId };
  delete nextQuota[projectId];
  return { ...state, pmQuotaBlockByProjectId: nextQuota };
}

function isPmThreadForProject(thread: Pick<Thread, "id" | "projectId">): boolean {
  return String(thread.id) === `pm:${thread.projectId}`;
}

function pmQuotaBlockFromActivity(
  activity: OrchestrationThreadActivity,
): ProjectPmQuotaBlock | null {
  if (activity.kind !== "quota.paused") {
    return null;
  }
  const payload = activity.payload;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const providerInstanceId = (payload as { providerInstanceId?: unknown }).providerInstanceId;
  const resetAt = (payload as { resetAt?: unknown }).resetAt;
  if (typeof providerInstanceId !== "string") {
    return null;
  }
  if (resetAt !== null && resetAt !== undefined && typeof resetAt !== "string") {
    return null;
  }
  const normalizedResetAt = typeof resetAt === "string" ? resetAt : null;
  return {
    providerInstanceId: ProviderInstanceId.make(providerInstanceId),
    status: normalizedResetAt === null ? "blocked-unknown" : "blocked-until",
    resetAt: normalizedResetAt,
  };
}

function writePendingGateState(
  state: EnvironmentState,
  pendingGate: OrchestratorPendingGate,
): EnvironmentState {
  const gateKey = String(pendingGate.gateId);
  const taskKey = String(pendingGate.taskId);
  const taskGateIds = state.pendingGateIdsByTaskId[taskKey] ?? EMPTY_GATE_IDS;
  const nextTaskGateIds = appendId(taskGateIds, gateKey);
  return {
    ...state,
    pendingGateById: {
      ...state.pendingGateById,
      [gateKey]: pendingGate,
    },
    pendingGateIdsByTaskId: arraysEqual(taskGateIds, nextTaskGateIds)
      ? state.pendingGateIdsByTaskId
      : {
          ...state.pendingGateIdsByTaskId,
          [taskKey]: nextTaskGateIds,
        },
  };
}

function removePendingGateState(state: EnvironmentState, gateKey: string): EnvironmentState {
  const gate = state.pendingGateById[gateKey];
  if (gate === undefined) {
    return state;
  }

  const taskKey = String(gate.taskId);
  const taskGateIds = state.pendingGateIdsByTaskId[taskKey] ?? EMPTY_GATE_IDS;
  const nextTaskGateIds = removeId(taskGateIds, gateKey);
  const { [gateKey]: _removedGate, ...pendingGateById } = state.pendingGateById;
  const pendingGateIdsByTaskId =
    nextTaskGateIds.length === 0
      ? (() => {
          const { [taskKey]: _removedTaskGates, ...rest } = state.pendingGateIdsByTaskId;
          return rest;
        })()
      : {
          ...state.pendingGateIdsByTaskId,
          [taskKey]: nextTaskGateIds,
        };

  return {
    ...state,
    pendingGateById,
    pendingGateIdsByTaskId,
  };
}

function removeTaskState(state: EnvironmentState, taskKey: string): EnvironmentState {
  const task = state.taskById[taskKey];
  if (task === undefined) {
    return state;
  }

  const nextTaskIds = removeId(state.taskIds, taskKey);
  const projectTaskIds = state.taskIdsByProjectId[task.projectId] ?? EMPTY_TASK_IDS;
  const nextProjectTaskIds = removeId(projectTaskIds, taskKey);
  const taskIdsByProjectId =
    nextProjectTaskIds.length === 0
      ? (() => {
          const { [task.projectId]: _removedProjectTasks, ...rest } = state.taskIdsByProjectId;
          return rest as Record<ProjectId, string[]>;
        })()
      : {
          ...state.taskIdsByProjectId,
          [task.projectId]: nextProjectTaskIds,
        };
  const { [taskKey]: _removedTask, ...taskById } = state.taskById;
  const { [taskKey]: _removedTaskGateIds, ...pendingGateIdsByTaskId } =
    state.pendingGateIdsByTaskId;

  let pendingGateById = state.pendingGateById;
  for (const gateKey of state.pendingGateIdsByTaskId[taskKey] ?? EMPTY_GATE_IDS) {
    const { [gateKey]: _removedGate, ...rest } = pendingGateById;
    pendingGateById = rest;
  }

  return {
    ...state,
    taskIds: nextTaskIds,
    taskIdsByProjectId,
    taskById,
    pendingGateIdsByTaskId,
    pendingGateById,
  };
}

function retainTaskSnapshotGateState(
  state: EnvironmentState,
  taskKey: string,
  snapshotGateIds: ReadonlySet<string>,
): EnvironmentState {
  let nextState = state;
  for (const gateKey of state.pendingGateIdsByTaskId[taskKey] ?? EMPTY_GATE_IDS) {
    if (!snapshotGateIds.has(gateKey)) {
      nextState = removePendingGateState(nextState, gateKey);
    }
  }
  return nextState;
}

function retainProjectSnapshotTaskState(params: {
  readonly state: EnvironmentState;
  readonly projectId: ProjectId;
  readonly snapshotTaskIds: ReadonlySet<string>;
  readonly snapshotGateIds: ReadonlySet<string>;
}): EnvironmentState {
  let nextState = params.state;

  for (const taskKey of params.state.taskIdsByProjectId[params.projectId] ?? EMPTY_TASK_IDS) {
    if (!params.snapshotTaskIds.has(taskKey)) {
      nextState = removeTaskState(nextState, taskKey);
    }
  }

  for (const taskKey of params.snapshotTaskIds) {
    nextState = retainTaskSnapshotGateState(nextState, taskKey, params.snapshotGateIds);
  }

  return nextState;
}

/**
 * Ensure a thread is registered in the bookkeeping indices (threadIds,
 * threadIdsByProjectId).  Shared by both the shell stream and detail stream
 * write paths — the bookkeeping is additive (append-only IDs) so concurrent
 * writes from both streams are safe.
 */
function ensureThreadRegistered(
  state: EnvironmentState,
  threadId: ThreadId,
  nextProjectId: ProjectId,
  previousProjectId: ProjectId | undefined,
): EnvironmentState {
  let nextState = state;

  if (!state.threadIds.includes(threadId)) {
    nextState = {
      ...nextState,
      threadIds: [...nextState.threadIds, threadId],
    };
  }

  if (previousProjectId !== nextProjectId) {
    let threadIdsByProjectId = nextState.threadIdsByProjectId;
    if (previousProjectId) {
      const previousIds = threadIdsByProjectId[previousProjectId] ?? EMPTY_THREAD_IDS;
      const nextIds = removeId(previousIds, threadId);
      if (nextIds.length === 0) {
        const { [previousProjectId]: _removed, ...rest } = threadIdsByProjectId;
        threadIdsByProjectId = rest as Record<ProjectId, ThreadId[]>;
      } else if (!arraysEqual(previousIds, nextIds)) {
        threadIdsByProjectId = {
          ...threadIdsByProjectId,
          [previousProjectId]: nextIds,
        };
      }
    }
    const projectThreadIds = threadIdsByProjectId[nextProjectId] ?? EMPTY_THREAD_IDS;
    const nextProjectThreadIds = appendId(projectThreadIds, threadId);
    if (!arraysEqual(projectThreadIds, nextProjectThreadIds)) {
      threadIdsByProjectId = {
        ...threadIdsByProjectId,
        [nextProjectId]: nextProjectThreadIds,
      };
    }
    if (threadIdsByProjectId !== nextState.threadIdsByProjectId) {
      nextState = {
        ...nextState,
        threadIdsByProjectId,
      };
    }
  }

  return nextState;
}

/**
 * Write thread state from the **detail stream** (per-thread subscription).
 *
 * Owns: messages, activities, proposed plans, turn diff summaries.
 * Also writes threadShellById / threadSessionById / threadTurnStateById so
 * the active thread has up-to-date state even if the shell stream event
 * hasn't arrived yet (both streams use structural equality checks to avoid
 * unnecessary re-renders when delivering equivalent data).
 * Does NOT write sidebarThreadSummaryById — that is shell-stream-only.
 */
function writeThreadState(
  state: EnvironmentState,
  nextThread: Thread,
  previousThread?: Thread,
  hints?: SliceHints,
): EnvironmentState {
  const nextShell = toThreadShell(nextThread);
  const nextTurnState = toThreadTurnState(nextThread);
  const previousShell = state.threadShellById[nextThread.id];
  const previousTurnState = state.threadTurnStateById[nextThread.id];

  let nextState = ensureThreadRegistered(
    state,
    nextThread.id,
    nextThread.projectId,
    previousThread?.projectId,
  );

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.id]: nextShell,
      },
    };
  }

  if (!threadSessionsEqual(previousThread?.session ?? null, nextThread.session)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.id]: nextThread.session,
      },
    };
  }

  if (!threadTurnStatesEqual(previousTurnState, nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.id]: nextTurnState,
      },
    };
  }

  if (previousThread?.messages !== nextThread.messages) {
    const prevById = state.messageByThreadId[nextThread.id];
    const prevIds = state.messageIdsByThreadId[nextThread.id];
    const isExistingMessage =
      hints?.changedMessage !== undefined && prevById?.[hints.changedMessage.id] !== undefined;
    if (
      hints?.changedMessage !== undefined &&
      prevById !== undefined &&
      prevIds !== undefined &&
      // Safe to update incrementally only when updating an existing message
      // OR when the previous count was below the cap (no front-truncation can occur)
      (isExistingMessage || prevIds.length < MAX_THREAD_MESSAGES)
    ) {
      const changedMessage = hints.changedMessage;
      // Incremental update: O(1) byId update; ids only grows by 1 or stays same length
      const nextById: Record<MessageId, ChatMessage> = {
        ...prevById,
        [changedMessage.id]: changedMessage,
      };
      const nextIds = isExistingMessage
        ? prevIds
        : ([...prevIds, changedMessage.id] as MessageId[]);
      nextState = {
        ...nextState,
        messageIdsByThreadId: {
          ...nextState.messageIdsByThreadId,
          [nextThread.id]: nextIds,
        },
        messageByThreadId: {
          ...nextState.messageByThreadId,
          [nextThread.id]: nextById,
        },
      };
    } else {
      const nextMessageSlice = buildMessageSlice(nextThread);
      nextState = {
        ...nextState,
        messageIdsByThreadId: {
          ...nextState.messageIdsByThreadId,
          [nextThread.id]: nextMessageSlice.ids,
        },
        messageByThreadId: {
          ...nextState.messageByThreadId,
          [nextThread.id]: nextMessageSlice.byId,
        },
      };
    }
  }

  if (previousThread?.activities !== nextThread.activities) {
    const changedActivity = hints?.changedActivity;
    const prevActivityById = state.activityByThreadId[nextThread.id];
    const prevActivityIds = state.activityIdsByThreadId[nextThread.id];
    const isExistingActivity =
      changedActivity !== undefined && prevActivityById?.[changedActivity.id] !== undefined;
    if (
      changedActivity !== undefined &&
      prevActivityById !== undefined &&
      prevActivityIds !== undefined &&
      // Safe to update incrementally only when updating an existing activity
      // OR when the previous count was below the cap (no front-truncation can occur).
      // At the cap a tail-append would diverge from the canonical (already-capped)
      // thread.activities, leaving a stale byId entry — fall back to a full rebuild.
      (isExistingActivity || prevActivityIds.length < MAX_THREAD_ACTIVITIES)
    ) {
      const nextActivityById: Record<string, OrchestrationThreadActivity> = {
        ...prevActivityById,
        [changedActivity.id]: changedActivity,
      };
      const nextActivityIds = isExistingActivity
        ? prevActivityIds
        : ([...prevActivityIds, changedActivity.id] as string[]);
      nextState = {
        ...nextState,
        activityIdsByThreadId: {
          ...nextState.activityIdsByThreadId,
          [nextThread.id]: nextActivityIds,
        },
        activityByThreadId: {
          ...nextState.activityByThreadId,
          [nextThread.id]: nextActivityById,
        },
      };
    } else {
      const nextActivitySlice = buildActivitySlice(nextThread);
      nextState = {
        ...nextState,
        activityIdsByThreadId: {
          ...nextState.activityIdsByThreadId,
          [nextThread.id]: nextActivitySlice.ids,
        },
        activityByThreadId: {
          ...nextState.activityByThreadId,
          [nextThread.id]: nextActivitySlice.byId,
        },
      };
    }
  }

  if (previousThread?.proposedPlans !== nextThread.proposedPlans) {
    const nextProposedPlanSlice = buildProposedPlanSlice(nextThread);
    nextState = {
      ...nextState,
      proposedPlanIdsByThreadId: {
        ...nextState.proposedPlanIdsByThreadId,
        [nextThread.id]: nextProposedPlanSlice.ids,
      },
      proposedPlanByThreadId: {
        ...nextState.proposedPlanByThreadId,
        [nextThread.id]: nextProposedPlanSlice.byId,
      },
    };
  }

  if (previousThread?.turnDiffSummaries !== nextThread.turnDiffSummaries) {
    const nextTurnDiffSlice = buildTurnDiffSlice(nextThread);
    nextState = {
      ...nextState,
      turnDiffIdsByThreadId: {
        ...nextState.turnDiffIdsByThreadId,
        [nextThread.id]: nextTurnDiffSlice.ids,
      },
      turnDiffSummaryByThreadId: {
        ...nextState.turnDiffSummaryByThreadId,
        [nextThread.id]: nextTurnDiffSlice.byId,
      },
    };
  }

  return nextState;
}

/**
 * Write thread state from the **shell stream** (all-threads subscription).
 *
 * Owns: sidebarThreadSummaryById (pre-computed server-side sidebar data).
 * Also writes threadShellById / threadSessionById / threadTurnStateById as
 * the authoritative source for these fields.  The detail stream may also
 * write them for the focused thread (see writeThreadState); structural
 * equality checks prevent unnecessary re-renders.
 * Does NOT write message/activity/proposedPlan/turnDiff content — that is
 * detail-stream-only.
 */
function writeThreadShellState(
  state: EnvironmentState,
  nextThread: {
    shell: ThreadShell;
    session: ThreadSession | null;
    turnState: ThreadTurnState;
    summary: SidebarThreadSummary;
  },
): EnvironmentState {
  const previousShell = state.threadShellById[nextThread.shell.id];

  let nextState = ensureThreadRegistered(
    state,
    nextThread.shell.id,
    nextThread.shell.projectId,
    previousShell?.projectId,
  );

  if (!threadShellsEqual(previousShell, nextThread.shell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [nextThread.shell.id]: nextThread.shell,
      },
    };
  }

  if (
    !threadSessionsEqual(state.threadSessionById[nextThread.shell.id] ?? null, nextThread.session)
  ) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [nextThread.shell.id]: nextThread.session,
      },
    };
  }

  if (
    !threadTurnStatesEqual(state.threadTurnStateById[nextThread.shell.id], nextThread.turnState)
  ) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [nextThread.shell.id]: nextThread.turnState,
      },
    };
  }

  if (
    !sidebarThreadSummariesEqual(
      state.sidebarThreadSummaryById[nextThread.shell.id],
      nextThread.summary,
    )
  ) {
    nextState = {
      ...nextState,
      sidebarThreadSummaryById: {
        ...nextState.sidebarThreadSummaryById,
        [nextThread.shell.id]: nextThread.summary,
      },
    };
  }

  return nextState;
}

function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T>,
  nextThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([threadId, value]) =>
      nextThreadIds.has(threadId as ThreadId) ? [[threadId, value] as const] : [],
    ),
  ) as Record<ThreadId, T>;
}

function retainProjectScopedRecord<T>(
  record: Record<string, T>,
  nextProjectIds: ReadonlySet<ProjectId>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).flatMap(([projectId, value]) =>
      nextProjectIds.has(projectId as ProjectId) ? [[projectId, value] as const] : [],
    ),
  );
}

function removeThreadState(state: EnvironmentState, threadId: ThreadId): EnvironmentState {
  const shell = state.threadShellById[threadId];
  if (!shell) {
    return state;
  }

  const nextThreadIds = removeId(state.threadIds, threadId);
  const currentProjectThreadIds = state.threadIdsByProjectId[shell.projectId] ?? EMPTY_THREAD_IDS;
  const nextProjectThreadIds = removeId(currentProjectThreadIds, threadId);
  const nextThreadIdsByProjectId =
    nextProjectThreadIds.length === 0
      ? (() => {
          const { [shell.projectId]: _removed, ...rest } = state.threadIdsByProjectId;
          return rest as Record<ProjectId, ThreadId[]>;
        })()
      : {
          ...state.threadIdsByProjectId,
          [shell.projectId]: nextProjectThreadIds,
        };

  const { [threadId]: _removedShell, ...threadShellById } = state.threadShellById;
  const { [threadId]: _removedSession, ...threadSessionById } = state.threadSessionById;
  const { [threadId]: _removedTurnState, ...threadTurnStateById } = state.threadTurnStateById;
  const { [threadId]: _removedMessageIds, ...messageIdsByThreadId } = state.messageIdsByThreadId;
  const { [threadId]: _removedMessages, ...messageByThreadId } = state.messageByThreadId;
  const { [threadId]: _removedActivityIds, ...activityIdsByThreadId } = state.activityIdsByThreadId;
  const { [threadId]: _removedActivities, ...activityByThreadId } = state.activityByThreadId;
  const { [threadId]: _removedPlanIds, ...proposedPlanIdsByThreadId } =
    state.proposedPlanIdsByThreadId;
  const { [threadId]: _removedPlans, ...proposedPlanByThreadId } = state.proposedPlanByThreadId;
  const { [threadId]: _removedTurnDiffIds, ...turnDiffIdsByThreadId } = state.turnDiffIdsByThreadId;
  const { [threadId]: _removedTurnDiffs, ...turnDiffSummaryByThreadId } =
    state.turnDiffSummaryByThreadId;
  const { [threadId]: _removedSidebarSummary, ...sidebarThreadSummaryById } =
    state.sidebarThreadSummaryById;

  return {
    ...state,
    threadIds: nextThreadIds,
    threadIdsByProjectId: nextThreadIdsByProjectId,
    threadShellById,
    threadSessionById,
    threadTurnStateById,
    messageIdsByThreadId,
    messageByThreadId,
    activityIdsByThreadId,
    activityByThreadId,
    proposedPlanIdsByThreadId,
    proposedPlanByThreadId,
    turnDiffIdsByThreadId,
    turnDiffSummaryByThreadId,
    sidebarThreadSummaryById,
  };
}

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") {
    return "error" as const;
  }
  if (status === "missing") {
    return "interrupted" as const;
  }
  return "completed" as const;
}

function settledTurnStateForSessionStatus(
  status: OrchestrationSessionStatus,
): "completed" | "interrupted" | "error" | null {
  switch (status) {
    case "idle":
    case "ready":
      return "completed";
    case "error":
      return "error";
    case "interrupted":
    case "stopped":
      return "interrupted";
    case "starting":
    case "running":
      return null;
  }
}

function compareActivities(
  left: Thread["activities"][number],
  right: Thread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function buildLatestTurn(params: {
  previous: Thread["latestTurn"];
  turnId: NonNullable<Thread["latestTurn"]>["turnId"];
  state: NonNullable<Thread["latestTurn"]>["state"];
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"];
  sourceProposedPlan?: Thread["pendingSourceProposedPlan"];
}): NonNullable<Thread["latestTurn"]> {
  const resolvedPlan =
    params.previous?.turnId === params.turnId
      ? params.previous.sourceProposedPlan
      : params.sourceProposedPlan;
  return {
    turnId: params.turnId,
    state: params.state,
    requestedAt: params.requestedAt,
    startedAt: params.startedAt,
    completedAt: params.completedAt,
    assistantMessageId: params.assistantMessageId,
    ...(resolvedPlan ? { sourceProposedPlan: resolvedPlan } : {}),
  };
}

function rebindTurnDiffSummariesForAssistantMessage(
  turnDiffSummaries: ReadonlyArray<TurnDiffSummary>,
  turnId: TurnId,
  assistantMessageId: NonNullable<Thread["latestTurn"]>["assistantMessageId"],
): TurnDiffSummary[] {
  let changed = false;
  const nextSummaries = turnDiffSummaries.map((summary) => {
    if (summary.turnId !== turnId || summary.assistantMessageId === assistantMessageId) {
      return summary;
    }
    changed = true;
    return {
      ...summary,
      assistantMessageId: assistantMessageId ?? undefined,
    };
  });
  return changed ? nextSummaries : [...turnDiffSummaries];
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<ChatMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ChatMessage[] {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (
      message.turnId !== undefined &&
      message.turnId !== null &&
      retainedTurnIds.has(message.turnId)
    ) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === undefined ||
            message.turnId === null ||
            retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  retainedTurnIds: ReadonlySet<string>,
): OrchestrationThreadActivity[] {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<ProposedPlan>,
  retainedTurnIds: ReadonlySet<string>,
): ProposedPlan[] {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderDriverKind {
  if (isProviderDriverKindValue(providerName)) {
    return providerName;
  }
  return ProviderDriverKind.make("codex");
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

type SliceHints = {
  readonly changedMessage?: ChatMessage | undefined;
  readonly changedActivity?: OrchestrationThreadActivity | undefined;
};

function updateThreadState(
  state: EnvironmentState,
  threadId: ThreadId,
  updater: (thread: Thread) => Thread,
): EnvironmentState {
  const currentThread = getThreadFromEnvironmentState(state, threadId);
  if (!currentThread) {
    return state;
  }
  const nextThread = updater(currentThread);
  if (nextThread === currentThread) {
    return state;
  }
  return writeThreadState(state, nextThread, currentThread);
}

function updateThreadStateWithHints(
  state: EnvironmentState,
  threadId: ThreadId,
  updater: (thread: Thread) => { thread: Thread; hints: SliceHints },
): EnvironmentState {
  const currentThread = getThreadFromEnvironmentState(state, threadId);
  if (!currentThread) {
    return state;
  }
  const { thread: nextThread, hints } = updater(currentThread);
  if (nextThread === currentThread) {
    return state;
  }
  return writeThreadState(state, nextThread, currentThread, hints);
}

function buildProjectState(
  projects: ReadonlyArray<Project>,
): Pick<EnvironmentState, "projectIds" | "projectById"> {
  return {
    projectIds: projects.map((project) => project.id),
    projectById: Object.fromEntries(
      projects.map((project) => [project.id, project] as const),
    ) as Record<ProjectId, Project>,
  };
}

function writeProjectState(state: EnvironmentState, project: Project): EnvironmentState {
  return {
    ...state,
    projectIds: state.projectIds.includes(project.id)
      ? state.projectIds
      : [...state.projectIds, project.id],
    projectById: {
      ...state.projectById,
      [project.id]: project,
    },
  };
}

function getStoredEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
): EnvironmentState {
  return state.environmentStateById[environmentId] ?? initialEnvironmentState;
}

function commitEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId,
  nextEnvironmentState: EnvironmentState,
): AppState {
  const currentEnvironmentState = state.environmentStateById[environmentId];
  const environmentStateById =
    currentEnvironmentState === nextEnvironmentState
      ? state.environmentStateById
      : {
          ...state.environmentStateById,
          [environmentId]: nextEnvironmentState,
        };

  if (environmentStateById === state.environmentStateById) {
    return state;
  }

  return {
    ...state,
    environmentStateById,
  };
}

function syncEnvironmentShellSnapshot(
  state: EnvironmentState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): EnvironmentState {
  const nextProjects = snapshot.projects.map((project) => mapProject(project, environmentId));
  const nextProjectIds = new Set(nextProjects.map((project) => project.id));
  const nextThreadIds = new Set(snapshot.threads.map((thread) => thread.id));
  let nextState: EnvironmentState = {
    ...state,
    ...buildProjectState(nextProjects),
    pmQuotaBlockByProjectId: retainProjectScopedRecord(
      state.pmQuotaBlockByProjectId,
      nextProjectIds,
    ),
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    sidebarThreadSummaryById: {},
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, nextThreadIds),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, nextThreadIds),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, nextThreadIds),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, nextThreadIds),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      nextThreadIds,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, nextThreadIds),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, nextThreadIds),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      nextThreadIds,
    ),
    bootstrapComplete: true,
  };

  for (const thread of snapshot.threads) {
    nextState = writeThreadShellState(nextState, mapThreadShell(thread, environmentId));
  }

  return nextState;
}

export function syncServerShellSnapshot(
  state: AppState,
  snapshot: OrchestrationShellSnapshot,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    syncEnvironmentShellSnapshot(
      getStoredEnvironmentState(state, environmentId),
      snapshot,
      environmentId,
    ),
  );
}

export function syncServerThreadDetail(
  state: AppState,
  thread: OrchestrationThread,
  environmentId: EnvironmentId,
): AppState {
  const environmentState = getStoredEnvironmentState(state, environmentId);
  const previousThread = getThreadFromEnvironmentState(environmentState, thread.id);
  return commitEnvironmentState(
    state,
    environmentId,
    writeThreadState(environmentState, mapThread(thread, environmentId), previousThread),
  );
}

export function syncOrchestratorProjectSnapshot(
  state: AppState,
  snapshot: OrchestratorProjectDetailSnapshot,
  environmentId: EnvironmentId,
): AppState {
  const snapshotTaskIds = new Set(snapshot.tasks.map((task) => String(task.id)));
  const snapshotGateIds = new Set(
    snapshot.pendingGates.map((pendingGate) => String(pendingGate.gateId)),
  );
  let nextEnvironmentState = writeProjectState(
    getStoredEnvironmentState(state, environmentId),
    mapProject(snapshot.project, environmentId),
  );
  nextEnvironmentState =
    snapshot.pmQuotaBlock === null
      ? clearProjectPmQuotaBlock(nextEnvironmentState, snapshot.project.id)
      : setProjectPmQuotaBlock(nextEnvironmentState, snapshot.project.id, snapshot.pmQuotaBlock);

  if (snapshot.pmThread !== null) {
    const previousThread = getThreadFromEnvironmentState(
      nextEnvironmentState,
      snapshot.pmThread.id,
    );
    nextEnvironmentState = writeThreadState(
      nextEnvironmentState,
      mapThread(snapshot.pmThread, environmentId),
      previousThread,
    );
  }

  for (const task of snapshot.tasks) {
    nextEnvironmentState = writeTaskState(
      nextEnvironmentState,
      mapOrchestratorTask(task, environmentId),
    );
  }

  for (const pendingGate of snapshot.pendingGates) {
    nextEnvironmentState = writePendingGateState(
      nextEnvironmentState,
      mapOrchestratorPendingGate(pendingGate, environmentId),
    );
  }

  // Reset this project's quota-block index to match the snapshot (authoritative
  // at subscribe time), then re-seed the actively blocked stages.
  for (const taskId of snapshotTaskIds) {
    nextEnvironmentState = clearTaskQuotaBlock(nextEnvironmentState, taskId);
  }
  for (const stage of snapshot.quotaBlockedStages) {
    if (stage.status !== "blocked") {
      continue;
    }
    nextEnvironmentState = setTaskQuotaBlock(nextEnvironmentState, String(stage.taskId), {
      resetAt: stage.resetAt,
      providerInstanceId: stage.providerInstanceId,
      stageThreadId: stage.stageThreadId,
    });
  }

  nextEnvironmentState = retainProjectSnapshotTaskState({
    state: nextEnvironmentState,
    projectId: snapshot.project.id,
    snapshotTaskIds,
    snapshotGateIds,
  });

  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

export function syncOrchestratorTaskSnapshot(
  state: AppState,
  snapshot: OrchestratorTaskDetailSnapshot,
  environmentId: EnvironmentId,
): AppState {
  const snapshotGateIds = new Set(
    snapshot.pendingGates.map((pendingGate) => String(pendingGate.gateId)),
  );
  let nextEnvironmentState = writeTaskState(
    getStoredEnvironmentState(state, environmentId),
    mapOrchestratorTask(snapshot.task, environmentId),
  );

  for (const pendingGate of snapshot.pendingGates) {
    nextEnvironmentState = writePendingGateState(
      nextEnvironmentState,
      mapOrchestratorPendingGate(pendingGate, environmentId),
    );
  }

  nextEnvironmentState = retainTaskSnapshotGateState(
    nextEnvironmentState,
    String(snapshot.task.id),
    snapshotGateIds,
  );

  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

function applyEnvironmentOrchestrationEvent(
  state: EnvironmentState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.type) {
    case "project.created": {
      const nextProject = mapProject(
        {
          id: event.payload.projectId,
          title: event.payload.title,
          workspaceRoot: event.payload.workspaceRoot,
          repositoryIdentity: event.payload.repositoryIdentity ?? null,
          defaultModelSelection: event.payload.defaultModelSelection,
          roleModelSelections: event.payload.roleModelSelections ?? {},
          rolePromptPrefixes: event.payload.rolePromptPrefixes ?? {},
          scripts: event.payload.scripts,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          deletedAt: null,
        },
        environmentId,
      );
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.payload.projectId ||
            state.projectById[projectId]?.cwd === event.payload.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }

    case "project.meta-updated": {
      const project = state.projectById[event.payload.projectId];
      if (!project) {
        return state;
      }
      const nextProject: Project = {
        ...project,
        ...(event.payload.title !== undefined ? { name: event.payload.title } : {}),
        ...(event.payload.workspaceRoot !== undefined ? { cwd: event.payload.workspaceRoot } : {}),
        ...(event.payload.repositoryIdentity !== undefined
          ? { repositoryIdentity: event.payload.repositoryIdentity ?? null }
          : {}),
        ...(event.payload.defaultModelSelection !== undefined
          ? {
              defaultModelSelection: event.payload.defaultModelSelection
                ? normalizeModelSelection(event.payload.defaultModelSelection)
                : null,
            }
          : {}),
        ...(event.payload.roleModelSelections !== undefined
          ? {
              roleModelSelections: Object.fromEntries(
                Object.entries(event.payload.roleModelSelections).map(([role, selection]) => [
                  role,
                  normalizeModelSelection(selection),
                ]),
              ),
            }
          : {}),
        ...(event.payload.rolePromptPrefixes !== undefined
          ? { rolePromptPrefixes: { ...event.payload.rolePromptPrefixes } }
          : {}),
        ...(event.payload.scripts !== undefined
          ? { scripts: mapProjectScripts(event.payload.scripts) }
          : {}),
        updatedAt: event.payload.updatedAt,
      };
      return {
        ...state,
        projectById: {
          ...state.projectById,
          [event.payload.projectId]: nextProject,
        },
      };
    }

    case "project.deleted": {
      if (!state.projectById[event.payload.projectId]) {
        return state;
      }
      let nextState = state;
      for (const taskKey of state.taskIdsByProjectId[event.payload.projectId] ?? EMPTY_TASK_IDS) {
        nextState = removeTaskState(nextState, taskKey);
      }
      const { [event.payload.projectId]: _removedProject, ...projectById } = state.projectById;
      const { [event.payload.projectId]: _removedPmQuotaBlock, ...pmQuotaBlockByProjectId } =
        nextState.pmQuotaBlockByProjectId;
      return {
        ...nextState,
        projectById,
        pmQuotaBlockByProjectId,
        projectIds: removeId(nextState.projectIds, event.payload.projectId),
      };
    }

    case "task.created":
      return writeTaskState(
        state,
        mapOrchestratorTask(
          {
            id: event.payload.taskId,
            projectId: event.payload.projectId,
            type: event.payload.taskType,
            title: event.payload.title,
            status: "draft",
            branch: event.payload.branch,
            worktreePath: event.payload.worktreePath,
            pmMessageId: event.payload.pmMessageId,
            stageThreadIds: [],
            currentStageThreadId: null,
            roleModelSelections: {},
            playbookVersion: event.payload.playbookVersion,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          },
          environmentId,
        ),
      );

    case "task.classified":
      return updateTaskState(state, String(event.payload.taskId), (task) => ({
        ...task,
        type: event.payload.taskType,
        status: "classified",
        playbookVersion: event.payload.playbookVersion,
        updatedAt: event.payload.updatedAt,
      }));

    case "task.role-selections-updated":
      return updateTaskState(state, String(event.payload.taskId), (task) => ({
        ...task,
        roleModelSelections: Object.fromEntries(
          Object.entries(event.payload.roleModelSelections).map(([role, selection]) => [
            role,
            normalizeModelSelection(selection),
          ]),
        ),
        updatedAt: event.payload.updatedAt,
      }));

    case "task.stage-started": {
      const taskId = String(event.payload.taskId);
      const nextState = updateTaskState(state, taskId, (task) => {
        const status =
          event.payload.role === "plan"
            ? ("planning" as const)
            : event.payload.role === "review"
              ? ("reviewing" as const)
              : event.payload.role === "work"
                ? ("working" as const)
                : event.payload.role === "verify"
                  ? ("verifying" as const)
                  : ("classified" as const);
        return {
          ...task,
          status,
          stageThreadIds: task.stageThreadIds.includes(event.payload.stageThreadId)
            ? task.stageThreadIds
            : [...task.stageThreadIds, event.payload.stageThreadId],
          currentStageThreadId: event.payload.stageThreadId,
          updatedAt: event.payload.updatedAt,
        };
      });
      // A (re)started stage means the task is no longer parked on quota.
      return clearTaskQuotaBlock(nextState, taskId);
    }

    case "task.stage-completed":
      return updateTaskState(state, String(event.payload.taskId), (task) => ({
        ...task,
        ...(event.payload.role === "work" ? { status: "review" as const } : {}),
        currentStageThreadId: null,
        updatedAt: event.payload.updatedAt,
      }));

    case "task.stage-blocked": {
      const taskId = String(event.payload.taskId);
      const withTask = updateTaskState(state, taskId, (task) => ({
        ...task,
        status: "blocked-on-quota" as const,
        currentStageThreadId: null,
        updatedAt: event.payload.updatedAt,
      }));
      return setTaskQuotaBlock(withTask, taskId, {
        resetAt: event.payload.resetAt ?? null,
        providerInstanceId: event.payload.providerInstanceId,
        stageThreadId: event.payload.stageThreadId,
      });
    }

    case "task.gate-requested": {
      const existingGate = state.pendingGateById[String(event.payload.gateId)];
      const pendingGate = mapOrchestratorPendingGate(
        {
          gateId: event.payload.gateId,
          taskId: event.payload.taskId,
          gate: event.payload.gate,
          contentHash: event.payload.contentHash,
          stageThreadId: event.payload.stageThreadId,
          status: existingGate?.status ?? "pending",
          approvedHash: existingGate?.approvedHash ?? null,
          decision: existingGate?.decision ?? null,
          origin: existingGate?.origin ?? null,
          requestedAt: existingGate?.requestedAt ?? event.payload.updatedAt,
          resolvedAt: existingGate?.resolvedAt ?? null,
        },
        environmentId,
      );
      const withGate = writePendingGateState(state, pendingGate);
      return updateTaskState(withGate, String(event.payload.taskId), (task) => ({
        ...task,
        ...(existingGate?.status === "resolved"
          ? {}
          : event.payload.gate === "plan"
            ? { status: "plan-review" as const }
            : event.payload.gate === "land"
              ? { status: "review" as const }
              : {}),
        updatedAt: event.payload.updatedAt,
      }));
    }

    case "task.gate-resolved": {
      const nextStatus =
        event.payload.gate === "plan"
          ? event.payload.decision === "approved"
            ? ("planning" as const)
            : ("blocked" as const)
          : event.payload.gate === "land" && event.payload.decision === "rejected"
            ? ("blocked" as const)
            : null;
      let nextState = updateTaskState(state, String(event.payload.taskId), (task) => ({
        ...task,
        ...(nextStatus !== null ? { status: nextStatus } : {}),
        updatedAt: event.payload.updatedAt,
      }));
      const gateKey = String(event.payload.gateId);
      const existingGate = nextState.pendingGateById[gateKey];
      if (existingGate !== undefined) {
        nextState = writePendingGateState(nextState, {
          ...existingGate,
          status: "resolved",
          approvedHash: event.payload.approvedHash,
          decision: event.payload.decision,
          origin: event.payload.origin,
          resolvedAt: event.payload.updatedAt,
        });
      }
      return nextState;
    }

    case "task.landed":
      return updateTaskState(state, String(event.payload.taskId), (task) => ({
        ...task,
        status: "landed",
        updatedAt: event.payload.updatedAt,
      }));

    case "task.abandoned":
      return updateTaskState(state, String(event.payload.taskId), (task) => ({
        ...task,
        status: "abandoned",
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.created": {
      const previousThread = getThreadFromEnvironmentState(state, event.payload.threadId);
      const nextThread = mapThread(
        {
          id: event.payload.threadId,
          projectId: event.payload.projectId,
          title: event.payload.title,
          modelSelection: event.payload.modelSelection,
          ...(event.payload.gedWorkflowEnabled !== undefined
            ? { gedWorkflowEnabled: event.payload.gedWorkflowEnabled }
            : {}),
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          branch: event.payload.branch,
          worktreePath: event.payload.worktreePath,
          latestTurn: null,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
          archivedAt: null,
          deletedAt: null,
          messages: [],
          proposedPlans: [],
          activities: [],
          checkpoints: [],
          session: null,
        },
        environmentId,
      );
      return writeThreadState(state, nextThread, previousThread);
    }

    case "thread.deleted":
      return removeThreadState(state, event.payload.threadId);

    case "thread.archived":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: event.payload.archivedAt,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.unarchived":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        archivedAt: null,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.meta-updated":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.title !== undefined ? { title: event.payload.title } : {}),
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        ...(event.payload.gedWorkflowEnabled !== undefined
          ? { gedWorkflowEnabled: event.payload.gedWorkflowEnabled }
          : {}),
        ...(event.payload.branch !== undefined ? { branch: event.payload.branch } : {}),
        ...(event.payload.worktreePath !== undefined
          ? { worktreePath: event.payload.worktreePath }
          : {}),
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.runtime-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        runtimeMode: event.payload.runtimeMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.interaction-mode-set":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        interactionMode: event.payload.interactionMode,
        updatedAt: event.payload.updatedAt,
      }));

    case "thread.turn-start-requested":
      return updateThreadState(state, event.payload.threadId, (thread) => ({
        ...thread,
        ...(event.payload.modelSelection !== undefined
          ? { modelSelection: normalizeModelSelection(event.payload.modelSelection) }
          : {}),
        ...(event.payload.gedWorkflowEnabled !== undefined
          ? { gedWorkflowEnabled: event.payload.gedWorkflowEnabled }
          : {}),
        runtimeMode: event.payload.runtimeMode,
        interactionMode: event.payload.interactionMode,
        pendingSourceProposedPlan: event.payload.sourceProposedPlan,
        updatedAt: event.occurredAt,
      }));

    case "thread.turn-interrupt-requested": {
      if (event.payload.turnId === undefined) {
        return updateThreadState(state, event.payload.threadId, (thread) => {
          const latestTurn = thread.latestTurn;
          if (latestTurn === null) {
            return thread;
          }
          if (latestTurn.state !== "running") {
            return thread;
          }
          return {
            ...thread,
            latestTurn: buildLatestTurn({
              previous: latestTurn,
              turnId: latestTurn.turnId,
              state: "interrupted",
              requestedAt: latestTurn.requestedAt,
              startedAt: latestTurn.startedAt ?? event.payload.createdAt,
              completedAt: latestTurn.completedAt ?? event.payload.createdAt,
              assistantMessageId: latestTurn.assistantMessageId,
            }),
            updatedAt: event.occurredAt,
          };
        });
      }
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const latestTurn = thread.latestTurn;
        if (latestTurn === null || latestTurn.turnId !== event.payload.turnId) {
          return thread;
        }
        return {
          ...thread,
          latestTurn: buildLatestTurn({
            previous: latestTurn,
            turnId: event.payload.turnId,
            state: "interrupted",
            requestedAt: latestTurn.requestedAt,
            startedAt: latestTurn.startedAt ?? event.payload.createdAt,
            completedAt: latestTurn.completedAt ?? event.payload.createdAt,
            assistantMessageId: latestTurn.assistantMessageId,
          }),
          updatedAt: event.occurredAt,
        };
      });
    }

    case "thread.message-sent": {
      const nextState = updateThreadStateWithHints(state, event.payload.threadId, (thread) => {
        const message = mapMessage(thread.environmentId, {
          id: event.payload.messageId,
          role: event.payload.role,
          text: event.payload.text,
          ...(event.payload.attachments !== undefined
            ? { attachments: event.payload.attachments }
            : {}),
          turnId: event.payload.turnId,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        });
        // O(1) lookup via byId index instead of O(n) find
        const existingMessage =
          state.messageByThreadId[event.payload.threadId]?.[event.payload.messageId];
        let changedMessage: ChatMessage;
        const messages =
          existingMessage !== undefined
            ? thread.messages.map((entry) => {
                if (entry.id !== message.id) return entry;
                const merged: ChatMessage = {
                  ...entry,
                  text: message.streaming
                    ? `${entry.text}${message.text}`
                    : message.text.length > 0
                      ? message.text
                      : entry.text,
                  streaming: message.streaming,
                  ...(message.turnId !== undefined ? { turnId: message.turnId } : {}),
                  ...(message.streaming
                    ? entry.completedAt !== undefined
                      ? { completedAt: entry.completedAt }
                      : {}
                    : message.completedAt !== undefined
                      ? { completedAt: message.completedAt }
                      : {}),
                  ...(message.attachments !== undefined
                    ? { attachments: message.attachments }
                    : {}),
                };
                changedMessage = merged;
                return merged;
              })
            : (() => {
                changedMessage = message;
                return [...thread.messages, message];
              })();
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);
        const turnDiffSummaries =
          event.payload.role === "assistant" && event.payload.turnId !== null
            ? rebindTurnDiffSummariesForAssistantMessage(
                thread.turnDiffSummaries,
                event.payload.turnId,
                event.payload.messageId,
              )
            : thread.turnDiffSummaries;
        const turnStillRunning =
          event.payload.turnId !== null &&
          thread.session?.orchestrationStatus === "running" &&
          thread.session.activeTurnId === event.payload.turnId;
        const settlesTurn = !event.payload.streaming && !turnStillRunning;
        const latestTurn: Thread["latestTurn"] =
          event.payload.role === "assistant" &&
          event.payload.turnId !== null &&
          (thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId)
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.turnId,
                state: settlesTurn
                  ? thread.latestTurn?.state === "interrupted"
                    ? "interrupted"
                    : thread.latestTurn?.state === "error"
                      ? "error"
                      : "completed"
                  : "running",
                requestedAt:
                  thread.latestTurn?.turnId === event.payload.turnId
                    ? thread.latestTurn.requestedAt
                    : event.payload.createdAt,
                startedAt:
                  thread.latestTurn?.turnId === event.payload.turnId
                    ? (thread.latestTurn.startedAt ?? event.payload.createdAt)
                    : event.payload.createdAt,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
                completedAt: settlesTurn
                  ? event.payload.updatedAt
                  : thread.latestTurn?.turnId === event.payload.turnId
                    ? (thread.latestTurn.completedAt ?? null)
                    : null,
                assistantMessageId: event.payload.messageId,
              })
            : thread.latestTurn;
        return {
          thread: {
            ...thread,
            messages: cappedMessages,
            turnDiffSummaries,
            latestTurn,
            updatedAt: event.occurredAt,
          },
          hints: { changedMessage: changedMessage! },
        };
      });
      const thread = getThreadFromEnvironmentState(nextState, event.payload.threadId);
      return thread && isPmThreadForProject(thread)
        ? clearProjectPmQuotaBlock(nextState, thread.projectId)
        : nextState;
    }

    case "thread.session-set":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const settledTurnState = settledTurnStateForSessionStatus(event.payload.session.status);
        const latestTurn: Thread["latestTurn"] =
          event.payload.session.status === "running" && event.payload.session.activeTurnId !== null
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.session.activeTurnId,
                state: "running",
                requestedAt:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? thread.latestTurn.requestedAt
                    : event.payload.session.updatedAt,
                startedAt:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? (thread.latestTurn.startedAt ?? event.payload.session.updatedAt)
                    : event.payload.session.updatedAt,
                completedAt: null,
                assistantMessageId:
                  thread.latestTurn?.turnId === event.payload.session.activeTurnId
                    ? thread.latestTurn.assistantMessageId
                    : null,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
              })
            : thread.latestTurn !== null &&
                thread.latestTurn.state === "running" &&
                settledTurnState !== null
              ? buildLatestTurn({
                  previous: thread.latestTurn,
                  turnId: thread.latestTurn.turnId,
                  state: settledTurnState,
                  requestedAt: thread.latestTurn.requestedAt,
                  startedAt: thread.latestTurn.startedAt,
                  completedAt: event.payload.session.updatedAt,
                  assistantMessageId: thread.latestTurn.assistantMessageId,
                })
              : thread.latestTurn;

        return {
          ...thread,
          session: mapSession(event.payload.session),
          error: sanitizeThreadErrorMessage(event.payload.session.lastError),
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.session-stop-requested":
      return updateThreadState(state, event.payload.threadId, (thread) =>
        thread.session === null
          ? thread
          : {
              ...thread,
              session: {
                ...thread.session,
                status: "closed",
                orchestrationStatus: "stopped",
                activeTurnId: undefined,
                updatedAt: event.payload.createdAt,
              },
              updatedAt: event.occurredAt,
            },
      );

    case "thread.proposed-plan-upserted":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const proposedPlan = mapProposedPlan(event.payload.proposedPlan);
        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== proposedPlan.id),
          proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-MAX_THREAD_PROPOSED_PLANS);
        return {
          ...thread,
          proposedPlans,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.turn-diff-completed":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const checkpoint = mapTurnDiffSummary({
          turnId: event.payload.turnId,
          checkpointTurnCount: event.payload.checkpointTurnCount,
          checkpointRef: event.payload.checkpointRef,
          status: event.payload.status,
          files: event.payload.files,
          assistantMessageId: event.payload.assistantMessageId,
          completedAt: event.payload.completedAt,
        });
        const existing = thread.turnDiffSummaries.find(
          (entry) => entry.turnId === checkpoint.turnId,
        );
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return thread;
        }
        const turnDiffSummaries = [
          ...thread.turnDiffSummaries.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const turnStillRunning =
          thread.session?.orchestrationStatus === "running" &&
          thread.session.activeTurnId === event.payload.turnId;
        const latestTurn =
          !turnStillRunning &&
          (thread.latestTurn === null || thread.latestTurn.turnId === event.payload.turnId)
            ? buildLatestTurn({
                previous: thread.latestTurn,
                turnId: event.payload.turnId,
                state: checkpointStatusToLatestTurnState(event.payload.status),
                requestedAt: thread.latestTurn?.requestedAt ?? event.payload.completedAt,
                startedAt: thread.latestTurn?.startedAt ?? event.payload.completedAt,
                completedAt: event.payload.completedAt,
                assistantMessageId: event.payload.assistantMessageId,
                sourceProposedPlan: thread.pendingSourceProposedPlan,
              })
            : thread.latestTurn;
        return {
          ...thread,
          turnDiffSummaries,
          latestTurn,
          updatedAt: event.occurredAt,
        };
      });

    case "thread.reverted":
      return updateThreadState(state, event.payload.threadId, (thread) => {
        const turnDiffSummaries = thread.turnDiffSummaries
          .filter(
            (entry) =>
              entry.checkpointTurnCount !== undefined &&
              entry.checkpointTurnCount <= event.payload.turnCount,
          )
          .toSorted(
            (left, right) =>
              (left.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER) -
              (right.checkpointTurnCount ?? Number.MAX_SAFE_INTEGER),
          )
          .slice(-MAX_THREAD_CHECKPOINTS);
        const retainedTurnIds = new Set(turnDiffSummaries.map((entry) => entry.turnId));
        const messages = retainThreadMessagesAfterRevert(
          thread.messages,
          retainedTurnIds,
          event.payload.turnCount,
        ).slice(-MAX_THREAD_MESSAGES);
        const proposedPlans = retainThreadProposedPlansAfterRevert(
          thread.proposedPlans,
          retainedTurnIds,
        ).slice(-MAX_THREAD_PROPOSED_PLANS);
        const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);
        const latestCheckpoint = turnDiffSummaries.at(-1) ?? null;

        return {
          ...thread,
          turnDiffSummaries,
          messages,
          proposedPlans,
          activities,
          pendingSourceProposedPlan: undefined,
          latestTurn:
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(
                    (latestCheckpoint.status ?? "ready") as "ready" | "missing" | "error",
                  ),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId ?? null,
                },
          updatedAt: event.occurredAt,
        };
      });

    case "thread.activity-appended": {
      const nextState = updateThreadStateWithHints(state, event.payload.threadId, (thread) => {
        const newActivity = { ...event.payload.activity };
        const existingActivity = state.activityByThreadId[event.payload.threadId]?.[newActivity.id];
        let activities: OrchestrationThreadActivity[];
        let changedActivity: OrchestrationThreadActivity | undefined;
        if (existingActivity !== undefined) {
          // Replace existing entry — must re-sort since updated content may change order
          activities = thread.activities
            .map((a) => (a.id === newActivity.id ? newActivity : a))
            .toSorted(compareActivities)
            .slice(-MAX_THREAD_ACTIVITIES);
          // No incremental hint for replace — ids order may change
        } else {
          // New entry: check if it sorts to the tail (common streaming case)
          const last = thread.activities[thread.activities.length - 1];
          if (last === undefined || compareActivities(newActivity, last) >= 0) {
            // Appends to the end — no re-sort needed, just trim; ids stay in order
            const appended = [...thread.activities, newActivity];
            activities = appended.slice(-MAX_THREAD_ACTIVITIES);
            // Only set hint for tail-append: ids can be updated incrementally
            changedActivity = newActivity;
          } else {
            // Out-of-order — fall back to full sort; no incremental hint
            activities = [...thread.activities, newActivity]
              .toSorted(compareActivities)
              .slice(-MAX_THREAD_ACTIVITIES);
          }
        }
        return {
          thread: {
            ...thread,
            activities,
            updatedAt: event.occurredAt,
          },
          hints: changedActivity !== undefined ? { changedActivity } : {},
        };
      });
      const thread = getThreadFromEnvironmentState(nextState, event.payload.threadId);
      const quotaBlock = pmQuotaBlockFromActivity(event.payload.activity);
      return thread && isPmThreadForProject(thread) && quotaBlock !== null
        ? setProjectPmQuotaBlock(nextState, thread.projectId, quotaBlock)
        : nextState;
    }

    case "thread.approval-response-requested":
    case "thread.user-input-response-requested":
      return state;
  }

  return state;
}

function applyEnvironmentShellEvent(
  state: EnvironmentState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): EnvironmentState {
  switch (event.kind) {
    case "project-upserted": {
      const nextProject = mapProject(event.project, environmentId);
      const existingProjectId =
        state.projectIds.find(
          (projectId) =>
            projectId === event.project.id ||
            state.projectById[projectId]?.cwd === event.project.workspaceRoot,
        ) ?? null;
      let projectById = state.projectById;
      let projectIds = state.projectIds;

      if (existingProjectId !== null && existingProjectId !== nextProject.id) {
        const { [existingProjectId]: _removedProject, ...restProjectById } = state.projectById;
        projectById = {
          ...restProjectById,
          [nextProject.id]: nextProject,
        };
        projectIds = state.projectIds.map((projectId) =>
          projectId === existingProjectId ? nextProject.id : projectId,
        );
      } else {
        projectById = {
          ...state.projectById,
          [nextProject.id]: nextProject,
        };
        projectIds =
          existingProjectId === null && !state.projectIds.includes(nextProject.id)
            ? [...state.projectIds, nextProject.id]
            : state.projectIds;
      }

      return {
        ...state,
        projectById,
        projectIds,
      };
    }
    case "project-removed": {
      if (!state.projectById[event.projectId]) {
        return state;
      }
      const { [event.projectId]: _removedProject, ...projectById } = state.projectById;
      const { [event.projectId]: _removedPmQuotaBlock, ...pmQuotaBlockByProjectId } =
        state.pmQuotaBlockByProjectId;
      return {
        ...state,
        projectById,
        pmQuotaBlockByProjectId,
        projectIds: removeId(state.projectIds, event.projectId),
      };
    }
    case "thread-upserted":
      return writeThreadShellState(state, mapThreadShell(event.thread, environmentId));
    case "thread-removed":
      return removeThreadState(state, event.threadId);
  }
}

export function applyOrchestrationEvents(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
  environmentId: EnvironmentId,
): AppState {
  if (events.length === 0) {
    return state;
  }
  const currentEnvironmentState = getStoredEnvironmentState(state, environmentId);
  const nextEnvironmentState = events.reduce(
    (nextState, event) => applyEnvironmentOrchestrationEvent(nextState, event, environmentId),
    currentEnvironmentState,
  );
  return commitEnvironmentState(state, environmentId, nextEnvironmentState);
}

function getEnvironmentEntries(
  state: AppState,
): ReadonlyArray<readonly [EnvironmentId, EnvironmentState]> {
  return Object.entries(state.environmentStateById) as unknown as ReadonlyArray<
    readonly [EnvironmentId, EnvironmentState]
  >;
}

export function selectEnvironmentState(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): EnvironmentState {
  return environmentId ? getStoredEnvironmentState(state, environmentId) : initialEnvironmentState;
}

export function selectProjectsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Project[] {
  return getProjects(selectEnvironmentState(state, environmentId));
}

export function selectThreadsForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): Thread[] {
  return getThreads(selectEnvironmentState(state, environmentId));
}

export function selectTasksForEnvironment(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
): OrchestratorTask[] {
  return getTasks(selectEnvironmentState(state, environmentId));
}

export function selectTasksForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): OrchestratorTask[] {
  if (!ref) {
    return [];
  }
  const environmentState = selectEnvironmentState(state, ref.environmentId);
  return (environmentState.taskIdsByProjectId[ref.projectId] ?? EMPTY_TASK_IDS).flatMap(
    (taskId) => {
      const task = environmentState.taskById[taskId];
      return task ? [task] : [];
    },
  );
}

export function selectTaskByRef(
  state: AppState,
  ref: ScopedTaskRef | null | undefined,
): OrchestratorTask | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).taskById[String(ref.taskId)]
    : undefined;
}

export function selectTaskQuotaBlockByRef(
  state: AppState,
  ref: ScopedTaskRef | null | undefined,
): TaskQuotaBlock | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).quotaBlockedStageByTaskId[String(ref.taskId)]
    : undefined;
}

export function selectProjectPmQuotaBlockByRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): ProjectPmQuotaBlock | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).pmQuotaBlockByProjectId[
        String(ref.projectId)
      ]
    : undefined;
}

export function selectPendingGatesForTaskRef(
  state: AppState,
  ref: ScopedTaskRef | null | undefined,
): OrchestratorPendingGate[] {
  return ref
    ? pendingGatesForTask(selectEnvironmentState(state, ref.environmentId), String(ref.taskId))
    : [];
}

export function selectPendingGateById(
  state: AppState,
  environmentId: EnvironmentId | null | undefined,
  gateId: GateId | null | undefined,
): OrchestratorPendingGate | undefined {
  return environmentId && gateId
    ? selectEnvironmentState(state, environmentId).pendingGateById[String(gateId)]
    : undefined;
}

export function selectProjectsAcrossEnvironments(state: AppState): Project[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getProjects(environmentState),
  );
}

export function selectThreadsAcrossEnvironments(state: AppState): Thread[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    getThreads(environmentState),
  );
}

/** Like `selectThreadsAcrossEnvironments` but returns stable `ThreadShell` references from the store (no derived data). */
export function selectThreadShellsAcrossEnvironments(state: AppState): ThreadShell[] {
  return getEnvironmentEntries(state).flatMap(([, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const shell = environmentState.threadShellById[threadId];
      return shell ? [shell] : [];
    }),
  );
}

export function selectSidebarThreadsAcrossEnvironments(state: AppState): SidebarThreadSummary[] {
  return getEnvironmentEntries(state).flatMap(([environmentId, environmentState]) =>
    environmentState.threadIds.flatMap((threadId) => {
      const thread = environmentState.sidebarThreadSummaryById[threadId];
      return thread && thread.environmentId === environmentId ? [thread] : [];
    }),
  );
}

export function selectSidebarThreadsForProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): SidebarThreadSummary[] {
  if (!ref) {
    return [];
  }

  const environmentState = selectEnvironmentState(state, ref.environmentId);
  const threadIds = environmentState.threadIdsByProjectId[ref.projectId] ?? EMPTY_THREAD_IDS;
  return threadIds.flatMap((threadId) => {
    const thread = environmentState.sidebarThreadSummaryById[threadId];
    return thread ? [thread] : [];
  });
}

export function selectSidebarThreadsForProjectRefs(
  state: AppState,
  refs: readonly ScopedProjectRef[],
): SidebarThreadSummary[] {
  if (refs.length === 0) return [];
  if (refs.length === 1) return selectSidebarThreadsForProjectRef(state, refs[0]);
  return refs.flatMap((ref) => selectSidebarThreadsForProjectRef(state, ref));
}

export function selectBootstrapCompleteForActiveEnvironment(state: AppState): boolean {
  return selectEnvironmentState(state, state.activeEnvironmentId).bootstrapComplete;
}

export function selectProjectByRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): Project | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).projectById[ref.projectId]
    : undefined;
}

export function selectThreadByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): Thread | undefined {
  return ref
    ? getThreadFromEnvironmentState(selectEnvironmentState(state, ref.environmentId), ref.threadId)
    : undefined;
}

export function selectThreadExistsByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): boolean {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).threadShellById[ref.threadId] !== undefined
    : false;
}

export function selectSidebarThreadSummaryByRef(
  state: AppState,
  ref: ScopedThreadRef | null | undefined,
): SidebarThreadSummary | undefined {
  return ref
    ? selectEnvironmentState(state, ref.environmentId).sidebarThreadSummaryById[ref.threadId]
    : undefined;
}

export function selectThreadIdsByProjectRef(
  state: AppState,
  ref: ScopedProjectRef | null | undefined,
): ThreadId[] {
  return ref
    ? (selectEnvironmentState(state, ref.environmentId).threadIdsByProjectId[ref.projectId] ??
        EMPTY_THREAD_IDS)
    : EMPTY_THREAD_IDS;
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  if (state.activeEnvironmentId === null) {
    return state;
  }

  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, state.activeEnvironmentId),
    threadId,
    (thread) => {
      if (thread.error === error) return thread;
      return { ...thread, error };
    },
  );
  return commitEnvironmentState(state, state.activeEnvironmentId, nextEnvironmentState);
}

export function applyOrchestrationEvent(
  state: AppState,
  event: OrchestrationEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentOrchestrationEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function applyShellEvent(
  state: AppState,
  event: OrchestrationShellStreamEvent,
  environmentId: EnvironmentId,
): AppState {
  return commitEnvironmentState(
    state,
    environmentId,
    applyEnvironmentShellEvent(
      getStoredEnvironmentState(state, environmentId),
      event,
      environmentId,
    ),
  );
}

export function setActiveEnvironmentId(state: AppState, environmentId: EnvironmentId): AppState {
  if (state.activeEnvironmentId === environmentId) {
    return state;
  }

  return {
    ...state,
    activeEnvironmentId: environmentId,
  };
}

export function removeEnvironmentState(state: AppState, environmentId: EnvironmentId): AppState {
  if (!state.environmentStateById[environmentId] && state.activeEnvironmentId !== environmentId) {
    return state;
  }

  const { [environmentId]: _removed, ...environmentStateById } = state.environmentStateById;
  return {
    ...state,
    activeEnvironmentId:
      state.activeEnvironmentId === environmentId ? null : state.activeEnvironmentId,
    environmentStateById,
  };
}

export function setThreadBranch(
  state: AppState,
  threadRef: ScopedThreadRef,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const nextEnvironmentState = updateThreadState(
    getStoredEnvironmentState(state, threadRef.environmentId),
    threadRef.threadId,
    (thread) => {
      if (thread.branch === branch && thread.worktreePath === worktreePath) return thread;
      const cwdChanged = thread.worktreePath !== worktreePath;
      return {
        ...thread,
        branch,
        worktreePath,
        ...(cwdChanged ? { session: null } : {}),
      };
    },
  );
  return commitEnvironmentState(state, threadRef.environmentId, nextEnvironmentState);
}

interface AppStore extends AppState {
  setActiveEnvironmentId: (environmentId: EnvironmentId) => void;
  removeEnvironmentState: (environmentId: EnvironmentId) => void;
  syncServerShellSnapshot: (
    snapshot: OrchestrationShellSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncServerThreadDetail: (thread: OrchestrationThread, environmentId: EnvironmentId) => void;
  syncOrchestratorProjectSnapshot: (
    snapshot: OrchestratorProjectDetailSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  syncOrchestratorTaskSnapshot: (
    snapshot: OrchestratorTaskDetailSnapshot,
    environmentId: EnvironmentId,
  ) => void;
  applyOrchestratorProjectStreamItem: (
    item: OrchestratorProjectStreamItem,
    environmentId: EnvironmentId,
  ) => void;
  applyOrchestratorTaskStreamItem: (
    item: OrchestratorTaskStreamItem,
    environmentId: EnvironmentId,
  ) => void;
  applyOrchestrationEvent: (event: OrchestrationEvent, environmentId: EnvironmentId) => void;
  applyOrchestrationEvents: (
    events: ReadonlyArray<OrchestrationEvent>,
    environmentId: EnvironmentId,
  ) => void;
  applyShellEvent: (event: OrchestrationShellStreamEvent, environmentId: EnvironmentId) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (
    threadRef: ScopedThreadRef,
    branch: string | null,
    worktreePath: string | null,
  ) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...initialState,
  setActiveEnvironmentId: (environmentId) =>
    set((state) => setActiveEnvironmentId(state, environmentId)),
  removeEnvironmentState: (environmentId) =>
    set((state) => removeEnvironmentState(state, environmentId)),
  syncServerShellSnapshot: (snapshot, environmentId) =>
    set((state) => syncServerShellSnapshot(state, snapshot, environmentId)),
  syncServerThreadDetail: (thread, environmentId) =>
    set((state) => syncServerThreadDetail(state, thread, environmentId)),
  syncOrchestratorProjectSnapshot: (snapshot, environmentId) =>
    set((state) => syncOrchestratorProjectSnapshot(state, snapshot, environmentId)),
  syncOrchestratorTaskSnapshot: (snapshot, environmentId) =>
    set((state) => syncOrchestratorTaskSnapshot(state, snapshot, environmentId)),
  applyOrchestratorProjectStreamItem: (item, environmentId) =>
    set((state) =>
      item.kind === "snapshot"
        ? syncOrchestratorProjectSnapshot(state, item.snapshot, environmentId)
        : applyOrchestrationEvent(state, item.event, environmentId),
    ),
  applyOrchestratorTaskStreamItem: (item, environmentId) =>
    set((state) =>
      item.kind === "snapshot"
        ? syncOrchestratorTaskSnapshot(state, item.snapshot, environmentId)
        : applyOrchestrationEvent(state, item.event, environmentId),
    ),
  applyOrchestrationEvent: (event, environmentId) =>
    set((state) => applyOrchestrationEvent(state, event, environmentId)),
  applyOrchestrationEvents: (events, environmentId) =>
    set((state) => applyOrchestrationEvents(state, events, environmentId)),
  applyShellEvent: (event, environmentId) =>
    set((state) => applyShellEvent(state, event, environmentId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadRef, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadRef, branch, worktreePath)),
}));
