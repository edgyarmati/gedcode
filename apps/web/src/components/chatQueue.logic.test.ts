import { CommandId, MessageId, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vitest";

import type { ComposerQueuedMessage } from "../composerDraftStore";
import {
  canAutoDrainQueuedMessage,
  queuedMessageAttachmentsForTurn,
  shouldQueueComposerSubmission,
} from "./chatQueue.logic";

function queuedMessage(status: ComposerQueuedMessage["status"]): ComposerQueuedMessage {
  return {
    id: "queue-1",
    commandId: CommandId.make("command-queue-1"),
    messageId: MessageId.make("message-queue-1"),
    text: "follow up",
    attachments: [
      {
        id: "attachment-1",
        name: "screen.png",
        mimeType: "image/png",
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,AQID",
      },
    ],
    modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6", [
      { id: "reasoningEffort", value: "high" },
    ]),
    gedWorkflowEnabled: true,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-07-16T12:00:00.000Z",
    status,
  };
}

describe("normal-chat queue decisions", () => {
  it("queues only enabled server-thread submissions during an active turn", () => {
    expect(
      shouldQueueComposerSubmission({
        isServerThread: true,
        phase: "running",
        queueingEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldQueueComposerSubmission({
        isServerThread: true,
        phase: "running",
        queueingEnabled: false,
      }),
    ).toBe(false);
    expect(
      shouldQueueComposerSubmission({
        isServerThread: false,
        phase: "running",
        queueingEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldQueueComposerSubmission({
        isServerThread: true,
        phase: "ready",
        queueingEnabled: true,
      }),
    ).toBe(false);
  });

  it("drains queued or interrupted-dispatch heads only from a settled ready thread", () => {
    const base = {
      isServerThread: true,
      phase: "ready" as const,
      isSendBusy: false,
      isConnecting: false,
      environmentUnavailable: false,
      hasPendingApproval: false,
      hasPendingUserInput: false,
    };
    expect(canAutoDrainQueuedMessage({ ...base, head: queuedMessage("queued") })).toBe(true);
    expect(canAutoDrainQueuedMessage({ ...base, head: queuedMessage("dispatching") })).toBe(true);
    expect(canAutoDrainQueuedMessage({ ...base, head: queuedMessage("failed") })).toBe(false);
    expect(
      canAutoDrainQueuedMessage({ ...base, phase: "running", head: queuedMessage("queued") }),
    ).toBe(false);
    expect(
      canAutoDrainQueuedMessage({ ...base, isSendBusy: true, head: queuedMessage("queued") }),
    ).toBe(false);
    expect(
      canAutoDrainQueuedMessage({
        ...base,
        hasPendingApproval: true,
        head: queuedMessage("queued"),
      }),
    ).toBe(false);
    expect(canAutoDrainQueuedMessage({ ...base, head: undefined })).toBe(false);
  });

  it("maps persisted queue attachments to the provider turn payload", () => {
    expect(queuedMessageAttachmentsForTurn(queuedMessage("queued"))).toEqual([
      {
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,AQID",
      },
    ]);
  });
});
