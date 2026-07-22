import {
  type EnvironmentId,
  type OrchestrationStageHistoryEntry,
  type OrchestrationStageHistoryStatus,
  type OrchestrationStageRole,
  type TaskId,
  type ThreadId,
} from "@t3tools/contracts";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { selectTaskStageHistoryByRef, useStore, type ScopedTaskRef } from "../../store";
import { STAGE_ROLE_LABELS } from "./stageRoles";

type StageStatusVariant = "info" | "success" | "warning" | "destructive";

const STAGE_STATUS_DISPLAY: Record<
  OrchestrationStageHistoryStatus,
  { readonly label: string; readonly variant: StageStatusVariant }
> = {
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  blocked: { label: "Blocked", variant: "warning" },
  interrupted: { label: "Interrupted", variant: "destructive" },
};

export interface StageTimelineRow {
  readonly key: string;
  readonly role: OrchestrationStageRole;
  readonly roleLabel: string;
  readonly attemptNumber: number;
  readonly status: OrchestrationStageHistoryStatus;
  readonly statusLabel: string;
  readonly statusVariant: StageStatusVariant;
  readonly backendLabel: string;
  readonly permissionLabel: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

// Pure projection of durable stage-history entries into timeline rows. Kept
// apart from rendering so the role/status/backend display logic is unit-tested
// without a DOM. Input order is preserved — the store selector already sorts by
// start time.
export function buildStageTimelineRows(
  entries: ReadonlyArray<OrchestrationStageHistoryEntry>,
): StageTimelineRow[] {
  const attemptsByRole = new Map<OrchestrationStageRole, number>();
  return entries.map((entry) => {
    const statusDisplay = STAGE_STATUS_DISPLAY[entry.status];
    const attemptNumber = (attemptsByRole.get(entry.role) ?? 0) + 1;
    attemptsByRole.set(entry.role, attemptNumber);
    return {
      key: String(entry.stageThreadId),
      role: entry.role,
      roleLabel: STAGE_ROLE_LABELS[entry.role],
      attemptNumber,
      status: entry.status,
      statusLabel: statusDisplay.label,
      statusVariant: statusDisplay.variant,
      backendLabel: `${String(entry.providerInstanceId)} · ${entry.model}`,
      permissionLabel:
        entry.runtimeMode === "full-access"
          ? "Full access"
          : entry.runtimeMode === "auto-accept-edits"
            ? "Auto-accept edits"
            : entry.runtimeMode === "approval-required"
              ? "Approval required"
              : "Permission unknown",
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
    };
  });
}

function formatStageTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Durable stage timeline for a task: the classify → plan → review → work →
// verify pipeline with each stage's backend/model and live status. Seeded from
// the task/project snapshot and kept live by streamed stage events. Renders
// nothing until at least one stage has started.
export function StageTimeline({
  environmentId,
  onSelectStageThread,
  selectedStageThreadId = null,
  taskId,
}: {
  environmentId: EnvironmentId;
  onSelectStageThread?: ((stageThreadId: string | undefined) => void) | undefined;
  selectedStageThreadId?: ThreadId | null;
  taskId: TaskId;
}) {
  const taskRef = useMemo<ScopedTaskRef>(
    () => ({ environmentId, taskId }),
    [environmentId, taskId],
  );
  const stageHistory = useStore(useShallow((state) => selectTaskStageHistoryByRef(state, taskRef)));
  if (stageHistory.length === 0) {
    return null;
  }
  const rows = buildStageTimelineRows(stageHistory);
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase">Stages</h2>
      <ol className="space-y-2">
        {rows.map((row) => {
          const startedLabel = formatStageTime(row.startedAt);
          const selected = row.key === String(selectedStageThreadId);
          return (
            <li key={row.key}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg border bg-card p-3 text-left transition-colors",
                  selected
                    ? "border-primary/70 bg-primary/5 ring-1 ring-primary/25"
                    : "border-border hover:border-foreground/25 hover:bg-accent/40",
                )}
                onClick={() => onSelectStageThread?.(row.key)}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">
                    {row.roleLabel} · Attempt {row.attemptNumber}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{row.backendLabel}</span>
                  <span className="text-xs text-muted-foreground">{row.permissionLabel}</span>
                </div>
                <div className="flex min-w-0 shrink-0 flex-col items-end gap-1">
                  {startedLabel === null ? null : (
                    <span className="text-xs text-muted-foreground">{startedLabel}</span>
                  )}
                  <Badge size="sm" variant={row.statusVariant}>
                    {row.statusLabel}
                  </Badge>
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
