import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@t3tools/client-runtime";
import {
  EnvironmentId,
  GateId,
  MessageId,
  ProjectId,
  TaskId,
  ThreadId,
  type OrchestrationGateDecision,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  GitBranchIcon,
  MessageSquareIcon,
  Trash2Icon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";

import { DiffPanelLoadingState, DiffPanelShell } from "../DiffPanelShell";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { ProjectFavicon } from "../ProjectFavicon";
import { MessagesTimeline, type PmTaskChipContext } from "../chat/MessagesTimeline";
import { ProposedPlanCard } from "../chat/ProposedPlanCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { StageTimeline } from "./StageTimeline";
import { readEnvironmentApi } from "../../environmentApi";
import {
  retainOrchestratorProjectSubscription,
  retainOrchestratorTaskSubscription,
  retainThreadDetailSubscription,
} from "../../environments/runtime/service";
import {
  selectPendingGatesForTaskRef,
  selectProjectPmQuotaBlockByRef,
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsForProjectRef,
  selectTaskByRef,
  selectTaskQuotaBlockByRef,
  selectTasksForProjectRef,
  selectThreadByRef,
  useStore,
  type ScopedTaskRef,
} from "../../store";
import { deriveTimelineEntries, deriveWorkLogEntries } from "../../session-logic";
import { buildThreadRouteParams } from "../../threadRoutes";
import { isOrchestratorManagedThread } from "../../lib/orchestratorThreads";
import type { OrchestratorPendingGate, OrchestratorTask, Project, Thread } from "../../types";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import { ensureLocalApi } from "../../localApi";
import { useUiStateStore } from "../../uiStateStore";
import {
  getOrchestratorProjectGridClassName,
  getOrchestratorPmSectionClassName,
  OrchestratorBoardVisibilityButton,
} from "./OrchestratorProjectLayout";
import { confirmAndCancelTask, confirmAndClearPmChat } from "./OrchestratorRoutes.logic";
import { PmChatComposer } from "./PmChatComposer";
import { TaskBoard } from "./TaskBoard";
import { TaskPrLink } from "./TaskPrLink";

// Re-exported so existing imports (e.g. tests) keep resolving from this module.
export { AbandonedTaskBoardSection, TaskBoard } from "./TaskBoard";

const LazyDiffPanel = lazy(() => import("../DiffPanel"));

const TASK_STATUS_LABELS: Record<OrchestratorTask["status"], string> = {
  abandoned: "Abandoned",
  blocked: "Blocked",
  "blocked-on-quota": "Blocked on quota",
  classified: "Classified",
  draft: "Draft",
  landed: "Landed",
  planning: "Planning",
  "plan-review": "Plan review",
  reviewing: "Reviewing",
  review: "Review",
  verifying: "Verifying",
  working: "Working",
};

function toEnvironmentId(value: string): EnvironmentId {
  return EnvironmentId.make(value);
}

function toProjectId(value: string): ProjectId {
  return ProjectId.make(value);
}

function toTaskId(value: string): TaskId {
  return TaskId.make(value);
}

function pmThreadIdForProject(projectId: ProjectId): ThreadId {
  return ThreadId.make(`pm:${projectId}`);
}

function stageThreadIdForTask(task: OrchestratorTask): ThreadId | null {
  return task.currentStageThreadId ?? task.stageThreadIds.at(-1) ?? null;
}

function OrchestratorPageChrome({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-background/95 px-3 py-2 sm:px-5 sm:py-3">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
          {description ? (
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {children}
      </div>
    </header>
  );
}

function OrchestratorPage({ children }: { children: ReactNode }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {children}
      </div>
    </SidebarInset>
  );
}

export function OrchestratorHomeRoute() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  return (
    <OrchestratorPage>
      <OrchestratorPageChrome title="Orchestrator" description={`${projects.length} projects`} />
      <main className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectGridCard
              key={scopedProjectKey(scopeProjectRef(project.environmentId, project.id))}
              project={project}
            />
          ))}
        </div>
      </main>
    </OrchestratorPage>
  );
}

