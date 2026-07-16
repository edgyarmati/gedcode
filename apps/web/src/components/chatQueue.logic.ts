import type { ComposerQueuedMessage } from "../composerDraftStore";
import type { SessionPhase } from "../types";

export function shouldQueueComposerSubmission(input: {
  readonly isServerThread: boolean;
  readonly phase: SessionPhase;
  readonly queueingEnabled: boolean;
}): boolean {
  return input.isServerThread && input.phase === "running" && input.queueingEnabled;
}

export function canAutoDrainQueuedMessage(input: {
  readonly isServerThread: boolean;
  readonly phase: SessionPhase;
  readonly isSendBusy: boolean;
  readonly isConnecting: boolean;
  readonly environmentUnavailable: boolean;
  readonly hasPendingApproval: boolean;
  readonly hasPendingUserInput: boolean;
  readonly head: ComposerQueuedMessage | undefined;
}): boolean {
  return (
    input.isServerThread &&
    input.phase === "ready" &&
    !input.isSendBusy &&
    !input.isConnecting &&
    !input.environmentUnavailable &&
    !input.hasPendingApproval &&
    !input.hasPendingUserInput &&
    input.head !== undefined &&
    input.head.status !== "failed"
  );
}

export function queuedMessageAttachmentsForTurn(message: ComposerQueuedMessage) {
  return message.attachments.map(({ name, mimeType, sizeBytes, dataUrl }) => ({
    type: "image" as const,
    name,
    mimeType,
    sizeBytes,
    dataUrl,
  }));
}
