import { scopedProjectKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { type OrchestrationGateKind } from "@t3tools/contracts";
import { Link, useParams } from "@tanstack/react-router";
import { CircleAlertIcon, FolderPlusIcon } from "lucide-react";
import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { ProjectFavicon } from "../ProjectFavicon";
import {
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  selectPendingGatesForTaskRef,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadSummaryByRef,
  selectTasksForProjectRef,
  useStore,
} from "../../store";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import type { Project } from "../../types";
import { type BoardTaskEntry, isStageRunning, partitionBoardTasks } from "./TaskBoard";

// Orchestrator-mode sidebar content. Replaces the chat thread list with a
// project list where each row carries compact task signals so the operator can
// triage across projects without opening every workspace: a needs-attention
// count (pending gates + blocked/quota), an active count, and a running pulse
// when any of the project's stage threads has a live session.
export const OrchestratorSidebarNav = memo(function OrchestratorSidebarNav() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const activeProjectKey = useParams({
    strict: false,
    select: (params) =>
      params.environmentId && params.projectId
        ? `${params.environmentId}:${params.projectId}`
        : null,
  });

  return (
    <SidebarContent className="gap-0">
      <SidebarGroup className="px-2 pt-3 pb-2">
        <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
            Projects
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Add project"
                  data-testid="orchestrator-sidebar-add-project-trigger"
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                  onClick={openAddProject}
                />
              }
            >
              <FolderPlusIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="right">Add project</TooltipPopup>
          </Tooltip>
        </div>
        <SidebarMenu>
          {projects.map((project) => {
            const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
            return (
              <OrchestratorSidebarProjectRow
                key={key}
                project={project}
                isActive={activeProjectKey === key}
              />
            );
          })}
        </SidebarMenu>
        {projects.length === 0 ? (
          <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
            No projects yet
          </div>
        ) : null}
      </SidebarGroup>
    </SidebarContent>
  );
});

const OrchestratorSidebarProjectRow = memo(function OrchestratorSidebarProjectRow({
  project,
  isActive,
}: {
  project: Project;
  isActive: boolean;
}) {
  const environmentId = project.environmentId;
  const projectId = project.id;
  const projectRef = useMemo(
    () => scopeProjectRef(environmentId, projectId),
    [environmentId, projectId],
  );
  const tasks = useStore(useShallow((state) => selectTasksForProjectRef(state, projectRef)));

  // Mirror TaskBoard: pending gates live per-task in the store, so project the
  // gate kinds down to a stable comma-joined string to avoid re-firing on every
  // unrelated store write.
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
    return partitionBoardTasks(entries);
  }, [pendingGateKindsByTaskId, tasks]);

  const needsYouCount = partition.needsYou.length;
  const activeCount = partition.active.length;

  const running = useStore((state) =>
    tasks.some((task) => {
      const stageThreadId = task.currentStageThreadId;
      if (!stageThreadId) {
        return false;
      }
      return isStageRunning(
        selectSidebarThreadSummaryByRef(state, scopeThreadRef(environmentId, stageThreadId)),
      );
    }),
  );

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        isActive={isActive}
        render={
          <Link
            to="/orch/$environmentId/$projectId"
            params={{ environmentId, projectId }}
            data-testid={`orchestrator-project-row-${projectId}`}
          />
        }
        className="gap-2 px-2 py-1.5 text-left hover:bg-accent"
      >
        <ProjectFavicon environmentId={environmentId} cwd={project.cwd} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
          {project.name}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {running ? <RunningPulse /> : null}
          {needsYouCount > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label={`${needsYouCount} needs attention`}
                    className="inline-flex h-4 min-w-4 items-center justify-center gap-0.5 rounded-full bg-warning/12 px-1 text-[10px] font-medium tabular-nums text-warning-foreground dark:bg-warning/20"
                  />
                }
              >
                <CircleAlertIcon className="size-2.5 text-warning" />
                {needsYouCount}
              </TooltipTrigger>
              <TooltipPopup side="top">{needsYouCount} needs attention</TooltipPopup>
            </Tooltip>
          ) : null}
          {activeCount > 0 ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    aria-label={`${activeCount} active`}
                    className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-border/80 px-1 text-[10px] font-medium tabular-nums text-muted-foreground"
                  />
                }
              >
                {activeCount}
              </TooltipTrigger>
              <TooltipPopup side="top">{activeCount} active</TooltipPopup>
            </Tooltip>
          ) : null}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

function RunningPulse() {
  return (
    <span aria-label="Running" className="relative flex size-2 shrink-0" title="Running">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-info/60" />
      <span className="relative inline-flex size-2 rounded-full bg-info" />
    </span>
  );
}
