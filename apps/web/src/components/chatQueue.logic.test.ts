import { describe, expect, it } from "vitest";

import { shouldQueueComposerSubmission } from "./chatQueue.logic";

describe("normal-chat queue decisions", () => {
  it("queues only enabled server-thread submissions during an active turn", () => {
    expect(
      shouldQueueComposerSubmission({
        isServerThread: true,
        phase: "running",
        messageQueueEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldQueueComposerSubmission({
        isServerThread: true,
        phase: "running",
        messageQueueEnabled: false,
      }),
    ).toBe(false);
    expect(
      shouldQueueComposerSubmission({
        isServerThread: false,
        phase: "running",
        messageQueueEnabled: true,
      }),
    ).toBe(false);
    expect(
      shouldQueueComposerSubmission({
        isServerThread: true,
        phase: "ready",
        messageQueueEnabled: true,
      }),
    ).toBe(false);
  });
});
