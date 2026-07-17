import { scopeThreadRef } from "@t3tools/client-runtime";
import {
  type ContextMenuItem,
  type EnvironmentId,
  type OrchestrationGateKind,
  type ProjectId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  BanIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  ClockIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { cn } from "~/lib/utils";
import { readEnvironmentApi } from "../../environmentApi";
import { readLocalApi } from "../../localApi";
import {
  selectPendingGatesForTaskRef,
  selectSidebarThreadSummaryByRef,
  selectThreadShellByRef,
  useStore,
} from "../../store";
import type { OrchestratorTask, SidebarThreadSummary } from "../../types";

// ---------------------------------------------------------------------------
// Pure bucketing / labelling helpers (exported for unit tests).
// ---------------------------------------------------------------------------

// Non-terminal, non-needs-you statuses that live in the single "Active" bucket.
const ACTIVE_STATUSES: ReadonlySet<OrchestratorTask["status"]> = new Set([
  "draft",
  "classified",
  "planning",
  "plan-review",
  "reviewing",
  "working",
  "review",
  "verifying",
]);

// Status → stage-role label shown on an active card. `draft`/`classified` have
// not reached a real stage yet, so they read as "Starting…".
const ACTIVE_STAGE_LABELS: Record<string, string> = {
  draft: "Starting…",
  classified: "Starting…",
  planning: "Planning",
  "plan-review": "Plan review",
  reviewing: "Reviewing",
  working: "Working",
  review: "Review",
  verifying: "Verifying",
};

export function activeStageLabel(status: OrchestratorTask["status"]): string {
  return ACTIVE_STAGE_LABELS[status] ?? "Active";
}

export type NeedsYouReason =
  | { readonly kind: "gate"; readonly gate: OrchestrationGateKind }
  | { readonly kind: "change-review" }
  | { readonly kind: "blocked" }
  | { readonly kind: "quota" }
  | { readonly kind: "landing-failed" };

export interface BoardTaskEntry {
  readonly task: OrchestratorTask;
  readonly pendingGateKinds: readonly OrchestrationGateKind[];
}

// A pending approval gate always outranks a blocked status; either way the
// human is the thing standing between the task and progress.
export function needsYouReason(entry: BoardTaskEntry): NeedsYouReason | null {
  const gate = entry.pendingGateKinds[0];
  if (gate) {
    return { kind: "gate", gate };
  }
  if (entry.task.status === "blocked") {
    return { kind: "blocked" };
  }
  if (entry.task.status === "change-review") {
    return { kind: "change-review" };
  }
  if (entry.task.status === "blocked-on-quota") {
    return { kind: "quota" };
  }
  if (entry.task.landing?.status === "failed") {
    return { kind: "landing-failed" };
  }
  return null;
}

export function needsYouReasonLabel(reason: NeedsYouReason): string {
  switch (reason.kind) {
    case "blocked":
      return "Blocked";
    case "quota":
      return "Quota";
    case "landing-failed":
      return "Landing failed";
    case "change-review":
      return "Review changes";
    case "gate":
      return `Awaiting ${reason.gate} approval`;
  }
}

export interface NeedsYouItem {
  readonly entry: BoardTaskEntry;
  readonly reason: NeedsYouReason;
}

export interface BoardTaskGroup {
  readonly parent: BoardTaskEntry;
  readonly children: readonly BoardTaskEntry[];
}

export interface NeedsYouGroupItem {
  readonly group: BoardTaskGroup;
  readonly reason: NeedsYouReason;
  readonly attentionTaskId: OrchestratorTask["id"];
}

export interface BoardGroupPartition {
  readonly needsYou: readonly NeedsYouGroupItem[];
  readonly active: readonly BoardTaskGroup[];
  readonly landed: readonly BoardTaskGroup[];
  readonly abandoned: readonly BoardTaskGroup[];
}

export interface BoardPartition {
  readonly needsYou: readonly NeedsYouItem[];
  readonly active: readonly OrchestratorTask[];
  readonly landed: readonly OrchestratorTask[];
  readonly abandoned: readonly OrchestratorTask[];
}

export function taskContextMenuItems(
  task: Pick<OrchestratorTask, "status" | "cancellation">,
  archived: boolean,
): ContextMenuItem<string>[] {
  const items: ContextMenuItem<string>[] = [{ id: "copy-task-id", label: "Copy task ID" }];
  if (archived) {
    items.push(
      { id: "restore-task", label: "Restore task" },
      { id: "delete-task", label: "Delete task permanently", destructive: true },
    );
    return items;
  }
  if (
    task.status === "landed" ||
    task.status === "abandoned" ||
    task.status === "no-changes-needed"
  ) {
    items.push(
      { id: "archive-task", label: "Archive task" },
      { id: "delete-task", label: "Delete task permanently", destructive: true },
    );
    return items;
  }
  if (task.cancellation == null) {
    items.push({ id: "cancel-task", label: "Cancel task", destructive: true });
  }
  return items;
}

export function partitionBoardTasks(entries: readonly BoardTaskEntry[]): BoardPartition {
  const needsYou: NeedsYouItem[] = [];
  const active: OrchestratorTask[] = [];
  const landed: OrchestratorTask[] = [];
  const abandoned: OrchestratorTask[] = [];
  for (const entry of entries) {
    const reason = needsYouReason(entry);
    if (reason) {
      needsYou.push({ entry, reason });
      continue;
    }
    const status = entry.task.status;
    if (status === "landed") {
      if (entry.task.landing?.status === "opening-pr") {
        active.push(entry.task);
      } else {
        landed.push(entry.task);
      }
    } else if (status === "no-changes-needed") {
      landed.push(entry.task);
    } else if (status === "abandoned") {
      abandoned.push(entry.task);
    } else if (ACTIVE_STATUSES.has(status)) {
      active.push(entry.task);
    }
  }
  return { needsYou, active, landed, abandoned };
}

function compareChildEntries(left: BoardTaskEntry, right: BoardTaskEntry): number {
  const leftOrder = left.task.childOrder ?? Number.MAX_SAFE_INTEGER;
  const rightOrder = right.task.childOrder ?? Number.MAX_SAFE_INTEGER;
  return (
    leftOrder - rightOrder ||
    left.task.createdAt.localeCompare(right.task.createdAt) ||
    String(left.task.id).localeCompare(String(right.task.id))
  );
}

export function groupBoardTaskEntries(
  entries: readonly BoardTaskEntry[],
): readonly BoardTaskGroup[] {
  const taskIds = new Set(entries.map((entry) => String(entry.task.id)));
  const childrenByParentId = new Map<string, BoardTaskEntry[]>();
  for (const entry of entries) {
    const parentTaskId = entry.task.parentTaskId ?? null;
    if (parentTaskId === null || !taskIds.has(String(parentTaskId))) {
      continue;
    }
    const children = childrenByParentId.get(String(parentTaskId)) ?? [];
    children.push(entry);
    childrenByParentId.set(String(parentTaskId), children);
  }

  return entries
    .filter((entry) => {
      const parentTaskId = entry.task.parentTaskId ?? null;
      return parentTaskId === null || !taskIds.has(String(parentTaskId));
    })
    .map((parent) => ({
      parent,
      children: (childrenByParentId.get(String(parent.task.id)) ?? []).toSorted(
        compareChildEntries,
      ),
    }));
}

function isActiveBoardTask(task: OrchestratorTask): boolean {
  return (
    ACTIVE_STATUSES.has(task.status) ||
    (task.status === "landed" && task.landing?.status === "opening-pr")
  );
}

function isSuccessfulTerminalTask(task: OrchestratorTask): boolean {
  return task.status === "landed" || task.status === "no-changes-needed";
}

export function partitionBoardTaskGroups(groups: readonly BoardTaskGroup[]): BoardGroupPartition {
  const needsYou: NeedsYouGroupItem[] = [];
  const active: BoardTaskGroup[] = [];
  const landed: BoardTaskGroup[] = [];
  const abandoned: BoardTaskGroup[] = [];

  for (const group of groups) {
    const members = [group.parent, ...group.children];
    const attention = members
      .map((entry) => ({ entry, reason: needsYouReason(entry) }))
      .find(
        (candidate): candidate is { entry: BoardTaskEntry; reason: NeedsYouReason } =>
          candidate.reason !== null,
      );
    if (attention) {
      needsYou.push({
        group,
        reason: attention.reason,
        attentionTaskId: attention.entry.task.id,
      });
      continue;
    }

    if (group.children.length === 0) {
      const status = group.parent.task.status;
      if (
        (status === "landed" && group.parent.task.landing?.status !== "opening-pr") ||
        status === "no-changes-needed"
      ) {
        landed.push(group);
      } else if (status === "abandoned") {
        abandoned.push(group);
      } else if (isActiveBoardTask(group.parent.task)) {
        active.push(group);
      }
      continue;
    }

    if (group.children.some((child) => isActiveBoardTask(child.task))) {
      active.push(group);
      continue;
    }
    if (group.children.every((child) => isSuccessfulTerminalTask(child.task))) {
      landed.push(group);
      continue;
    }
    if (
      group.children.every(
        (child) => isSuccessfulTerminalTask(child.task) || child.task.status === "abandoned",
      )
    ) {
      abandoned.push(group);
      continue;
    }
    active.push(group);
  }

  return { needsYou, active, landed, abandoned };
}

// Elapsed wall-clock for a running turn, coarse-grained for a compact chip.
export function formatElapsed(startedAt: string, nowMs: number): string | null {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) {
    return null;
  }
  const totalSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function isStageRunning(summary: SidebarThreadSummary | undefined): boolean {
  if (!summary) {
    return false;
  }
  return summary.session?.status === "running" || summary.latestTurn?.state === "running";
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export function TaskBoard({
  environmentId,
  projectId,
  tasks,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  tasks: OrchestratorTask[];
}) {
  const [landedExpanded, setLandedExpanded] = useState(false);
  const [abandonedExpanded, setAbandonedExpanded] = useState(false);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [archivedTasks, setArchivedTasks] = useState<OrchestratorTask[]>([]);

  const refreshArchivedTasks = useCallback(async () => {
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      return;
    }
    const retained = await api.orchestrator.listArchivedTasks({ projectId });
    setArchivedTasks(retained.map((task) => Object.assign({ environmentId }, task)));
  }, [environmentId, projectId]);

  const activeTaskMembership = tasks.map((task) => task.id).join("|");
  useEffect(() => {
    void refreshArchivedTasks().catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to load archived tasks",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    });
  }, [activeTaskMembership, refreshArchivedTasks]);

  const handleTaskContextMenu = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask, archived: boolean) => {
      event.preventDefault();
      void (async () => {
        const localApi = readLocalApi();
        const environmentApi = readEnvironmentApi(environmentId);
        if (!localApi || !environmentApi) {
          return;
        }
        const items = taskContextMenuItems(task, archived);
        const selected = await localApi.contextMenu.show(items, {
          x: event.clientX,
          y: event.clientY,
        });
        if (selected === "copy-task-id") {
          await navigator.clipboard.writeText(String(task.id));
          toastManager.add(stackedThreadToast({ type: "success", title: "Copied task ID" }));
          return;
        }
        if (selected === "cancel-task") {
          await environmentApi.orchestrator.cancelTask({ taskId: task.id });
        } else if (selected === "delete-task") {
          const confirmed = window.confirm(
            `Permanently delete “${task.title}” from the task ledger? Its append-only event history will remain for audit, but the task cannot be restored.`,
          );
          if (!confirmed) {
            return;
          }
          await environmentApi.orchestrator.deleteTask({ taskId: task.id });
        } else if (selected === "archive-task") {
          await environmentApi.orchestrator.archiveTask({ taskId: task.id });
        } else if (selected === "restore-task") {
          await environmentApi.orchestrator.restoreTask({ taskId: task.id });
        } else {
          return;
        }
        if (selected !== "cancel-task") {
          await refreshArchivedTasks();
        }
        toastManager.add(
          stackedThreadToast({
            type: "success",
            title:
              selected === "cancel-task"
                ? "Task cancellation requested"
                : selected === "archive-task"
                  ? "Task archived"
                  : selected === "restore-task"
                    ? "Task restored"
                    : "Task deleted",
          }),
        );
      })().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Task context action failed",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
    },
    [environmentId, refreshArchivedTasks],
  );

  // Pending gates live in the store (per task), not on the task object. Project
  // each task's gate kinds down to a stable comma-joined string so the shallow
  // selector doesn't re-fire on every unrelated store write.
  const pendingGateKindsByTaskId = useStore(
    useShallow((state) => {
      const result: Record<string, string> = {};
      for (const task of tasks) {
        const gates = selectPendingGatesForTaskRef(state, { environmentId, taskId: task.id });
        if (gates.length > 0) {
          result[String(task.id)] = gates.map((gate) => gate.gate).join(",");
        }
      }
      return result;
    }),
  );

  const partition = useMemo(() => {
    const entries: BoardTaskEntry[] = tasks.map((task) => {
      const joined = pendingGateKindsByTaskId[String(task.id)];
      return {
        task,
        pendingGateKinds: joined ? (joined.split(",") as OrchestrationGateKind[]) : [],
      };
    });
    return partitionBoardTaskGroups(groupBoardTaskEntries(entries));
  }, [pendingGateKindsByTaskId, tasks]);

  const headerCount = partition.needsYou.length + partition.active.length;
  const isEmpty =
    headerCount === 0 &&
    partition.landed.length === 0 &&
    partition.abandoned.length === 0 &&
    archivedTasks.length === 0;

  return (
    <aside className="min-h-0 overflow-auto bg-muted/18 px-3 py-3">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <h2 className="text-xs font-semibold text-muted-foreground">Tasks</h2>
        <Badge aria-label="Board task count" variant="outline">
          {headerCount}
        </Badge>
      </div>
      <div className="space-y-5">
        {partition.needsYou.length > 0 ? (
          <NeedsYouSection
            environmentId={environmentId}
            items={partition.needsYou}
            onTaskContextMenu={(event, task) => handleTaskContextMenu(event, task, false)}
            projectId={projectId}
          />
        ) : null}
        {partition.active.length > 0 ? (
          <ActiveSection
            environmentId={environmentId}
            onTaskContextMenu={(event, task) => handleTaskContextMenu(event, task, false)}
            projectId={projectId}
            tasks={partition.active}
          />
        ) : null}
        {partition.landed.length > 0 ? (
          <CollapsibleTaskSection
            countAriaLabel="Landed task count"
            environmentId={environmentId}
            expanded={landedExpanded}
            label="Landed"
            onExpandedChange={setLandedExpanded}
            projectId={projectId}
            tasks={partition.landed}
            onTaskContextMenu={(event, task) => handleTaskContextMenu(event, task, false)}
          />
        ) : null}
        {partition.abandoned.length > 0 ? (
          <CollapsibleTaskSection
            countAriaLabel="Abandoned task count"
            environmentId={environmentId}
            expanded={abandonedExpanded}
            label="Abandoned"
            onExpandedChange={setAbandonedExpanded}
            projectId={projectId}
            tasks={partition.abandoned}
            onTaskContextMenu={(event, task) => handleTaskContextMenu(event, task, false)}
          />
        ) : null}
        {archivedTasks.length > 0 ? (
          <CollapsibleTaskSection
            countAriaLabel="Archived task count"
            environmentId={environmentId}
            expanded={archivedExpanded}
            label="Archived"
            onExpandedChange={setArchivedExpanded}
            projectId={projectId}
            tasks={archivedTasks.map((task) => ({
              parent: { task, pendingGateKinds: [] },
              children: [],
            }))}
            onTaskContextMenu={(event, task) => handleTaskContextMenu(event, task, true)}
          />
        ) : null}
        {isEmpty ? <p className="px-1 text-xs text-muted-foreground">No tasks yet.</p> : null}
      </div>
    </aside>
  );
}

