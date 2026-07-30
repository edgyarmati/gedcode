import { SettingsIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { scopeProjectRef } from "@t3tools/client-runtime";

import { APP_STAGE_LABEL, APP_VERSION } from "../branding";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { isElectron } from "../env";
import {
  selectProjectByRef,
  selectSidebarThreadsAcrossEnvironments,
  selectTasksAcrossEnvironments,
  useStore,
} from "../store";
import { useUiStateStore } from "../uiStateStore";
import { resolveThreadRouteRef } from "../threadRoutes";
import { selectInboxEntries } from "../inboxSelectors";
import { InboxSidebar } from "./InboxSidebar";
import { OrchestratorSidebarNav } from "./orchestrator/OrchestratorSidebarNav";
import { resolveOrchestratorLandingTarget } from "./orchestrator/orchestratorNav.logic";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarProviderUpdatePill } from "./sidebar/SidebarProviderUpdatePill";
import { SidebarUpdatePill } from "./sidebar/SidebarUpdatePill";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function GedWordmark() {
  return (
    <span
      aria-label="Ged"
      className="shrink-0 text-sm font-semibold tracking-tight text-foreground"
    >
      Ged
    </span>
  );
}

const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label="Go to threads"
              className="ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
              to="/"
            >
              <GedWordmark />
              <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
                Code
              </span>
              {APP_STAGE_LABEL ? (
                <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                  {APP_STAGE_LABEL}
                </span>
              ) : null}
            </Link>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return isElectron ? (
    <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px] wco:h-[env(titlebar-area-height)] wco:pl-[calc(env(titlebar-area-x)+1em)]">
      {wordmark}
    </SidebarHeader>
  ) : (
    <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">{wordmark}</SidebarHeader>
  );
});

const SidebarChromeFooter = memo(function SidebarChromeFooter() {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const handleSettingsClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/settings" });
  }, [isMobile, navigate, setOpenMobile]);

  return (
    <SidebarFooter className="p-2">
      <SidebarProviderUpdatePill />
      <SidebarUpdatePill />
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            onClick={handleSettingsClick}
          >
            <SettingsIcon className="size-3.5" />
            <span className="text-xs">Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  );
});

export default function Sidebar() {
  const sidebarThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const inboxTasks = useStore(useShallow(selectTasksAcrossEnvironments));
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { isMobile, setOpenMobile } = useSidebar();
  const orchestratorMode = useUiStateStore((state) => state.orchestratorMode);
  const setOrchestratorMode = useUiStateStore((state) => state.setOrchestratorMode);
  const lastOrchestratorProject = useUiStateStore((state) => state.lastOrchestratorProject);
  const isOnSettings = pathname.startsWith("/settings");
  const orchestratorSurface = orchestratorMode || pathname.startsWith("/orch");

  const inboxEntries = useMemo(() => {
    const selected = selectInboxEntries({
      environmentId: String(primaryEnvironmentId),
      selectedThreadId: routeThreadRef ? String(routeThreadRef.threadId) : null,
      threads: sidebarThreads,
      tasks: inboxTasks,
    });
    const threadById = new Map(sidebarThreads.map((thread) => [String(thread.id), thread]));
    const taskTitleById = new Map(inboxTasks.map((task) => [String(task.id), task.title]));
    const shelfEntries = (ids: ReadonlyArray<string>) =>
      ids.map((id) => {
        const thread = threadById.get(id);
        return {
          id,
          title: thread?.title ?? id,
          route: {
            to: "/chat/$environmentId/$threadId",
            params: {
              environmentId: String(thread?.environmentId ?? primaryEnvironmentId),
              threadId: id,
            },
          },
        };
      });
    return {
      normal: {
        ...selected.normal,
        shelves: {
          active: selected.normal.shelves.active,
          snoozed: shelfEntries(selected.normal.shelves.snoozed),
          settled: shelfEntries(selected.normal.shelves.settled),
        },
      },
      orchestrator: selected.orchestrator.map((entry) =>
        Object.assign({}, entry, { title: taskTitleById.get(entry.id) ?? entry.id }),
      ),
    };
  }, [inboxTasks, primaryEnvironmentId, routeThreadRef, sidebarThreads]);

  const handleNavigate = useCallback(
    (route: { readonly to: string; readonly params: Readonly<Record<string, string>> }) => {
      void navigate(route as never);
      if (isMobile) setOpenMobile(false);
    },
    [isMobile, navigate, setOpenMobile],
  );
  const handlePrimaryViewChange = useCallback(
    (view: "inbox" | "orchestrator") => {
      const nextOrchestratorMode = view === "orchestrator";
      setOrchestratorMode(nextOrchestratorMode);
      if (!nextOrchestratorMode) {
        void navigate({ to: "/" });
        return;
      }
      const target = resolveOrchestratorLandingTarget({
        lastProject: lastOrchestratorProject,
        projectExists: (ref) =>
          selectProjectByRef(
            useStore.getState(),
            scopeProjectRef(ref.environmentId, ref.projectId),
          ) !== undefined,
      });
      if (target) {
        void navigate({
          to: "/orch/$environmentId/$projectId",
          params: { environmentId: target.environmentId, projectId: target.projectId },
        });
      } else {
        void navigate({ to: "/orch" });
      }
    },
    [lastOrchestratorProject, navigate, setOrchestratorMode],
  );

  return (
    <>
      <SidebarChromeHeader isElectron={isElectron} />
      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
          <InboxSidebar
            entries={inboxEntries}
            onNavigate={handleNavigate}
            primaryView={orchestratorSurface ? "orchestrator" : "inbox"}
            onPrimaryViewChange={handlePrimaryViewChange}
          />
          {orchestratorSurface ? <OrchestratorSidebarNav /> : null}
          <SidebarSeparator />
          <SidebarChromeFooter />
        </>
      )}
    </>
  );
}
