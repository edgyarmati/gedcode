import { describe, expect, it } from "vitest";

import { applyGedChatWorkflowPrompt, GED_CHAT_WORKFLOW_INSTRUCTIONS } from "./chatGedPrompt.ts";

describe("applyGedChatWorkflowPrompt", () => {
  it("leaves normal chat turns byte-for-byte unchanged", () => {
    expect(applyGedChatWorkflowPrompt({ message: "Fix the race.", enabled: false })).toBe(
      "Fix the race.",
    );
  });

  it("adds lightweight GED skill guidance without mandating managed subagents", () => {
    const result = applyGedChatWorkflowPrompt({ message: "Fix the race.", enabled: true });

    expect(result).toContain(GED_CHAT_WORKFLOW_INSTRUCTIONS);
    expect(result).toContain("grill-me skill");
    expect(result).toContain("ged-planning skill");
    expect(result).toContain("ged-execution skill");
    expect(result).toContain("ged-verification skill");
    expect(result).toContain("does not require managed subagents");
    expect(result.endsWith("User request:\nFix the race.")).toBe(true);
  });
});