function SectionHeading({
  children,
  count,
  countAriaLabel,
  icon,
  tone = "muted",
}: {
  children: ReactNode;
  count: number;
  countAriaLabel?: string;
  icon?: ReactNode;
  tone?: "muted" | "attention";
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <h3
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold",
          tone === "attention" ? "text-warning-foreground" : "text-muted-foreground",
        )}
      >
        {icon}
        {children}
      </h3>
      <span
        aria-label={countAriaLabel}
        className="text-[11px] tabular-nums text-muted-foreground/70"
      >
        {count}
      </span>
    </div>
  );
}

function NeedsYouSection({
  environmentId,
  items,
  onTaskContextMenu,
  projectId,
}: {
  environmentId: EnvironmentId;
  items: readonly NeedsYouGroupItem[];
  onTaskContextMenu: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
  projectId: ProjectId;
}) {
  return (
    <section className="space-y-2">
      <SectionHeading
        count={items.length}
        countAriaLabel="Needs you task count"
        icon={<CircleAlertIcon className="size-3.5 text-warning" />}
        tone="attention"
      >
        Needs you
      </SectionHeading>
      <div className="space-y-2">
        {items.map(({ attentionTaskId, group, reason }) => (
          <TaskGroupCard
            key={group.parent.task.id}
            attentionTaskId={attentionTaskId}
            environmentId={environmentId}
            group={group}
            onContextMenu={onTaskContextMenu}
            projectId={projectId}
            reason={reason}
            tone="attention"
          />
        ))}
      </div>
    </section>
  );
}