function ProjectGridCard({ project }: { project: Project }) {
  return (
    <Link
      to="/orch/$environmentId/$projectId"
      params={{ environmentId: project.environmentId, projectId: project.id }}
      className="group flex min-h-32 min-w-0 flex-col rounded-lg border border-border bg-card p-4 text-card-foreground outline-hidden transition-colors hover:border-ring/50 hover:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{project.name}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{project.cwd}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-4 text-xs text-muted-foreground">
        <WorkflowIcon className="size-3.5" />
        <span className="truncate">Open workspace</span>
      </div>
    </Link>
  );
}

export function OrchestratorProjectRoute(props: { environmentId: string; projectId: string }) {
  const environmentId = toEnvironmentId(props.environmentId);
  const projectId = toProjectId(props.projectId);
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const pmThreadId = useMemo(() => pmThreadIdForProject(projectId), [projectId]);
  const pmThreadRef = useMemo(
    () => scopeThreadRef(environmentId, pmThreadId),
    [environmentId, pmThreadId],
  );
  const project = useStore((state) => selectProjectByRef(state, projectRef));
  const tasks = useStore(useShallow((state) => selectTasksForProjectRef(state, projectRef)));
  const pmThread = useStore((state) => selectThreadByRef(state, pmThreadRef));
  const boardCollapsed = useUiStateStore((state) => state.orchestratorBoardCollapsed);
  const setBoardCollapsed = useUiStateStore((state) => state.setOrchestratorBoardCollapsed);
  const setLastOrchestratorProject = useUiStateStore((state) => state.setLastOrchestratorProject);
  const navigate = useNavigate();

  // Remember this workspace so the sidebar "Orchestrator" toggle returns here.
  useEffect(() => {
    setLastOrchestratorProject({ environmentId, projectId });
  }, [environmentId, projectId, setLastOrchestratorProject]);

  // "Open in Chat" lands on this project's most recent chat thread (stage/PM
  // threads excluded), or the chat home when the project has no chat threads.
  // Return a stable primitive (thread id) from the selector — returning a fresh
  // `scopeThreadRef` object each call would break useSyncExternalStore's
  // snapshot equality and loop forever.
  const chatThreadId = useStore((state) => {
    const candidates = selectSidebarThreadsForProjectRef(state, projectRef).filter(
      (thread) => thread.archivedAt === null && !isOrchestratorManagedThread(thread),
    );
    const newest = candidates.reduce<(typeof candidates)[number] | null>((best, thread) => {
      if (!best) {
        return thread;
      }
      const bestAt = best.latestUserMessageAt ?? best.updatedAt ?? best.createdAt;
      const threadAt = thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt;
      return threadAt.localeCompare(bestAt) > 0 ? thread : best;
    }, null);
    return newest ? newest.id : null;
  });

  const handleOpenInChat = useCallback(() => {
    if (chatThreadId) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(environmentId, chatThreadId)),
      });
      return;
    }
    void navigate({ to: "/" });
  }, [chatThreadId, environmentId, navigate]);

  useEffect(() => {
    return retainOrchestratorProjectSubscription(environmentId, projectId);
  }, [environmentId, projectId]);

  useEffect(() => {
    return retainThreadDetailSubscription(environmentId, pmThreadId);
  }, [environmentId, pmThreadId]);

  return (
    <OrchestratorPage>
      <OrchestratorPageChrome
        title={project?.name ?? "Project"}
        description={project?.cwd ?? props.projectId}
      >
        <OrchestratorBoardVisibilityButton
          collapsed={boardCollapsed}
          setCollapsed={setBoardCollapsed}
        />
        <Button
          onClick={handleOpenInChat}
          size="sm"
          variant="outline"
          data-testid="open-in-chat-button"
        >
          <MessageSquareIcon className="size-4" />
          Open in Chat
        </Button>
        <Button render={<Link to="/orch" />} size="sm" variant="outline">
          <ArrowLeftIcon className="size-4" />
          Projects
        </Button>
      </OrchestratorPageChrome>
      <ProjectPmQuotaBanner projectRef={projectRef} />
      <main className={getOrchestratorProjectGridClassName(boardCollapsed)}>
        <section className={getOrchestratorPmSectionClassName(boardCollapsed)}>
          <PmConversation
            environmentId={environmentId}
            project={project}
            projectId={projectId}
            thread={pmThread}
            threadRef={pmThreadRef}
          />
        </section>
        {boardCollapsed ? null : (
          <TaskBoard environmentId={environmentId} projectId={projectId} tasks={tasks} />
        )}
      </main>
    </OrchestratorPage>
  );
}

