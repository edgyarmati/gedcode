import type { GedWorkflowState } from "@t3tools/contracts";

interface WorkflowStatusBadgeProps {
  readonly state: GedWorkflowState | null;
}

export function WorkflowStatusBadge({ state }: WorkflowStatusBadgeProps) {
  if (!state || !state.initialized) return null;
  if (state.phase === "inactive") return null;

  const hasGuards = state.plannerCheckpointValid;
  const colorClass = hasGuards
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${colorClass}`}
    >
      {state.phase}
      {state.classification !== "unclassified" && (
        <span className="opacity-60">&middot; {state.classification}</span>
      )}
    </span>
  );
}
