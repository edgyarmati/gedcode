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
  ProviderInstanceId,
  type ProviderInteractionMode,
  TaskId,
  ThreadId,
  type OrchestrationGateDecision,
  type RuntimeMode,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  CheckIcon,
  CircleAlertIcon,
  ClockIcon,
  GitBranchIcon,
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
import { ChatComposer, type ChatComposerHandle } from "../chat/ChatComposer";
import { type ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { MessagesTimeline } from "../chat/MessagesTimeline";
import { ProposedPlanCard } from "../chat/ProposedPlanCard";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { type ComposerImageAttachment, useComposerDraftStore } from "../../composerDraftStore";
import { readEnvironmentApi } from "../../environmentApi";
import {
  retainOrchestratorProjectSubscription,
  retainOrchestratorTaskSubscription,
  retainThreadDetailSubscription,
} from "../../environments/runtime/service";
import {
  selectPendingGatesForTaskRef,
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectTaskByRef,
  selectTaskQuotaBlockByRef,
  selectTasksForProjectRef,
  selectThreadByRef,
  useStore,
  type ScopedTaskRef,
} from "../../store";
import {
  deriveTimelineEntries,
  deriveWorkLogEntries,
  type PendingApproval,
} from "../../session-logic";
import type { OrchestratorPendingGate, OrchestratorTask, Project, Thread } from "../../types";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../../types";
import { useSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useTurnDiffSummaries } from "../../hooks/useTurnDiffSummaries";
import type { TerminalContextDraft } from "../../lib/terminalContext";
import { useServerConfig, useServerKeybindings } from "../../rpc/serverState";

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
  review: "Review",
  verifying: "Verifying",
  working: "Working",
};

const BOARD_STATUSES: ReadonlyArray<OrchestratorTask["status"]> = [
  "draft",
  "classified",
  "planning",
  "plan-review",
  "working",
  "review",
  "blocked",
  "blocked-on-quota",
  "landed",
];

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
        <Button render={<Link to="/orch" />} size="sm" variant="outline">
          <ArrowLeftIcon className="size-4" />
          Projects
        </Button>
      </OrchestratorPageChrome>
      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-h-0 min-w-0 flex-col border-b border-border lg:border-r lg:border-b-0">
          <PmConversation
            environmentId={environmentId}
            project={project}
            projectId={projectId}
            thread={pmThread}
            threadRef={pmThreadRef}
          />
        </section>
        <TaskBoard environmentId={environmentId} projectId={projectId} tasks={tasks} />
      </main>
    </OrchestratorPage>
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
  return (
    <>
      <SharedThreadTimeline
        cwd={project?.cwd}
        emptyMessage="PM conversation will appear here."
        thread={thread}
        threadRef={threadRef}
        workspaceRoot={project?.cwd}
      />
      <PmChatComposer
        environmentId={environmentId}
        project={project}
        projectId={projectId}
        thread={thread}
        threadRef={threadRef}
      />
    </>
  );
}

function SharedThreadTimeline({
  cwd,
  emptyMessage,
  thread,
  threadRef,
  workspaceRoot,
}: {
  cwd: string | undefined;
  emptyMessage: string;
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessagesTimeline
        key={thread?.id ?? scopedThreadKey(threadRef)}
        activeThreadEnvironmentId={threadRef.environmentId}
        activeTurnInProgress={activeTurnInProgress}
        activeTurnStartedAt={thread?.latestTurn?.startedAt ?? null}
        isRevertingCheckpoint={false}
        isWorking={activeTurnInProgress}
        latestTurn={thread?.latestTurn ?? null}
        listRef={listRef}
        markdownCwd={cwd}
        onImageExpand={() => {}}
        onIsAtEndChange={() => {}}
        onOpenTurnDiff={() => {}}
        onRevertUserMessage={() => {}}
        resolvedTheme={resolvedTheme}
        revertTurnCountByUserMessageId={revertTurnCountByUserMessageId}
        routeThreadKey={scopedThreadKey(threadRef)}
        skills={[]}
        timestampFormat={settings.timestampFormat}
        timelineEntries={timelineEntries}
        turnDiffSummaryByAssistantMessageId={turnDiffSummaryByAssistantMessageId}
        workspaceRoot={workspaceRoot}
      />
      {timelineEntries.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : null}
    </div>
  );
}

