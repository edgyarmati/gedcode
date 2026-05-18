import type { GedWorkflowState, GedWorkflowPhase } from "@t3tools/contracts";

interface WorkflowStatusBadgeProps {
  readonly state: GedWorkflowState | null;
}

const phaseLabel: Partial<Record<GedWorkflowPhase, string>> = {
  classify: "classifying",
  clarify: "clarifying",
  plan: "planning",
  implement: "implementing",
  verify: "verifying",
  commit: "committing",
  done: "done",
};

export function WorkflowStatusBadge({ state }: WorkflowStatusBadgeProps) {
  if (state && !state.enabled) return null;
  if (!state || !state.initialized) return null;
  if (state.phase === "inactive") return null;

  const isDone = state.phase === "done";
  const label = phaseLabel[state.phase] ?? state.phase;

  const colorClass = isDone
    ? "border-zinc-300 text-zinc-500 dark:border-zinc-600 dark:text-zinc-400"
    : state.plannerCheckpointValid
      ? "border-emerald-400 text-emerald-700 dark:border-emerald-600 dark:text-emerald-300"
      : "border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-300";

  const dotColor = isDone
    ? "bg-zinc-400 dark:bg-zinc-500"
    : state.plannerCheckpointValid
      ? "bg-emerald-500 dark:bg-emerald-400"
      : "bg-amber-500 dark:bg-amber-400";

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${colorClass}`}
      title={`Ged workflow: ${label}${state.classification !== "unclassified" ? ` (${state.classification})` : ""}`}
    >
      <span className={`inline-block size-2 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}