function ProjectPmQuotaBanner({ projectRef }: { projectRef: ReturnType<typeof scopeProjectRef> }) {
  const quotaBlock = useStore((state) => selectProjectPmQuotaBlockByRef(state, projectRef));
  if (!quotaBlock) {
    return null;
  }
  const resetLabel = quotaBlock.resetAt ? formatQuotaResetLabel(quotaBlock.resetAt) : null;
  return (
    <div className="flex items-center gap-2 border-b border-warning/24 bg-warning/8 px-3 py-2 text-xs text-warning-foreground sm:px-5">
      <CircleAlertIcon className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 truncate">
        PM paused on quota · {quotaBlock.providerInstanceId}
        {resetLabel ? ` · resets ${resetLabel}` : ""}
      </span>
    </div>
  );
}

function PmConversation({
  environmentId,
  project,
  projectId,
  thread,
  threadRef,
}: {
  environmentId: EnvironmentId;
  project: Project | undefined;
  projectId: ProjectId;
  thread: Thread | undefined;
  threadRef: ScopedThreadRef;
}) {
  const [isClearing, setIsClearing] = useState(false);
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const tasks = useStore(useShallow((state) => selectTasksForProjectRef(state, projectRef)));
  const taskTitleById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const task of tasks) {
      byId.set(task.id, task.title);
    }
    return byId;
  }, [tasks]);
  const pmTaskChip = useMemo<PmTaskChipContext>(
    () => ({
      environmentId,
      projectId,
      resolveTaskTitle: (taskId: string) => taskTitleById.get(taskId),
    }),
    [environmentId, projectId, taskTitleById],
  );
  const clearPmChat = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api || isClearing) {
      return;
    }
    setIsClearing(true);
    try {
      await confirmAndClearPmChat({
        projectId,
        confirm: (message) => ensureLocalApi().dialogs.confirm(message),
        clearPmChat: api.orchestrator.clearPmChat,
      });
    } finally {
      setIsClearing(false);
    }
  }, [environmentId, isClearing, projectId]);

  return (
    <>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">PM chat</h2>
        </div>
        <Button
          aria-label="Clear PM chat"
          disabled={isClearing}
          onClick={() => void clearPmChat()}
          size="sm"
          title="Clear PM chat"
          variant="outline"
        >
          <Trash2Icon className="size-4" />
          Clear
        </Button>
      </div>
      <SharedThreadTimeline
        cwd={project?.cwd}
        emptyMessage="PM conversation will appear here."
        emptyState={<PmChatEmptyState />}
        pmTaskChip={pmTaskChip}
        thread={thread}
        threadRef={threadRef}
        workspaceRoot={project?.cwd}
      />
      <PmChatComposer
        environmentId={environmentId}
        project={project}
        projectId={projectId}
        thread={thread}
      />
    </>
  );
}

export function PmChatEmptyState() {
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center gap-3 px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground">
        <WorkflowIcon className="size-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          Tell the project manager what you want built.
        </p>
        <p className="text-xs text-muted-foreground">
          It plans the work and delegates to worker agents — the tasks it creates show up on the
          board to the right.
        </p>
      </div>
    </div>
  );
}

