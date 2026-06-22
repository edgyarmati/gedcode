import {
  type EnvironmentId,
  type OrchestrationStageHistoryEntry,
  type OrchestrationStageHistoryStatus,
  type OrchestrationStageRole,
  type TaskId,
} from "@t3tools/contracts";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "../ui/badge";
import { selectTaskStageHistoryByRef, useStore, type ScopedTaskRef } from "../../store";

type StageStatusVariant = "info" | "success" | "warning";

const STAGE_ROLE_LABELS: Record<OrchestrationStageRole, string> = {
  classify: "Classify",
  plan: "Plan",
  review: "Review",
  work: "Work",
  verify: "Verify",
};

const STAGE_STATUS_DISPLAY: Record<
  OrchestrationStageHistoryStatus,
  { readonly label: string; readonly variant: StageStatusVariant }
> = {
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  blocked: { label: "Blocked", variant: "warning" },
};

export interface StageTimelineRow {
  readonly key: string;
  readonly role: OrchestrationStageRole;
  readonly roleLabel: string;
  readonly status: OrchestrationStageHistoryStatus;
  readonly statusLabel: string;
  readonly statusVariant: StageStatusVariant;
  readonly backendLabel: string;
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
  return entries.map((entry) => {
    const statusDisplay = STAGE_STATUS_DISPLAY[entry.status];
    return {
      key: String(entry.stageThreadId),
      role: entry.role,
      roleLabel: STAGE_ROLE_LABELS[entry.role],
      status: entry.status,
      statusLabel: statusDisplay.label,
      statusVariant: statusDisplay.variant,
      backendLabel: `${String(entry.providerInstanceId)} · ${entry.model}`,
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
  taskId,
}: {
  environmentId: EnvironmentId;
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
          return (
            <li
              key={row.key}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{row.roleLabel}</span>
                <span className="truncate text-xs text-muted-foreground">{row.backendLabel}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {startedLabel === null ? null : (
                  <span className="text-xs text-muted-foreground">{startedLabel}</span>
                )}
                <Badge size="sm" variant={row.statusVariant}>
                  {row.statusLabel}
                </Badge>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
