import {
  HelperRunId,
  type EnvironmentId,
  type OrchestrationHelperRun,
  type ProjectId,
  type TaskId,
} from "@t3tools/contracts";
import { appendModelOptionsSuffix } from "@t3tools/shared/model";
import { XIcon } from "lucide-react";
import { useCallback, useId, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  dismissPmHelper,
  selectDismissedPmHelperIds,
  useHelperDismissalStore,
} from "../../helperDismissalStore";
import {
  selectHelperRunsForProjectRef,
  selectHelperRunsForTaskRef,
  useStore,
  type ScopedTaskRef,
} from "../../store";
import { formatClockTime } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

type HelperStatusVariant = "info" | "success" | "warning" | "destructive";

const STATUS_DISPLAY: Record<
  OrchestrationHelperRun["status"],
  { readonly label: string; readonly variant: HelperStatusVariant }
> = {
  pending: { label: "Pending", variant: "warning" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  interrupted: { label: "Interrupted", variant: "destructive" },
};

export interface HelperRunTimelineRow {
  readonly id: string;
  readonly prompt: string;
  readonly tierLabel: string;
  readonly backendLabel: string;
  readonly statusLabel: string;
  readonly statusVariant: HelperStatusVariant;
  readonly result: string | null;
  readonly failureMessage: string | null;
}

function buildHelperRunTimelineRow(run: OrchestrationHelperRun): HelperRunTimelineRow {
  return {
    id: String(run.id),
    prompt: run.prompt,
    tierLabel: `${run.tier[0]?.toUpperCase() ?? ""}${run.tier.slice(1)}`,
    backendLabel: appendModelOptionsSuffix(
      `${String(run.providerInstanceId)} · ${run.model}`,
      run.modelOptions,
    ),
    statusLabel: STATUS_DISPLAY[run.status].label,
    statusVariant: STATUS_DISPLAY[run.status].variant,
    result: run.result,
    failureMessage: run.failureMessage,
  };
}

export function buildHelperRunTimelineRows(
  runs: ReadonlyArray<OrchestrationHelperRun>,
): HelperRunTimelineRow[] {
  return runs.map(buildHelperRunTimelineRow);
}

export interface PmHelperHistoryRow extends HelperRunTimelineRow {
  // Stamp the run was requested or started, so history can show when each helper
  // ran without depending on wall-clock now.
  readonly startedAt: string;
}

// One canonical notion of "newest" for PM helpers, so the pinned card and the
// history list can never disagree about which run replaced which. Requested time
// wins over start time: a run still waiting to start is already the newer one.
function compareHelperRunRecency(
  left: OrchestrationHelperRun,
  right: OrchestrationHelperRun,
): number {
  return (
    right.createdAt.localeCompare(left.createdAt) || String(right.id).localeCompare(String(left.id))
  );
}

// The durable project-level record behind the single pinned card: every PM helper
// stays listed after it is replaced or dismissed, newest first.
export function buildPmHelperHistoryRows(
  runs: ReadonlyArray<OrchestrationHelperRun>,
): PmHelperHistoryRow[] {
  return runs
    .filter((run) => run.attachment.kind === "pm")
    .toSorted(compareHelperRunRecency)
    .map(buildPmHelperHistoryRow);
}

function buildPmHelperHistoryRow(run: OrchestrationHelperRun): PmHelperHistoryRow {
  return {
    ...buildHelperRunTimelineRow(run),
    // A run that never started still needs a stamp, so history falls back to when
    // it was requested.
    startedAt: run.startedAt ?? run.createdAt,
  };
}

export interface PinnedPmHelperCard extends HelperRunTimelineRow {
  // Dismissal is only offered for settled runs, so a helper the user is still
  // waiting on cannot be hidden before it produces a result or failure.
  readonly dismissible: boolean;
}

const EMPTY_DISMISSED_HELPER_RUN_IDS: ReadonlySet<string> = new Set();

const TERMINAL_HELPER_STATUSES: ReadonlySet<OrchestrationHelperRun["status"]> = new Set([
  "completed",
  "failed",
  "interrupted",
]);

// The PM surface pins exactly one helper card, so a newer run has to replace the
// previous one rather than stack. Canonical ordering lives here so the route and
// its tests cannot disagree about which run is "newest".
//
// Dismissal is applied to the newest run only, never used to walk further back:
// a helper dismissed earlier must not resurface, and a dismissal recorded against
// a superseded run must not suppress the run that replaced it.
export function selectPinnedPmHelperCard(
  runs: ReadonlyArray<OrchestrationHelperRun>,
  dismissedHelperRunIds: ReadonlySet<string> = EMPTY_DISMISSED_HELPER_RUN_IDS,
): PinnedPmHelperCard | null {
  const newest = runs.reduce<OrchestrationHelperRun | null>((pinned, run) => {
    if (run.attachment.kind !== "pm") return pinned;
    if (pinned === null) return run;
    return compareHelperRunRecency(run, pinned) < 0 ? run : pinned;
  }, null);
  if (newest === null) return null;
  if (dismissedHelperRunIds.has(String(newest.id))) return null;
  return {
    ...buildHelperRunTimelineRow(newest),
    dismissible: TERMINAL_HELPER_STATUSES.has(newest.status),
  };
}

function HelperRunDetails({ row }: { readonly row: HelperRunTimelineRow }) {
  if (row.result === null && row.failureMessage === null) return null;
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {row.failureMessage === null ? "Result" : "Failure details"}
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-sans">
        {row.result ?? row.failureMessage}
      </pre>
    </details>
  );
}