function SharedThreadTimeline({
  cwd,
  emptyMessage,
  emptyState,
  pmTaskChip,
  thread,
  threadRef,
  workspaceRoot,
}: {
  cwd: string | undefined;
  emptyMessage: string;
  emptyState?: ReactNode;
  pmTaskChip?: PmTaskChipContext;
  thread: Thread | undefined;
  threadRef: ScopedThreadRef;
  workspaceRoot: string | undefined;
}) {
  const settings = useSettings();
  const { resolvedTheme } = useTheme();
  const listRef = useRef<LegendListRef | null>(null);
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(thread?.activities ?? []),
    [thread?.activities],
  );
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(thread?.messages ?? [], thread?.proposedPlans ?? [], workLogEntries),
    [thread?.messages, thread?.proposedPlans, workLogEntries],
  );
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } = useTurnDiffSummaries(thread);
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const byMessageId = new Map<MessageId, (typeof turnDiffSummaries)[number]>();
    for (const summary of turnDiffSummaries) {
      if (!summary.assistantMessageId) {
        continue;
      }
      byMessageId.set(summary.assistantMessageId, summary);
    }
    return byMessageId;
  }, [turnDiffSummaries]);
  const revertTurnCountByUserMessageId = useMemo(() => {
    const byUserMessageId = new Map<MessageId, number>();
    for (let index = 0; index < timelineEntries.length; index += 1) {
      const entry = timelineEntries[index];
      if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
        continue;
      }
      for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
        const nextEntry = timelineEntries[nextIndex];
        if (!nextEntry || nextEntry.kind !== "message") {
          continue;
        }
        if (nextEntry.message.role === "user") {
          break;
        }
        const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id);
        if (!summary) {
          continue;
        }
        const turnCount =
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId];
        if (typeof turnCount === "number") {
          byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1));
        }
        break;
      }
    }
    return byUserMessageId;
  }, [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]);
  const activeTurnInProgress = thread?.latestTurn?.state === "running";
  const resolvedEmptyState = emptyState ?? (
    <p className="px-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessagesTimeline
        key={thread?.id ?? scopedThreadKey(threadRef)}
        activeThreadEnvironmentId={threadRef.environmentId}
        activeTurnInProgress={activeTurnInProgress}
        activeTurnStartedAt={thread?.latestTurn?.startedAt ?? null}
        emptyState={resolvedEmptyState}
        isRevertingCheckpoint={false}
        isWorking={activeTurnInProgress}
        latestTurn={thread?.latestTurn ?? null}
        listRef={listRef}
        markdownCwd={cwd}
        onImageExpand={() => {}}
        onIsAtEndChange={() => {}}
        onOpenTurnDiff={() => {}}
        onRevertUserMessage={() => {}}
        {...(pmTaskChip ? { pmTaskChip } : {})}
        resolvedTheme={resolvedTheme}
        revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
        routeThreadKey={scopedThreadKey(threadRef)}
        skills={[]}
        timestampFormat={settings.timestampFormat}
        timelineEntries={timelineEntries}
        turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
        workspaceRoot={workspaceRoot}
      />
    </div>
  );
}

