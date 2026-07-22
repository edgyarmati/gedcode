import {
  type EnvironmentId,
  type OrchestrationHelperRun,
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
import {
  selectHelperRunsForTaskRef,
  selectTaskStageHistoryByRef,
  useStore,
  type ScopedTaskRef,
} from "../../store";
import { STAGE_ROLE_LABELS } from "./stageRoles";

type StageStatusVariant = "info" | "success" | "warning" | "destructive";

const STAGE_STATUS_DISPLAY: Record<
  OrchestrationStageHistoryStatus,
  { readonly label: string; readonly variant: StageStatusVariant }
> = {
  running: { label: "Running", variant: "info" },
  paused: { label: "Paused — capability", variant: "warning" },
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

type HelperStatusVariant = "info" | "success" | "warning" | "destructive";

const HELPER_STATUS_DISPLAY: Record<
  OrchestrationHelperRun["status"],
  { readonly label: string; readonly variant: HelperStatusVariant }
> = {
  pending: { label: "Pending", variant: "warning" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  interrupted: { label: "Interrupted", variant: "destructive" },
};

export type TaskHistoryRow =
  | ({ readonly kind: "stage" } & StageTimelineRow)
  | {
      readonly kind: "helper";
      readonly key: string;
      readonly prompt: string;
      readonly backendLabel: string;
      readonly statusLabel: string;
      readonly statusVariant: HelperStatusVariant;
      readonly startedAt: string;
      readonly result: string | null;
      readonly failureMessage: string | null;
    };

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

// A task's durable work history includes both stage attempts and bounded
// read-only exploration. Stages remain selectable; helpers are deliberately
// informational because their transcript is not a task attempt.
export function buildTaskHistoryRows(
  stages: ReadonlyArray<OrchestrationStageHistoryEntry>,
  helpers: ReadonlyArray<OrchestrationHelperRun>,
): TaskHistoryRow[] {
  const stageRows: TaskHistoryRow[] = buildStageTimelineRows(stages).map((row) => ({
    kind: "stage",
    ...row,
  }));
  const helperRows: TaskHistoryRow[] = helpers.map((run) => ({
    kind: "helper",
    key: String(run.id),
    prompt: run.prompt,
    backendLabel: `${String(run.providerInstanceId)} · ${run.model}`,
    statusLabel: HELPER_STATUS_DISPLAY[run.status].label,
    statusVariant: HELPER_STATUS_DISPLAY[run.status].variant,
    startedAt: run.startedAt ?? run.createdAt,
    result: run.result,
    failureMessage: run.failureMessage,
  }));
  return [...stageRows, ...helperRows].toSorted(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.key.localeCompare(right.key),
  );
}

function formatStageTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const helperRuns = useStore(useShallow((state) => selectHelperRunsForTaskRef(state, taskRef)));
  const rows = buildTaskHistoryRows(stageHistory, helperRuns);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase">Task history</h2>
      <ol className="space-y-2">
        {rows.map((row) => {
          const startedLabel = formatStageTime(row.startedAt);
          if (row.kind === "helper") {
            return (
              <li key={`helper:${row.key}`} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-sm font-medium">
                      Read-only helper · {row.prompt}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {row.backendLabel}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {startedLabel === null ? null : (
                      <span className="text-xs text-muted-foreground">{startedLabel}</span>
                    )}
                    <Badge size="sm" variant={row.statusVariant}>
                      {row.statusLabel}
                    </Badge>
                  </div>
                </div>
                {row.result === null && row.failureMessage === null ? null : (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                      {row.failureMessage === null ? "Result" : "Failure details"}
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-sans">
                      {row.result ?? row.failureMessage}
                    </pre>
                  </details>
                )}
              </li>
            );
          }
          const selected = row.key === String(selectedStageThreadId);
          return (
            <li key={`stage:${row.key}`}>
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
