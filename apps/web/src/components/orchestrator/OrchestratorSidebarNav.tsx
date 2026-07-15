import { scopedProjectKey, scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { ProjectId, type ContextMenuItem, type OrchestrationGateKind } from "@t3tools/contracts";
import type { SidebarProjectSortOrder } from "@t3tools/contracts/settings";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowUpDownIcon, CircleAlertIcon, FolderPlusIcon, GripVerticalIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

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
  selectSidebarThreadsAcrossEnvironments,
  selectSidebarThreadSummaryByRef,
  selectTasksForProjectRef,
  useStore,
} from "../../store";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { readLocalApi } from "../../localApi";
import { readEnvironmentApi } from "../../environmentApi";
import { getProjectOrderKey } from "../../logicalProject";
import { newCommandId } from "../../lib/utils";
import type { Project } from "../../types";
import { useUiStateStore } from "../../uiStateStore";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import {
  orderItemsByPreferredIds,
  SIDEBAR_PROJECT_SORT_LABELS,
  sortProjectsForSidebar,
} from "../Sidebar.logic";
import { isOrchestratorManagedThread } from "../../lib/orchestratorThreads";
import { ProjectOrchestrationSettingsDialog } from "./ProjectOrchestrationSettingsDialog";
import { type BoardTaskEntry, isStageRunning, partitionBoardTasks } from "./TaskBoard";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

export function orchestratorProjectContextMenuItems(canRemove: boolean): ContextMenuItem<string>[] {
  return [
    { id: "rename-project", label: "Rename project" },
    { id: "orchestration-settings", label: "Orchestration settings…" },
    { id: "copy-path", label: "Copy Project Path" },
    {
      id: "remove-project",
      label: "Remove project",
      destructive: true,
      ...(!canRemove ? { disabled: true } : {}),
    },
  ];
}

// Orchestrator-mode sidebar content. Replaces the chat thread list with a
// project list where each row carries compact task signals so the operator can
// triage across projects without opening every workspace: a needs-attention
// count (pending gates + blocked/quota), an active count, and a running pulse
// when any of the project's stage threads has a live session.
export const OrchestratorSidebarNav = memo(function OrchestratorSidebarNav() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const projectSortOrder = useSettings((settings) => settings.sidebarProjectSortOrder);
  const { updateSettings } = useUpdateSettings();
  const openAddProject = useCommandPaletteStore((store) => store.openAddProject);
  const [orchestrationSettingsTarget, setOrchestrationSettingsTarget] = useState<Project | null>(
    null,
  );
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const activeProjectKey = useParams({
    strict: false,
    select: (params) =>
      params.environmentId && params.projectId
        ? `${params.environmentId}:${params.projectId}`
        : null,
  });
  const manuallyOrderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projectOrder, projects],
  );
  const sortedProjects = useMemo(() => {
    const projectByScopedKey = new Map(
      manuallyOrderedProjects.map((project) => {
        const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
        return [key, project] as const;
      }),
    );
    const sortableProjects = manuallyOrderedProjects.map((project) =>
      Object.assign({}, project, {
        id: scopedProjectKey(scopeProjectRef(project.environmentId, project.id)),
      }),
    );
    const sortableThreads = sidebarThreads
      .filter((thread) => thread.archivedAt === null && !isOrchestratorManagedThread(thread))
      .map((thread) =>
        Object.assign({}, thread, {
          projectId: scopedProjectKey(
            scopeProjectRef(thread.environmentId, thread.projectId),
          ) as ProjectId,
        }),
      );
    return sortProjectsForSidebar(sortableProjects, sortableThreads, projectSortOrder).flatMap(
      (project) => {
        const resolved = projectByScopedKey.get(project.id);
        return resolved ? [resolved] : [];
      },
    );
  }, [manuallyOrderedProjects, projectSortOrder, sidebarThreads]);
  const projectKeysWithThreads = useMemo(
    () =>
      new Set(
        sidebarThreads.map((thread) =>
          scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
        ),
      ),
    [sidebarThreads],
  );
  const isManualSorting = projectSortOrder === "manual";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!isManualSorting || !event.over || event.active.id === event.over.id) {
        return;
      }
      reorderProjects([String(event.active.id)], [String(event.over.id)]);
    },
    [isManualSorting, reorderProjects],
  );
  const closeRenameDialog = useCallback(() => {
    setRenameTarget(null);
    setRenameTitle("");
  }, []);
  const openRenameDialog = useCallback((project: Project) => {
    setRenameTarget(project);
    setRenameTitle(project.name);
  }, []);
  const submitRename = useCallback(async () => {
    if (!renameTarget) return;
    const title = renameTitle.trim();
    if (title.length === 0) {
      toastManager.add({ type: "warning", title: "Project title cannot be empty" });
      return;
    }
    if (title === renameTarget.name) {
      closeRenameDialog();
      return;
    }
    const api = readEnvironmentApi(renameTarget.environmentId);
    if (!api) {
      toastManager.add({ type: "error", title: "Project API unavailable" });
      return;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: renameTarget.id,
        title,
      });
      closeRenameDialog();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to rename project",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        }),
      );
    }
  }, [closeRenameDialog, renameTarget, renameTitle]);

  return (
    <>
      <SidebarContent className="gap-0">
        <SidebarGroup className="px-2 pt-3 pb-2">
          <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <div className="flex items-center gap-1">
              <OrchestratorProjectSortMenu
                sortOrder={projectSortOrder}
                onSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarProjectSortOrder: sortOrder });
                }}
              />
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
          </div>
          <DndContext
            collisionDetection={collisionDetection}
            modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
            onDragEnd={handleDragEnd}
            sensors={sensors}
          >
            <SortableContext
              items={sortedProjects.map(getProjectOrderKey)}
              strategy={verticalListSortingStrategy}
            >
              <SidebarMenu>
                {sortedProjects.map((project) => {
                  const key = scopedProjectKey(scopeProjectRef(project.environmentId, project.id));
                  return (
                    <OrchestratorSidebarProjectRow
                      key={key}
                      hasThreads={projectKeysWithThreads.has(key)}
                      project={project}
                      isActive={activeProjectKey === key}
                      isManualSorting={isManualSorting}
                      onOpenOrchestrationSettings={setOrchestrationSettingsTarget}
                      onRenameProject={openRenameDialog}
                    />
                  );
                })}
              </SidebarMenu>
            </SortableContext>
          </DndContext>
          {sortedProjects.length === 0 ? (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              No projects yet
            </div>
          ) : null}
        </SidebarGroup>
      </SidebarContent>
      <ProjectOrchestrationSettingsDialog
        target={orchestrationSettingsTarget}
        onClose={() => setOrchestrationSettingsTarget(null)}
      />
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRenameDialog();
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              {renameTarget
                ? `Update the title for ${renameTarget.cwd}.`
                : "Update the project title."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">Project title</span>
              <Input
                aria-label="Project title"
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submitRename();
                  }
                }}
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog}>
              Cancel
            </Button>
            <Button onClick={() => void submitRename()}>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
});