export interface PmHelperCardProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  // Dismissed runs are client-local state owned by the caller, so the card stays
  // a pure projection of the store plus what this browser has already closed.
  readonly dismissedHelperRunIds?: ReadonlySet<string>;
  // A terminal card only shows its close control when there is somewhere to
  // record the dismissal.
  readonly onDismiss?: (helperRunId: string) => void;
}

// Only the newest PM helper is pinned. Replaced runs stay reachable through
// project Helper history rather than stacking cards on the PM surface.
export function PmHelperCard({
  dismissedHelperRunIds,
  environmentId,
  onDismiss,
  projectId,
}: PmHelperCardProps) {
  const runs = useStore(
    useShallow((state) => selectHelperRunsForProjectRef(state, { environmentId, projectId })),
  );
  const card = useMemo(
    () => selectPinnedPmHelperCard(runs, dismissedHelperRunIds),
    [dismissedHelperRunIds, runs],
  );
  const headingId = useId();
  if (card === null) return null;

  return (
    // Named so the pinned card is a distinct landmark from Helper history, which
    // repeats the same run text once the card is replaced.
    <section
      aria-labelledby={headingId}
      className="space-y-2 border-b border-border bg-muted/12 px-3 py-2"
    >
      <h2 className="text-xs font-semibold text-muted-foreground uppercase" id={headingId}>
        Latest helper
      </h2>
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium">{card.prompt}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {card.tierLabel} · {card.backendLabel} · Read only
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge size="sm" variant={card.statusVariant}>
              {card.statusLabel}
            </Badge>
            {card.dismissible && onDismiss !== undefined ? (
              <Button
                aria-label="Dismiss latest helper"
                onClick={() => onDismiss(card.id)}
                size="icon-sm"
                variant="ghost"
              >
                <XIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        <HelperRunDetails row={card} />
      </div>
    </section>
  );
}

// Every PM helper stays here after its card is replaced or dismissed, so a result
// the user closed is still recoverable. Collapsed by default: the pinned card is
// the live surface, history is the archive.
function PmHelperHistory({ rows }: { readonly rows: ReadonlyArray<PmHelperHistoryRow> }) {
  if (rows.length === 0) return null;

  return (
    <details className="border-b border-border bg-muted/12 px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground uppercase">
        Helper history ({rows.length})
      </summary>
      <ol className="mt-2 space-y-2">
        {rows.map((row) => {
          const startedLabel = formatClockTime(row.startedAt);
          return (
            <li key={row.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium">{row.prompt}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {row.tierLabel} · {row.backendLabel} · Read only
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
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs font-sans">
                  {row.result ?? row.failureMessage}
                </pre>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

// The PM helper surface: one pinned card for the newest run plus the durable
// history behind it. Dismissal is recorded client-side here rather than passed in,
// so closing a card survives navigation, remounts, and reloads.
export function PmHelperSurface({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const projectRef = useMemo(() => ({ environmentId, projectId }), [environmentId, projectId]);
  const runs = useStore(useShallow((state) => selectHelperRunsForProjectRef(state, projectRef)));
  const dismissedHelperRunIds = useHelperDismissalStore(
    useShallow((state) => selectDismissedPmHelperIds(state, projectRef)),
  );
  const historyRows = useMemo(() => buildPmHelperHistoryRows(runs), [runs]);
  const onDismiss = useCallback(
    (helperRunId: string) => {
      dismissPmHelper({ ...projectRef, helperRunId: HelperRunId.make(helperRunId) });
    },
    [projectRef],
  );

  return (
    <>
      <PmHelperCard
        dismissedHelperRunIds={dismissedHelperRunIds}
        environmentId={environmentId}
        onDismiss={onDismiss}
        projectId={projectId}
      />
      <PmHelperHistory rows={historyRows} />
    </>
  );
}

type HelperRunTimelineProps =
  | {
      readonly environmentId: EnvironmentId;
      readonly projectId: ProjectId;
      readonly taskId?: never;
    }
  | { readonly environmentId: EnvironmentId; readonly taskId: TaskId; readonly projectId?: never };

export function HelperRunTimeline(props: HelperRunTimelineProps) {
  const taskRef = useMemo<ScopedTaskRef | null>(
    () =>
      props.taskId === undefined
        ? null
        : { environmentId: props.environmentId, taskId: props.taskId },
    [props.environmentId, props.taskId],
  );
  const runs = useStore(
    useShallow((state) =>
      taskRef === null && props.projectId !== undefined
        ? selectHelperRunsForProjectRef(state, {
            environmentId: props.environmentId,
            projectId: props.projectId,
          })
        : selectHelperRunsForTaskRef(state, taskRef),
    ),
  );
  if (runs.length === 0) return null;
  const rows = buildHelperRunTimelineRows(runs);

  return (
    <section className="space-y-2 border-b border-border bg-muted/12 px-3 py-2">
      <h2 className="text-xs font-semibold text-muted-foreground uppercase">Read-only helpers</h2>
      <ol className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium">{row.prompt}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {row.tierLabel} · {row.backendLabel} · Read only
                </p>
              </div>
              <Badge size="sm" variant={row.statusVariant}>
                {row.statusLabel}
              </Badge>
            </div>
            <HelperRunDetails row={row} />
          </li>
        ))}
      </ol>
    </section>
  );
}