function formatQuotaResetLabel(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Calm "paused on subscription quota" badge. Rendered only for blocked-on-quota
// tasks; shows the reset time when one is known (WP-Q6 auto-resume target).
function TaskQuotaBadge({
  environmentId,
  taskId,
  status,
}: {
  environmentId: EnvironmentId;
  taskId: TaskId;
  status: OrchestratorTask["status"];
}) {
  const quotaRef = useMemo<ScopedTaskRef>(
    () => ({ environmentId, taskId }),
    [environmentId, taskId],
  );
  const quotaBlock = useStore((state) => selectTaskQuotaBlockByRef(state, quotaRef));
  if (status !== "blocked-on-quota") {
    return null;
  }
  const resetLabel = quotaBlock?.resetAt ? formatQuotaResetLabel(quotaBlock.resetAt) : null;
  return (
    <Badge size="sm" variant="warning">
      <ClockIcon className="size-3" />
      {resetLabel ? `Quota · resets ${resetLabel}` : "Quota-blocked"}
    </Badge>
  );
}

export function OrchestratorTaskRoute(props: {
  environmentId: string;
  projectId: string;
  taskId: string;
}) {
  const environmentId = toEnvironmentId(props.environmentId);
  const projectId = toProjectId(props.projectId);
  const taskId = toTaskId(props.taskId);
  const taskRef = useMemo<ScopedTaskRef>(
    () => ({ environmentId, taskId }),
    [environmentId, taskId],
  );
  const project = useStore((state) =>
    selectProjectByRef(state, scopeProjectRef(environmentId, projectId)),
  );
  const task = useStore((state) => selectTaskByRef(state, taskRef));
  const gates = useStore(useShallow((state) => selectPendingGatesForTaskRef(state, taskRef)));
  const stageThreadId = task ? stageThreadIdForTask(task) : null;
  const stageThreadRef = useMemo(
    () => (stageThreadId ? scopeThreadRef(environmentId, stageThreadId) : null),
    [environmentId, stageThreadId],
  );
  const stageThread = useStore((state) =>
    stageThreadRef ? selectThreadByRef(state, stageThreadRef) : undefined,
  );

  useEffect(() => {
    return retainOrchestratorTaskSubscription(environmentId, taskId);
  }, [environmentId, taskId]);

  useEffect(() => {
    return retainOrchestratorProjectSubscription(environmentId, projectId);
  }, [environmentId, projectId]);

  useEffect(() => {
    if (!stageThreadId) {
      return undefined;
    }
    return retainThreadDetailSubscription(environmentId, stageThreadId);
  }, [environmentId, stageThreadId]);

  return (
    <OrchestratorPage>
      <OrchestratorPageChrome
        title={task?.title ?? "Task"}
        description={project?.name ?? props.projectId}
      >
        <Button
          render={
            <Link to="/orch/$environmentId/$projectId" params={{ environmentId, projectId }} />
          }
          size="sm"
          variant="outline"
        >
          <ArrowLeftIcon className="size-4" />
          Workspace
        </Button>
      </OrchestratorPageChrome>
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {task ? <TaskHeader task={task} /> : null}
          {stageThreadRef ? (
            <SharedThreadTimeline
              cwd={stageThread?.worktreePath ?? project?.cwd}
              emptyMessage="Stage output will appear here."
              thread={stageThread}
              threadRef={stageThreadRef}
              workspaceRoot={stageThread?.worktreePath ?? project?.cwd}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Stage output will appear here.
            </div>
          )}
        </section>
        <aside className="min-h-0 overflow-auto border-t border-border bg-muted/18 p-4 xl:border-t-0 xl:border-l">
          <TaskDetailRail
            environmentId={environmentId}
            gates={gates}
            project={project}
            stageThread={stageThread}
            stageThreadRef={stageThreadRef}
            taskId={taskId}
          />
        </aside>
      </main>
    </OrchestratorPage>
  );
}

export function TaskHeader({ task }: { task: OrchestratorTask }) {
  const [isCancelling, setIsCancelling] = useState(false);
  const canCancel = task.status !== "landed" && task.status !== "abandoned";
  const cancelTask = useCallback(async () => {
    const api = readEnvironmentApi(task.environmentId);
    if (!api || isCancelling || !canCancel) {
      return;
    }
    setIsCancelling(true);
    try {
      await confirmAndCancelTask({
        taskId: task.id,
        confirm: (message) => ensureLocalApi().dialogs.confirm(message),
        cancelTask: api.orchestrator.cancelTask,
      });
    } finally {
      setIsCancelling(false);
    }
  }, [canCancel, isCancelling, task.environmentId, task.id]);

  return (
    <div className="border-b border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{TASK_STATUS_LABELS[task.status]}</Badge>
          <Badge variant="outline">{task.type}</Badge>
          {task.branch ? (
            <Badge variant="outline">
              <GitBranchIcon className="size-3" />
              {task.branch}
            </Badge>
          ) : null}
          <TaskQuotaBadge
            environmentId={task.environmentId}
            taskId={task.id}
            status={task.status}
          />
        </div>
        <div className="flex items-center gap-2">
          {canCancel ? (
            <Button
              aria-label="Cancel task"
              disabled={isCancelling}
              onClick={() => void cancelTask()}
              size="sm"
              title="Cancel task"
              variant="destructive"
            >
              <XIcon className="size-4" />
              Cancel task
            </Button>
          ) : null}
          {task.status === "landed" ? <TaskPrLink prUrl={task.prUrl} /> : null}
        </div>
      </div>
      {task.worktreePath ? (
        <p className="mt-3 truncate text-xs text-muted-foreground">{task.worktreePath}</p>
      ) : null}
    </div>
  );
}

function TaskDetailRail({
  environmentId,
  gates,
  project,
  stageThread,
  stageThreadRef,
  taskId,
}: {
  environmentId: EnvironmentId;
  gates: OrchestratorPendingGate[];
  project: Project | undefined;
  stageThread: Thread | undefined;
  stageThreadRef: ScopedThreadRef | null;
  taskId: TaskId;
}) {
  return (
    <div className="space-y-4">
      <StageTimeline environmentId={environmentId} taskId={taskId} />
      <GatePanel environmentId={environmentId} gates={gates} taskId={taskId} />
      <StageProposedPlan
        environmentId={environmentId}
        project={project}
        stageThread={stageThread}
      />
      <TaskDiffPanel stageThreadRef={stageThreadRef} />
    </div>
  );
}

function StageProposedPlan({
  environmentId,
  project,
  stageThread,
}: {
  environmentId: EnvironmentId;
  project: Project | undefined;
  stageThread: Thread | undefined;
}) {
  const proposedPlan = stageThread?.proposedPlans.at(-1) ?? null;
  if (!proposedPlan) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Plan</h2>
        <p className="mt-3 text-sm text-muted-foreground">No proposed plan yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold text-muted-foreground uppercase">Plan</h2>
      <ProposedPlanCard
        cwd={stageThread?.worktreePath ?? project?.cwd}
        environmentId={environmentId}
        planMarkdown={proposedPlan.planMarkdown}
        workspaceRoot={stageThread?.worktreePath ?? project?.cwd}
      />
    </section>
  );
}

