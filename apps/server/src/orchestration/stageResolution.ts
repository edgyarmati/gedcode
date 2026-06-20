import type { OrchestrationReadModel, OrchestrationStageRole, ThreadId } from "@t3tools/contracts";

type OrchestrationTaskView = OrchestrationReadModel["tasks"][number];

/**
 * The stage role a task is actively running, derived purely from its status.
 * Returns `null` for statuses with no active stage (draft, the *-review parks,
 * review, landed, abandoned, ...).
 *
 * Shared by the decider, ProviderRuntimeIngestion, and CheckpointReactor so the
 * stage-completion gate, the timeout backstop, and the decider all agree on
 * which role is being completed for a given task.
 */
export function activeStageRoleForTaskStatus(
  status: OrchestrationTaskView["status"],
): OrchestrationStageRole | null {
  switch (status) {
    case "classified":
      return "classify";
    case "planning":
      return "plan";
    case "working":
      return "work";
    default:
      return null;
  }
}

/**
 * Finds the task that owns `threadId` as one of its stage threads, if any.
 * Stage thread ids are non-null `ThreadId`s, so identity comparison is exact.
 */
export function findTaskForStageThread(
  tasks: ReadonlyArray<OrchestrationTaskView>,
  threadId: ThreadId,
): OrchestrationTaskView | undefined {
  return tasks.find((task) =>
    task.stageThreadIds.some((stageThreadId) => stageThreadId === threadId),
  );
}
