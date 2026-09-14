import type { OrchestrationCommand, OrchestrationEvent } from "@t3tools/contracts";

import type { OrchestrationCommandReceipt } from "../persistence/Services/OrchestrationCommandReceipts.ts";
import { fingerprintOrchestrationCommand } from "./commandFingerprint.ts";
import { stageCompleteCommandId } from "./stageResolution.ts";

export const isDeterministicStageCompletion = (
  command: OrchestrationCommand,
): command is Extract<OrchestrationCommand, { type: "task.stage.complete" }> =>
  command.type === "task.stage.complete" &&
  command.awaitedTurnId !== null &&
  command.commandId === stageCompleteCommandId(command.stageThreadId, command.awaitedTurnId);

/**
 * Timeout and diff capture race to settle the same stage/turn. Their observations
 * can differ, but the first accepted settlement (including safety findings) wins.
 * Reconstruct its FULL fingerprint using only its persisted observations, leaving
 * every other retry field intact. This also works for receipts written before
 * this reconciliation existed; no fingerprint migration or broad exemption.
 */
export const matchesAcceptedStageCompletion = (
  command: OrchestrationCommand,
  receipt: OrchestrationCommandReceipt,
  event: OrchestrationEvent,
): boolean => {
  if (
    !isDeterministicStageCompletion(command) ||
    receipt.status !== "accepted" ||
    receipt.commandId !== command.commandId ||
    receipt.aggregateKind !== "task" ||
    receipt.aggregateId !== command.taskId ||
    event.type !== "task.stage-completed" ||
    event.sequence > receipt.resultSequence ||
    event.aggregateKind !== "task" ||
    event.aggregateId !== command.taskId ||
    event.commandId !== command.commandId ||
    event.payload.taskId !== command.taskId ||
    event.payload.role !== command.role ||
    event.payload.stageThreadId !== command.stageThreadId ||
    event.payload.awaitedTurnId !== command.awaitedTurnId
  ) {
    return false;
  }
  return (
    fingerprintOrchestrationCommand({
      ...command,
      diffComplete: event.payload.diffComplete,
      worktreeCompletion: event.payload.worktreeCompletion,
      ownershipViolationPaths: event.payload.ownershipViolationPaths,
      verificationFinalizationError: event.payload.verificationFinalizationError,
    }) === receipt.commandFingerprint
  );
};
