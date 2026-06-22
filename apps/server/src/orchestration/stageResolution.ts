import {
  CommandId,
  EventId,
  type OrchestrationThread,
  type OrchestrationReadModel,
  type OrchestrationStageRole,
  type ProviderInstanceId,
  type ThreadId,
  type TurnId,
} from "@t3tools/contracts";

type OrchestrationTaskView = OrchestrationReadModel["tasks"][number];

/**
 * Deterministic command id for completing the stage of `stageThreadId` after
 * the worker turn `turnId`. Both the diff-confirmed completion path
 * (CheckpointReactor) and the fail-loud timeout backstop
 * (ProviderRuntimeIngestion) derive the exact same id for a given
 * `(stageThreadId, turnId)` pair, so whichever dispatch commits first wins and
 * the other dedups against the persisted command receipt — guaranteeing
 * exactly-once PM re-entry without any in-memory latch and surviving restarts.
 */
export const stageCompleteCommandId = (stageThreadId: ThreadId, turnId: TurnId): CommandId =>
  CommandId.make(`server:task-stage-complete:${stageThreadId}:${turnId}`);

export const stageBlockCommandId = (
  stageThreadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  sourceKey: string,
): CommandId =>
  CommandId.make(`server:task-stage-block:${stageThreadId}:${providerInstanceId}:${sourceKey}`);

export const quotaStageResumeCommandId = (stageThreadId: ThreadId, retryCount: number): CommandId =>
  CommandId.make(`server:quota-stage-resume:${stageThreadId}:retry-${retryCount}`);

/**
 * Deterministic ids for the calm "paused on quota" stage-thread activity emitted
 * alongside a quota block. Derived from the same `(stageThreadId,
 * providerInstanceId, sourceKey)` tuple as {@link stageBlockCommandId}, so a
 * retried block re-derives the identical command + activity ids and the engine's
 * command-receipt dedup (command id) and the projector's activity dedup
 * (activity id) keep the timeline entry exactly-once.
 */
export const stageQuotaPausedActivityCommandId = (
  stageThreadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  sourceKey: string,
): CommandId =>
  CommandId.make(
    `server:task-stage-quota-paused:${stageThreadId}:${providerInstanceId}:${sourceKey}`,
  );

export const stageQuotaPausedActivityId = (
  stageThreadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  sourceKey: string,
): EventId =>
  EventId.make(`server:quota-paused:${stageThreadId}:${providerInstanceId}:${sourceKey}`);

/**
 * Deterministic ids for the calm "PM paused on quota" activity appended to the
 * PM conversation thread when the PM's own turn fails on quota (WP-Q7 / option A).
 * Keyed by the PM thread + the block timestamp: one marker per block episode
 * (the gate then holds re-entry, so no second failure fires until recovery), and
 * a same-timestamp retry dedups via the engine command receipt + projector
 * activity id.
 */
export const pmQuotaPausedActivityCommandId = (
  pmThreadId: ThreadId,
  occurredAt: string,
): CommandId => CommandId.make(`server:pm-quota-paused:${pmThreadId}:${occurredAt}`);

export const pmQuotaPausedActivityId = (pmThreadId: ThreadId, occurredAt: string): EventId =>
  EventId.make(`server:pm-quota-paused:${pmThreadId}:${occurredAt}`);

export function originalStageInstructions(thread: OrchestrationThread): string | null {
  const userMessage = thread.messages.find((message) => message.role === "user");
  const trimmed = userMessage?.text.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

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
