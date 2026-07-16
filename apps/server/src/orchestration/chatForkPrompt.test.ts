import { MessageId, TurnId, type OrchestrationMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { prependCopiedForkHistory } from "./chatForkPrompt.ts";

const now = "2026-07-16T00:00:00.000Z";

function message(input: {
  readonly id: string;
  readonly role: OrchestrationMessage["role"];
  readonly text: string;
  readonly turnId?: string;
}): OrchestrationMessage {
  return {
    id: MessageId.make(input.id),
    role: input.role,
    text: input.text,
    turnId: input.turnId === undefined ? null : TurnId.make(input.turnId),
    streaming: false,
    createdAt: now,
    updatedAt: now,
  };
}

describe("prependCopiedForkHistory", () => {
  it("leaves a first turn unchanged", () => {
    expect(prependCopiedForkHistory({ history: [], message: "Continue" })).toBe("Continue");
  });

  it("marks copied history and current-filesystem semantics explicitly", () => {
    const result = prependCopiedForkHistory({
      history: [
        message({ id: "user-1", role: "user", text: "Build it" }),
        message({ id: "assistant-1", role: "assistant", text: "Done", turnId: "turn-1" }),
      ],
      message: "Take a different direction",
    });

    expect(result).toContain("<forked_conversation_history>");
    expect(result).toContain('<message role="user">\nBuild it\n</message>');
    expect(result).toContain('<message role="assistant">\nDone\n</message>');
    expect(result).toContain("The filesystem is the current filesystem state");
    expect(result).toContain("<new_user_message>\nTake a different direction\n</new_user_message>");
  });
});
