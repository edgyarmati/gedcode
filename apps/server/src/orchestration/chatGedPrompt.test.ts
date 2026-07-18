import { describe, expect, it } from "vitest";

import { applyGedChatWorkflowPrompt, GED_CHAT_WORKFLOW_INSTRUCTIONS } from "./chatGedPrompt.ts";

describe("applyGedChatWorkflowPrompt", () => {
  it("leaves normal chat turns byte-for-byte unchanged", () => {
    expect(applyGedChatWorkflowPrompt({ message: "Fix the race.", enabled: false })).toBe(
      "Fix the race.",
    );
  });

  it("keeps the complete GED workflow guidance stable", () => {
    expect(GED_CHAT_WORKFLOW_INSTRUCTIONS).toMatchInlineSnapshot(`
      "GED workflow mode is enabled for this chat.

      Follow the repository's GED workflow and keep its checkpoint documents current:
      - For non-trivial work, clarify important product decisions before implementation. Use the grill-with-docs skill when it is available: inspect the environment for facts, ask one decision at a time, capture resolved project language in root CONTEXT.md and only warranted decisions in docs/adr/, then transition from clarify to ged-planning after shared understanding is confirmed.
      - Write or refresh .ged/work/root/SPEC.md, TASKS.md, and TESTS.md before implementing broad changes. Use the ged-planning skill when it is available.
      - Implement one bounded NEXT slice at a time and record progress in .ged/work/root/STATE.md. Use the ged-execution skill when it is available.
      - Verify the completed slice before committing it, including repository-required format, lint, typecheck, and test gates. Use the ged-verification skill when it is available.
      - Make small, descriptive, atomic commits and preserve unrelated user changes.

      GED mode does not require managed subagents or special role models. Provider-native delegation remains at your discretion."
    `);
  });

  it("adds lightweight GED skill guidance without mandating managed subagents", () => {
    const result = applyGedChatWorkflowPrompt({ message: "Fix the race.", enabled: true });

    expect(result).toContain(GED_CHAT_WORKFLOW_INSTRUCTIONS);
    expect(result).toContain("grill-with-docs skill");
    expect(result).not.toContain("grill-me");
    expect(result).toContain("ask one decision at a time");
    expect(result).toContain("root CONTEXT.md");
    expect(result).toContain("docs/adr/");
    expect(result).toContain("transition from clarify to ged-planning");
    expect(result).toContain("ged-planning skill");
    expect(result).toContain("ged-execution skill");
    expect(result).toContain("ged-verification skill");
    expect(result).toContain("does not require managed subagents");
    expect(result.endsWith("User request:\nFix the race.")).toBe(true);
  });
});