function PmChatComposer({
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
  const settings = useSettings();
  const { resolvedTheme } = useTheme();
  const serverConfig = useServerConfig();
  const keybindings = useServerKeybindings();
  const clearComposerDraftContent = useComposerDraftStore((store) => store.clearComposerContent);
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setComposerDraftInteractionMode = useComposerDraftStore(
    (store) => store.setInteractionMode,
  );
  const setComposerDraftGedWorkflowEnabled = useComposerDraftStore(
    (store) => store.setGedWorkflowEnabled,
  );
  const promptRef = useRef("");
  const composerRef = useRef<ChatComposerHandle | null>(null);
  const composerImagesRef = useRef<ComposerImageAttachment[]>([]);
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([]);
  const shouldAutoScrollRef = useRef(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setThreadError = useCallback((_threadId: ThreadId | null, nextError: string | null) => {
    setError(nextError);
  }, []);
  const onSend = useCallback(
    (event?: { preventDefault: () => void }) => {
      event?.preventDefault();
      const trimmed = promptRef.current.trim();
      if (submitting || trimmed.length === 0) {
        return;
      }
      if (composerImagesRef.current.length > 0) {
        setError("PM messages in this slice support text only.");
        return;
      }
      const api = readEnvironmentApi(environmentId);
      if (!api) {
        setError("Environment API unavailable.");
        return;
      }
      setSubmitting(true);
      setError(null);
      void api.orchestrator
        .sendMessage({ projectId, message: trimmed })
        .then(() => {
          promptRef.current = "";
          clearComposerDraftContent(threadRef);
          composerRef.current?.resetCursorState();
        })
        .catch((sendError) => {
          setError(sendError instanceof Error ? sendError.message : String(sendError));
        })
        .then(() => {
          setSubmitting(false);
        });
    },
    [clearComposerDraftContent, environmentId, projectId, submitting, threadRef],
  );
  const handleRuntimeModeChange = useCallback(
    (mode: RuntimeMode) => {
      setComposerDraftRuntimeMode(threadRef, mode);
    },
    [setComposerDraftRuntimeMode, threadRef],
  );
  const handleInteractionModeChange = useCallback(
    (mode: ProviderInteractionMode) => {
      setComposerDraftInteractionMode(threadRef, mode);
    },
    [setComposerDraftInteractionMode, threadRef],
  );
  const handleModelSelect = useCallback(
    (instanceId: ProviderInstanceId, model: string) => {
      setComposerDraftModelSelection(threadRef, { instanceId, model });
    },
    [setComposerDraftModelSelection, threadRef],
  );
  const handleWorkflowToggle = useCallback(
    (enabled: boolean) => {
      setComposerDraftGedWorkflowEnabled(threadRef, enabled);
    },
    [setComposerDraftGedWorkflowEnabled, threadRef],
  );
  const focusComposer = useCallback(() => {
    composerRef.current?.focusAtEnd();
  }, []);
  const noop = useCallback(() => {}, []);
  const noopAsync = useCallback(async () => {}, []);
  const noopImage = useCallback((_preview: ExpandedImagePreview) => {}, []);

  return (
    <div className="border-t border-border px-3 pb-3 pt-2 sm:px-4">
      {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
      <ChatComposer
        activePendingApproval={null}
        activePendingDraftAnswers={{}}
        activePendingIsResponding={false}
        activePendingProgress={null}
        activePendingQuestionIndex={0}
        activePendingResolvedAnswers={null}
        activePlan={null}
        activeProjectDefaultModelSelection={project?.defaultModelSelection}
        activeProposedPlan={null}
        activeThread={thread}
        activeThreadActivities={thread?.activities}
        activeThreadEnvironmentId={environmentId}
        activeThreadId={thread?.id ?? null}
        activeThreadModelSelection={thread?.modelSelection}
        composerImagesRef={composerImagesRef}
        composerRef={composerRef}
        composerDraftTarget={threadRef}
        composerTerminalContextsRef={composerTerminalContextsRef}
        draftId={null}
        environmentId={environmentId}
        environmentUnavailable={
          readEnvironmentApi(environmentId)
            ? null
            : { label: "Environment", connectionState: "disconnected" }
        }
        focusComposer={focusComposer}
        getModelDisabledReason={() => null}
        gitCwd={project?.cwd ?? null}
        handleInteractionModeChange={handleInteractionModeChange}
        handleRuntimeModeChange={handleRuntimeModeChange}
        isConnecting={false}
        isLocalDraftThread={false}
        isPreparingWorktree={false}
        isSendBusy={submitting}
        isServerThread
        keybindings={keybindings}
        lockedProvider={null}
        onAdvanceActivePendingUserInput={noop}
        onChangeActivePendingUserInputCustomAnswer={noop}
        onExpandImage={noopImage}
        onImplementPlanInNewThread={noop}
        onInterrupt={noop}
        onPreviousActivePendingUserInputQuestion={noop}
        onProviderModelSelect={handleModelSelect}
        onRespondToApproval={noopAsync}
        onSelectActivePendingUserInputOption={noop}
        onSend={onSend}
        onToggleWorkflow={handleWorkflowToggle}
        pendingApprovals={[] as PendingApproval[]}
        pendingUserInputs={[]}
        phase={thread?.latestTurn?.state === "running" ? "running" : "ready"}
        planSidebarLabel="Plan"
        planSidebarOpen={false}
        promptRef={promptRef}
        providerStatuses={[...(serverConfig?.providers ?? [])]}
        resolvedTheme={resolvedTheme}
        respondingRequestIds={[]}
        routeKind="server"
        routeThreadRef={threadRef}
        runtimeMode={thread?.runtimeMode ?? DEFAULT_RUNTIME_MODE}
        scheduleComposerFocus={focusComposer}
        scheduleStickToBottom={noop}
        setThreadError={setThreadError}
        settings={settings}
        shouldAutoScrollRef={shouldAutoScrollRef}
        showPlanFollowUpPrompt={false}
        sidebarProposedPlan={null}
        terminalOpen={false}
        toggleInteractionMode={() => handleInteractionModeChange(DEFAULT_INTERACTION_MODE)}
        togglePlanSidebar={noop}
        workflowEnabled={thread?.gedWorkflowEnabled ?? false}
      />
    </div>
  );
}

function TaskBoard({
  environmentId,
  projectId,
  tasks,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  tasks: OrchestratorTask[];
}) {
  const taskCountByStatus = useMemo(() => {
    const counts = new Map<OrchestratorTask["status"], number>();
    for (const task of tasks) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    return counts;
  }, [tasks]);

  return (
    <aside className="min-h-0 overflow-auto bg-muted/18 px-3 py-4">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Tasks</h2>
        <Badge variant="outline">{tasks.length}</Badge>
      </div>
      <div className="space-y-4">
        {BOARD_STATUSES.map((status) => {
          const statusTasks = tasks.filter((task) => task.status === status);
          return (
            <section key={status} className="space-y-2">
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="text-xs font-medium text-muted-foreground">
                  {TASK_STATUS_LABELS[status]}
                </h3>
                <span className="text-[11px] text-muted-foreground/70">
                  {taskCountByStatus.get(status) ?? 0}
                </span>
              </div>
              {statusTasks.map((task) => (
                <TaskBoardCard
                  key={task.id}
                  environmentId={environmentId}
                  projectId={projectId}
                  task={task}
                />
              ))}
            </section>
          );
        })}
      </div>
    </aside>
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

function TaskBoardCard({
  environmentId,
  projectId,
  task,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  task: OrchestratorTask;
}) {
  return (
    <Link
      to="/orch/$environmentId/$projectId/tasks/$taskId"
      params={{ environmentId, projectId, taskId: task.id }}
      className="block rounded-lg border border-border bg-card px-3 py-2 text-card-foreground outline-hidden transition-colors hover:border-ring/50 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="line-clamp-2 text-sm font-medium">{task.title}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {task.branch ? (
          <Badge size="sm" variant="outline">
            <GitBranchIcon className="size-3" />
            {task.branch}
          </Badge>
        ) : null}
        {task.currentStageThreadId ? (
          <Badge size="sm" variant="info">
            <ClockIcon className="size-3" />
            Running
          </Badge>
        ) : null}
        <TaskQuotaBadge environmentId={environmentId} taskId={task.id} status={task.status} />
      </div>
    </Link>
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

function TaskHeader({ task }: { task: OrchestratorTask }) {
  return (
    <div className="border-b border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{TASK_STATUS_LABELS[task.status]}</Badge>
        <Badge variant="outline">{task.type}</Badge>
        {task.branch ? (
          <Badge variant="outline">
            <GitBranchIcon className="size-3" />
            {task.branch}
          </Badge>
        ) : null}
        <TaskQuotaBadge environmentId={task.environmentId} taskId={task.id} status={task.status} />
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