function ActiveSection({
  environmentId,
  onTaskContextMenu,
  projectId,
  tasks,
}: {
  environmentId: EnvironmentId;
  onTaskContextMenu: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
  projectId: ProjectId;
  tasks: readonly BoardTaskGroup[];
}) {
  return (
    <section className="space-y-2">
      <SectionHeading count={tasks.length} countAriaLabel="Active task count">
        Active
      </SectionHeading>
      <div className="space-y-2">
        {tasks.map((group) => (
          <TaskGroupCard
            key={group.parent.task.id}
            environmentId={environmentId}
            group={group}
            onContextMenu={onTaskContextMenu}
            projectId={projectId}
            tone="active"
          />
        ))}
      </div>
    </section>
  );
}

export function AbandonedTaskBoardSection({
  environmentId,
  expanded,
  onExpandedChange,
  projectId,
  tasks,
  onTaskContextMenu,
}: {
  environmentId: EnvironmentId;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  projectId: ProjectId;
  tasks: readonly OrchestratorTask[];
  onTaskContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
}) {
  return (
    <CollapsibleTaskSection
      countAriaLabel="Abandoned task count"
      environmentId={environmentId}
      expanded={expanded}
      label="Abandoned"
      onExpandedChange={onExpandedChange}
      projectId={projectId}
      tasks={tasks.map((task) => ({
        parent: { task, pendingGateKinds: [] },
        children: [],
      }))}
      {...(onTaskContextMenu ? { onTaskContextMenu } : {})}
    />
  );
}

