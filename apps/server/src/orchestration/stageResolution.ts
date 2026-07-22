import {
  CommandId,
  EventId,
  type GedRolePromptPrefixes,
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

/** One durable pause/resume boundary per provider approval request. */
export const stageCapabilityPauseCommandId = (
  stageThreadId: ThreadId,
  requestId: string,
): CommandId => CommandId.make(`server:task-stage-capability-pause:${stageThreadId}:${requestId}`);

export const stageCapabilityResumeCommandId = (
  stageThreadId: ThreadId,
  requestId: string,
): CommandId => CommandId.make(`server:task-stage-capability-resume:${stageThreadId}:${requestId}`);

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

const STAGE_PROMPT_PREFIX_OPEN = "----- BEGIN GEDCODE STAGE PROMPT PREFIX -----";
const STAGE_PROMPT_PREFIX_CLOSE = "----- END GEDCODE STAGE PROMPT PREFIX -----";

const STAGE_OWNERSHIP_REQUIREMENTS: Record<OrchestrationStageRole, string> = {
  plan: [
    "You own design and planning documentation only. Do not implement substantive product code.",
    "Record accepted slices, dependencies, acceptance criteria, and relevant architecture decisions in the project's GED context framework. Leave implementation to a work stage.",
  ].join(" "),
  work: [
    "You own the substantive implementation for this task, including its implementation commits.",
    "Complete the implementation with descriptive Git commits and leave the task worktree clean. Before finishing, inspect tracked and untracked changes and commit all intended task changes; explicitly report anything you cannot safely resolve.",
  ].join(" "),
  verify: [
    "You own documentation and verification evidence only. Do not modify substantive implementation code; if code needs repair, report the exact failure so the PM can return it to a work stage.",
    "Run proportional focused checks and update the GED context and verification evidence when the implementation changes them. Do not stage or commit those documentation changes: leave them for GedCode to audit and commit through its trusted server finalizer.",
  ].join(" "),
};

const SANDBOX_REQUIREMENT =
  "You run in a sandboxed auto-approve workspace-write environment. Network access is controlled by the human's global setting and may be further disabled for this handoff; it never authorizes authenticated host access or sandbox escalation. Do not work around missing authenticated host access, credentials, network, or sandbox restrictions; report the exact blocked operation to the PM, which owns authenticated host operations.";

export function stripStagePromptPrefix(instructions: string): string {
  const leadingWhitespaceLength = instructions.length - instructions.trimStart().length;
  const trimmedStart = instructions.slice(leadingWhitespaceLength);
  if (!trimmedStart.startsWith(STAGE_PROMPT_PREFIX_OPEN)) {
    return instructions;
  }
  const closeIndex = trimmedStart.indexOf(STAGE_PROMPT_PREFIX_CLOSE);
  if (closeIndex < 0) {
    return instructions;
  }
  return trimmedStart.slice(closeIndex + STAGE_PROMPT_PREFIX_CLOSE.length).trimStart();
}

export function prepareStageInstructions(input: {
  readonly instructions: string;
  readonly role: OrchestrationStageRole;
  readonly rolePromptPrefixes: GedRolePromptPrefixes | undefined;
}): string {
  const rawInstructions = stripStagePromptPrefix(input.instructions);
  const configuredPrefix = input.rolePromptPrefixes?.[input.role];
  const promptPrefix = [
    configuredPrefix,
    STAGE_OWNERSHIP_REQUIREMENTS[input.role],
    SANDBOX_REQUIREMENT,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n");
  if (promptPrefix.length === 0) {
    return rawInstructions;
  }
  return `${STAGE_PROMPT_PREFIX_OPEN}
Role: ${input.role}
${promptPrefix}
${STAGE_PROMPT_PREFIX_CLOSE}

${rawInstructions}`;
}

export function originalStageInstructions(thread: OrchestrationThread): string | null {
  const userMessage = thread.messages.find((message) => message.role === "user");
  const trimmed =
    userMessage === undefined ? undefined : stripStagePromptPrefix(userMessage.text).trim();
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
    case "planning":
      return "plan";
    case "working":
      return "work";
    case "verifying":
      return "verify";
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