function OrchestratorProjectSortMenu({
  onSortOrderChange,
  sortOrder,
}: {
  onSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  sortOrder: SidebarProjectSortOrder;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              aria-label="Sort Orchestrator projects"
              className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
            />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sort projects</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" className="min-w-44" side="bottom">
        <MenuGroup>
          <MenuRadioGroup
            value={sortOrder}
            onValueChange={(value) => onSortOrderChange(value as SidebarProjectSortOrder)}
          >
            {(
              Object.entries(SIDEBAR_PROJECT_SORT_LABELS) as Array<
                [SidebarProjectSortOrder, string]
              >
            ).map(([value, label]) => (
              <MenuRadioItem className="min-h-7 py-1 text-xs" key={value} value={value}>
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

const OrchestratorSidebarProjectRow = memo(function OrchestratorSidebarProjectRow({
  project,
  hasThreads,
  isActive,
  isManualSorting,
  onOpenOrchestrationSettings,
  onRenameProject,
}: {
  project: Project;
  hasThreads: boolean;
  isActive: boolean;
  isManualSorting: boolean;
  onOpenOrchestrationSettings: (project: Project) => void;
  onRenameProject: (project: Project) => void;
}) {
  const sortable = useSortable({ id: getProjectOrderKey(project), disabled: !isManualSorting });
  const sortableStyle: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.65 : 1,
  };
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

  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      void (async () => {
        const api = readLocalApi();
        if (!api) {
          return;
        }
        const canRemove = tasks.length === 0 && !hasThreads;
        const items = orchestratorProjectContextMenuItems(canRemove);
        const clicked = await api.contextMenu.show(items, { x: event.clientX, y: event.clientY });
        if (clicked === "rename-project") {
          onRenameProject(project);
          return;
        }
        if (clicked === "orchestration-settings") {
          onOpenOrchestrationSettings(project);
          return;
        }
        if (clicked === "copy-path") {
          await navigator.clipboard.writeText(project.cwd);
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: "Copied project path",
              description: project.cwd,
            }),
          );
          return;
        }
        if (clicked === "remove-project" && canRemove) {
          const confirmed = await api.dialogs.confirm(
            [
              `Remove project “${project.name}”?`,
              `Path: ${project.cwd}`,
              "This removes only this project entry.",
            ].join("\n"),
          );
          if (!confirmed) return;
          const environmentApi = readEnvironmentApi(environmentId);
          if (!environmentApi) throw new Error("Project API unavailable.");
          await environmentApi.orchestration.dispatchCommand({
            type: "project.delete",
            commandId: newCommandId(),
            projectId,
          });
        }
      })().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Project context menu failed",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
    },
    [
      environmentId,
      hasThreads,
      onOpenOrchestrationSettings,
      onRenameProject,
      project,
      projectId,
      tasks.length,
    ],
  );

  return (
    <SidebarMenuItem ref={sortable.setNodeRef} style={sortableStyle}>
      <SidebarMenuButton
        size="sm"
        isActive={isActive}
        render={
          <Link
            to="/orch/$environmentId/$projectId"
            params={{ environmentId, projectId }}
            data-testid={`orchestrator-project-row-${projectId}`}
            onContextMenu={handleContextMenu}
          />
        }
        className="gap-2 px-2 py-1.5 text-left hover:bg-accent"
      >
        {isManualSorting ? (
          <span
            aria-label={`Drag ${project.name}`}
            className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
            ref={sortable.setActivatorNodeRef}
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVerticalIcon className="size-3" />
          </span>
        ) : null}
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
