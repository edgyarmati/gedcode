import {
  type EnvironmentId,
  type OrchestrationHelperRun,
  type ProjectId,
  type TaskId,
} from "@t3tools/contracts";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import {
  selectHelperRunsForProjectRef,
  selectHelperRunsForTaskRef,
  useStore,
  type ScopedTaskRef,
} from "../../store";
import { Badge } from "../ui/badge";

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

export function buildHelperRunTimelineRows(
  runs: ReadonlyArray<OrchestrationHelperRun>,
): HelperRunTimelineRow[] {
  return runs.map((run) => ({
    id: String(run.id),
    prompt: run.prompt,
    tierLabel: `${run.tier[0]?.toUpperCase() ?? ""}${run.tier.slice(1)}`,
    backendLabel: `${String(run.providerInstanceId)} · ${run.model}`,
    statusLabel: STATUS_DISPLAY[run.status].label,
    statusVariant: STATUS_DISPLAY[run.status].variant,
    result: run.result,
    failureMessage: run.failureMessage,
  }));
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
        ))}
      </ol>
    </section>
  );
}
