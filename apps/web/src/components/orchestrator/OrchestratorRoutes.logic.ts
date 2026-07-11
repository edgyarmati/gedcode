import type { OrchestrationThreadActivity, ProjectId, TaskId } from "@t3tools/contracts";

import type { OrchestratorPendingGate, OrchestratorTask } from "../../types";

export type TaskLandingPresentation =
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready" }
  | { readonly kind: "pending" }
  | { readonly kind: "opening-pr" }
  | { readonly kind: "request-failed"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "landed"; readonly prUrl: string };

function isLandingFailureForTask(activity: OrchestrationThreadActivity, taskId: TaskId): boolean {
  if (activity.kind !== "task.landing.pr-open-failed") {
    return false;
  }
  const payload = activity.payload;
  return (
    typeof payload === "object" &&
    payload !== null &&
    "taskId" in payload &&
    payload.taskId === String(taskId)
  );
}

export function deriveTaskLandingPresentation(input: {
  readonly task: OrchestratorTask;
  readonly gates: readonly OrchestratorPendingGate[];
  readonly activities: readonly OrchestrationThreadActivity[];
  readonly requestPending?: boolean;
  readonly requestError?: string | null;
}): TaskLandingPresentation {
  const { task } = input;
  if (task.prUrl !== null) {
    return { kind: "landed", prUrl: task.prUrl };
  }

  if (task.status === "landed") {
    const failure = input.activities.findLast((activity) =>
      isLandingFailureForTask(activity, task.id),
    );
    return failure ? { kind: "failed", message: failure.summary } : { kind: "opening-pr" };
  }

  if (task.status !== "review" || task.currentStageThreadId !== null || task.cancellation != null) {
    return { kind: "unavailable" };
  }
  if (input.requestError) {
    return { kind: "request-failed", message: input.requestError };
  }
  if (input.requestPending) {
    return { kind: "pending" };
  }

  const latestLandGate = input.gates.findLast(
    (gate) => gate.taskId === task.id && gate.gate === "land",
  );
  return latestLandGate?.status === "resolved" &&
    latestLandGate.decision === "approved" &&
    latestLandGate.approvedHash === latestLandGate.contentHash
    ? { kind: "ready" }
    : { kind: "unavailable" };
}

export async function confirmAndClearPmChat(input: {
  readonly projectId: ProjectId;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly clearPmChat: (input: { readonly projectId: ProjectId }) => Promise<unknown>;
}): Promise<boolean> {
  const confirmed = await input.confirm(
    "Clear the PM chat? This resets the visible PM conversation and starts the PM with fresh memory.",
  );
  if (!confirmed) {
    return false;
  }
  await input.clearPmChat({ projectId: input.projectId });
  return true;
}

export async function confirmAndCancelTask(input: {
  readonly taskId: TaskId;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly cancelTask: (input: { readonly taskId: TaskId }) => Promise<unknown>;
}): Promise<boolean> {
  const confirmed = await input.confirm(
    "Cancel this task? This marks it abandoned and frees its worktree slot.",
  );
  if (!confirmed) {
    return false;
  }
  await input.cancelTask({ taskId: input.taskId });
  return true;
}