function CollapsibleTaskSection({
  countAriaLabel,
  environmentId,
  expanded,
  label,
  onExpandedChange,
  projectId,
  tasks,
  onTaskContextMenu,
}: {
  countAriaLabel: string;
  environmentId: EnvironmentId;
  expanded: boolean;
  label: string;
  onExpandedChange: (expanded: boolean) => void;
  projectId: ProjectId;
  tasks: readonly BoardTaskGroup[];
  onTaskContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
}) {
  return (
    <section className="space-y-2 border-t border-border/70 pt-3">
      <Button
        aria-expanded={expanded}
        className="h-auto w-full justify-between px-1 py-1 text-xs font-medium text-muted-foreground"
        onClick={() => onExpandedChange(!expanded)}
        size="sm"
        variant="ghost"
      >
        <span className="flex min-w-0 items-center gap-1">
          {expanded ? (
            <ChevronDownIcon className="size-3" />
          ) : (
            <ChevronRightIcon className="size-3" />
          )}
          <span>{label}</span>
        </span>
        <span
          aria-label={countAriaLabel}
          className="text-[11px] tabular-nums text-muted-foreground/70"
        >
          {tasks.length}
        </span>
      </Button>
      {expanded ? (
        <div className="space-y-2">
          {tasks.map((group) => (
            <TaskGroupCard
              key={group.parent.task.id}
              environmentId={environmentId}
              group={group}
              projectId={projectId}
              tone="terminal"
              {...(onTaskContextMenu ? { onContextMenu: onTaskContextMenu } : {})}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function taskGroupProgress(group: BoardTaskGroup): {
  readonly total: number;
  readonly terminal: number;
  readonly landed: number;
} {
  const projected = group.parent.task.aggregateProgress;
  if (projected) {
    return projected;
  }
  return {
    total: group.children.length,
    terminal: group.children.filter(
      (child) => isSuccessfulTerminalTask(child.task) || child.task.status === "abandoned",
    ).length,
    landed: group.children.filter((child) => child.task.status === "landed").length,
  };
}

function TaskGroupCard({
  attentionTaskId,
  environmentId,
  group,
  onContextMenu,
  projectId,
  reason,
  tone,
}: {
  attentionTaskId?: OrchestratorTask["id"];
  environmentId: EnvironmentId;
  group: BoardTaskGroup;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
  projectId: ProjectId;
  reason?: NeedsYouReason;
  tone: "attention" | "active" | "terminal";
}) {
  const [expanded, setExpanded] = useState(false);
  const parent = group.parent.task;

  if (group.children.length === 0) {
    if (tone === "attention" && reason) {
      return (
        <NeedsYouCard
          environmentId={environmentId}
          projectId={projectId}
          reason={reason}
          task={parent}
          {...(onContextMenu ? { onContextMenu } : {})}
        />
      );
    }
    if (tone === "active") {
      return (
        <ActiveTaskCard
          environmentId={environmentId}
          projectId={projectId}
          task={parent}
          {...(onContextMenu ? { onContextMenu } : {})}
        />
      );
    }
    return (
      <TerminalTaskCard
        environmentId={environmentId}
        projectId={projectId}
        task={parent}
        {...(onContextMenu ? { onContextMenu } : {})}
      />
    );
  }

  const progress = taskGroupProgress(group);
  const toggleLabel = `${expanded ? "Collapse" : "Expand"} ${parent.title} children`;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-card text-card-foreground",
        tone === "attention"
          ? "border-warning/30 bg-warning/8 dark:bg-warning/16"
          : "border-border",
      )}
    >
      <div className="flex items-stretch">
        <Button
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className="h-auto shrink-0 rounded-none px-2 text-muted-foreground"
          onClick={() => setExpanded(!expanded)}
          size="icon-sm"
          title={toggleLabel}
          variant="ghost"
        >
          {expanded ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </Button>
        <Link
          className="min-w-0 flex-1 px-1 py-2 pr-3 outline-hidden hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          params={{ environmentId, projectId, taskId: parent.id }}
          title={parent.title}
          to="/orch/$environmentId/$projectId/tasks/$taskId"
          onContextMenu={onContextMenu ? (event) => onContextMenu(event, parent) : undefined}
        >
          <div className="line-clamp-2 text-sm font-medium">{parent.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge size="sm" variant="outline">
              {progress.terminal}/{progress.total} complete
            </Badge>
            {tone === "attention" && reason ? (
              <Badge size="sm" variant="warning">
                <NeedsYouReasonIcon reason={reason} />
                {attentionTaskId === parent.id
                  ? needsYouReasonLabel(reason)
                  : "Child needs attention"}
              </Badge>
            ) : null}
            {progress.total > 0 && progress.landed === progress.total ? (
              <Badge size="sm" variant="secondary">
                All landed
              </Badge>
            ) : null}
          </div>
        </Link>
      </div>
      {expanded ? (
        <ol className="space-y-2 border-t border-border/70 bg-muted/15 px-2 py-2">
          {group.children.map((child, index) => (
            <li key={child.task.id} className="relative pl-4">
              <span
                aria-hidden="true"
                className="absolute top-3 left-0 text-[10px] tabular-nums text-muted-foreground"
              >
                {index + 1}
              </span>
              <GroupedChildTaskCard
                entry={child}
                environmentId={environmentId}
                projectId={projectId}
                {...(onContextMenu ? { onContextMenu } : {})}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function GroupedChildTaskCard({
  entry,
  environmentId,
  onContextMenu,
  projectId,
}: {
  entry: BoardTaskEntry;
  environmentId: EnvironmentId;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
  projectId: ProjectId;
}) {
  const reason = needsYouReason(entry);
  if (reason) {
    return (
      <NeedsYouCard
        environmentId={environmentId}
        projectId={projectId}
        reason={reason}
        task={entry.task}
        {...(onContextMenu ? { onContextMenu } : {})}
      />
    );
  }
  if (isActiveBoardTask(entry.task)) {
    return (
      <ActiveTaskCard
        environmentId={environmentId}
        projectId={projectId}
        task={entry.task}
        {...(onContextMenu ? { onContextMenu } : {})}
      />
    );
  }
  return (
    <TerminalTaskCard
      environmentId={environmentId}
      projectId={projectId}
      task={entry.task}
      {...(onContextMenu ? { onContextMenu } : {})}
    />
  );
}

function TaskCardLink({
  children,
  className,
  environmentId,
  projectId,
  task,
  onContextMenu,
}: {
  children: ReactNode;
  className?: string;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  task: OrchestratorTask;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
}) {
  return (
    <Link
      to="/orch/$environmentId/$projectId/tasks/$taskId"
      params={{ environmentId, projectId, taskId: task.id }}
      title={task.branch ? `${task.title} · ${task.branch}` : task.title}
      className={cn(
        "block rounded-lg border px-3 py-2 text-card-foreground outline-hidden transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        className ?? "border-border bg-card hover:border-ring/50 hover:bg-accent/40",
      )}
      onContextMenu={onContextMenu ? (event) => onContextMenu(event, task) : undefined}
    >
      {children}
    </Link>
  );
}

function NeedsYouCard({
  environmentId,
  onContextMenu,
  projectId,
  reason,
  task,
}: {
  environmentId: EnvironmentId;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
  projectId: ProjectId;
  reason: NeedsYouReason;
  task: OrchestratorTask;
}) {
  return (
    <TaskCardLink
      environmentId={environmentId}
      projectId={projectId}
      task={task}
      className="border-warning/30 bg-warning/8 hover:border-warning/55 hover:bg-warning/12 dark:bg-warning/16 dark:hover:bg-warning/20"
      {...(onContextMenu ? { onContextMenu } : {})}
    >
      <div className="line-clamp-2 text-sm font-medium">{task.title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge size="sm" variant="warning">
          <NeedsYouReasonIcon reason={reason} />
          {needsYouReasonLabel(reason)}
        </Badge>
      </div>
    </TaskCardLink>
  );
}

function NeedsYouReasonIcon({ reason }: { reason: NeedsYouReason }) {
  if (reason.kind === "blocked") {
    return <BanIcon className="size-3" />;
  }
  if (reason.kind === "quota") {
    return <ClockIcon className="size-3" />;
  }
  return <CircleAlertIcon className="size-3" />;
}

function ActiveTaskCard({
  environmentId,
  onContextMenu,
  projectId,
  task,
}: {
  environmentId: EnvironmentId;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
  projectId: ProjectId;
  task: OrchestratorTask;
}) {
  const stageThreadId = task.currentStageThreadId;
  const threadRef = useMemo(
    () => (stageThreadId ? scopeThreadRef(environmentId, stageThreadId) : null),
    [environmentId, stageThreadId],
  );
  const summary = useStore((state) =>
    threadRef ? selectSidebarThreadSummaryByRef(state, threadRef) : undefined,
  );
  const shell = useStore((state) =>
    threadRef ? selectThreadShellByRef(state, threadRef) : undefined,
  );

  const running = isStageRunning(summary);
  const runningStartedAt =
    running && summary?.latestTurn?.state === "running" ? summary.latestTurn.startedAt : null;
  const model = shell?.modelSelection.model ?? null;

  return (
    <TaskCardLink
      environmentId={environmentId}
      projectId={projectId}
      task={task}
      {...(onContextMenu ? { onContextMenu } : {})}
    >
      <div className="flex items-start gap-2">
        {running ? <LivePulse /> : null}
        <div className="line-clamp-2 text-sm font-medium">{task.title}</div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge size="sm" variant="outline">
          {activeStageLabel(task.status)}
        </Badge>
        {task.supersedesTaskId ? (
          <Badge size="sm" variant="secondary">
            Replacement
          </Badge>
        ) : null}
        {runningStartedAt ? <RunningElapsed startedAt={runningStartedAt} /> : null}
        {model ? (
          <Badge size="sm" variant="secondary">
            {model}
          </Badge>
        ) : null}
      </div>
    </TaskCardLink>
  );
}

function TerminalTaskCard({
  environmentId,
  projectId,
  task,
  onContextMenu,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  task: OrchestratorTask;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>, task: OrchestratorTask) => void;
}) {
  return (
    <TaskCardLink
      environmentId={environmentId}
      projectId={projectId}
      task={task}
      {...(onContextMenu ? { onContextMenu } : {})}
    >
      <div className="line-clamp-2 text-sm font-medium text-muted-foreground">{task.title}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Badge size="sm" variant="outline">
          {task.status === "no-changes-needed"
            ? "No changes needed"
            : task.status === "landed"
              ? "Landed"
              : "Abandoned"}
        </Badge>
      </div>
      {task.supersededByTaskId ? (
        <div className="mt-1 text-[11px] text-muted-foreground">Superseded</div>
      ) : null}
    </TaskCardLink>
  );
}

function LivePulse() {
  return (
    <span aria-label="Running" className="relative mt-1 flex size-2 shrink-0" title="Running">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-info/60" />
      <span className="relative inline-flex size-2 rounded-full bg-info" />
    </span>
  );
}

function RunningElapsed({ startedAt }: { startedAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const label = formatElapsed(startedAt, nowMs);
  if (!label) {
    return null;
  }
  return (
    <Badge size="sm" variant="info">
      <ClockIcon className="size-3" />
      {label}
    </Badge>
  );
}
