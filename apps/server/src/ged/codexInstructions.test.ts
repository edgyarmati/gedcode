import { assert, describe, it } from "@effect/vitest";

import { buildCodexAdditionalContext } from "../provider/CodexDeveloperInstructions.ts";

describe("Ged in Codex turn context", () => {
  it("tells Codex to check Ged memory on every turn's T3 context", () => {
    const context = buildCodexAdditionalContext({
      model: "gpt-5.3-codex",
      reasoningEffort: "high",
    });
    assert.include(context.t3_code_orchestration!.value, "call `ged_memory_list`");
  });
});
