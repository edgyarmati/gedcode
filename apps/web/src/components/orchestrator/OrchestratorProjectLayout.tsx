import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

export function getOrchestratorProjectGridClassName(boardCollapsed: boolean): string {
  return cn(
    "grid min-h-0 flex-1 grid-cols-1 overflow-hidden",
    boardCollapsed ? "lg:grid-cols-1" : "lg:grid-cols-[minmax(0,1fr)_22rem]",
  );
}

export function getOrchestratorPmSectionClassName(boardCollapsed: boolean): string {
  return cn(
    "flex min-h-0 min-w-0 flex-col border-b border-border lg:border-b-0",
    boardCollapsed ? null : "lg:border-r",
  );
}

export function OrchestratorBoardVisibilityButton({
  collapsed,
  setCollapsed,
}: {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      aria-label={collapsed ? "Show task board" : "Hide task board"}
      aria-expanded={!collapsed}
      aria-pressed={collapsed}
      onClick={() => setCollapsed(!collapsed)}
    >
      {collapsed ? (
        <PanelRightOpenIcon className="size-4" />
      ) : (
        <PanelRightCloseIcon className="size-4" />
      )}
    </Button>
  );
}