function TaskDiffPanel({ stageThreadRef }: { stageThreadRef: ScopedThreadRef | null }) {
  if (!stageThreadRef) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Diff</h2>
        <p className="mt-3 text-sm text-muted-foreground">No stage thread yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="px-1 text-xs font-semibold text-muted-foreground uppercase">Diff</h2>
      <div className="h-[32rem] min-h-0 overflow-hidden rounded-lg border border-border bg-background">
        <DiffWorkerPoolProvider>
          <Suspense
            fallback={
              <DiffPanelShell mode="sidebar" header={<span className="text-sm">Diff</span>}>
                <DiffPanelLoadingState label="Loading diff viewer..." />
              </DiffPanelShell>
            }
          >
            <LazyDiffPanel mode="sidebar" threadRef={stageThreadRef} />
          </Suspense>
        </DiffWorkerPoolProvider>
      </div>
    </section>
  );
}

function GatePanel({
  environmentId,
  gates,
  taskId,
}: {
  environmentId: EnvironmentId;
  gates: OrchestratorPendingGate[];
  taskId: TaskId;
}) {
  if (gates.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        No gates.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase">Gates</h2>
      {gates.map((gate) => (
        <GateCard key={gate.gateId} environmentId={environmentId} gate={gate} taskId={taskId} />
      ))}
    </div>
  );
}

function GateCard({
  environmentId,
  gate,
  taskId,
}: {
  environmentId: EnvironmentId;
  gate: OrchestratorPendingGate;
  taskId: TaskId;
}) {
  const [submitting, setSubmitting] = useState<OrchestrationGateDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resolved = gate.status === "resolved";
  const resolve = async (decision: OrchestrationGateDecision) => {
    const api = readEnvironmentApi(environmentId);
    if (!api || submitting !== null || resolved) {
      return;
    }
    setSubmitting(decision);
    setError(null);
    try {
      await api.orchestrator.resolveGate({
        taskId,
        gateId: GateId.make(gate.gateId),
        gate: gate.gate,
        approvedHash: gate.contentHash,
        decision,
      });
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : String(resolveError));
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold capitalize">{gate.gate}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{gate.contentHash}</p>
        </div>
        <Badge variant={resolved ? "success" : "warning"}>
          {resolved ? "Resolved" : "Pending"}
        </Badge>
      </div>
      {gate.decision ? (
        <div className="mt-3 flex items-center gap-2 text-sm">
          {gate.decision === "approved" ? (
            <CheckIcon className="size-4 text-success-foreground" />
          ) : (
            <CircleAlertIcon className="size-4 text-destructive" />
          )}
          <span className="capitalize">{gate.decision}</span>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      {!resolved ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            disabled={submitting !== null}
            onClick={() => void resolve("rejected")}
            size="sm"
            variant="outline"
          >
            <XIcon className="size-4" />
            Reject
          </Button>
          <Button disabled={submitting !== null} onClick={() => void resolve("approved")} size="sm">
            <CheckIcon className="size-4" />
            Approve
          </Button>
        </div>
      ) : null}
    </article>
  );
}
