import type {
  OrchestrationProjectContextRun,
  OrchestrationThreadActivity,
  ProjectId,
  TaskId,
} from "@t3tools/contracts";

import type { OrchestratorPendingGate, OrchestratorTask } from "../../types";

export function parseTaskStageSearch(search: Record<string, unknown>): { readonly stage?: string } {
  return typeof search.stage === "string" && search.stage.trim() !== ""
    ? { stage: search.stage }
    : {};
}

export type TaskLandingPresentation =
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready" }
  | { readonly kind: "pending" }
  | { readonly kind: "opening-pr" }
  | { readonly kind: "request-failed"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "landed"; readonly prUrl: string };

export type ProjectContextStatusPresentation =
  | { readonly kind: "ready"; readonly label: "Ready" }
  | { readonly kind: "updating"; readonly label: "Updating" }
  | { readonly kind: "needs-attention"; readonly label: "Needs attention" };

export function deriveProjectContextStatus(
  latestRun: OrchestrationProjectContextRun | null,
): ProjectContextStatusPresentation {
  if (latestRun === null || latestRun.status === "completed" || latestRun.status === "discarded") {
    return { kind: "ready", label: "Ready" };
  }
  if (latestRun.status === "pending" || latestRun.status === "running") {
    return { kind: "updating", label: "Updating" };
  }
  return { kind: "needs-attention", label: "Needs attention" };
}

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
  if (task.landing?.status === "failed") {
    return {
      kind: "failed",
      message: task.landing.failureMessage ?? "Pull request creation failed.",
    };
  }
  if (task.landing?.status === "opening-pr") {
    return { kind: "opening-pr" };
  }
  const landingFailure =
    task.status === "landed"
      ? input.activities.findLast((activity) => isLandingFailureForTask(activity, task.id))
      : undefined;
  const canRequestLanding =
    task.status === "review" || (task.status === "landed" && landingFailure !== undefined);
  if (canRequestLanding && input.requestError) {
    return { kind: "request-failed", message: input.requestError };
  }
  if (canRequestLanding && input.requestPending) {
    return { kind: "pending" };
  }

  if (task.status === "landed") {
    return landingFailure
      ? { kind: "failed", message: landingFailure.summary }
      : { kind: "opening-pr" };
  }

  if (task.status !== "review" || task.currentStageThreadId !== null || task.cancellation != null) {
    return { kind: "unavailable" };
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
