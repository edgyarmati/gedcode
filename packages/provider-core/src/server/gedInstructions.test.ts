import { assert, describe, it } from "@effect/vitest";

import {
  t3AcpPromptWithInstructions,
  t3OrchestrationPromptForFirstRun,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

const asksForMemory = "call `ged_memory_list`";

describe("Ged agent instructions", () => {
  it("reach every instruction channel an agent with T3 MCP gets", () => {
    assert.include(t3OrchestrationSystemPrompt(true), asksForMemory);
    assert.include(
      t3OrchestrationPromptForFirstRun({ prompt: "hi", runOrdinal: 1, hasT3Mcp: true }),
      asksForMemory,
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt: "hi",
        state: { interactionMode: "default", hasT3Mcp: true },
      }),
      asksForMemory,
    );
  });

  it("say when to offer setup and when to stay quiet", () => {
    const instructions = t3OrchestrationSystemPrompt(true) ?? "";
    assert.include(instructions, "When `offerSetup` is true");
    assert.include(instructions, "When `offerSetup` is false, do not bring it up");
  });

  it("stay out of agents without T3 MCP, which cannot call the tool", () => {
    assert.strictEqual(t3OrchestrationSystemPrompt(false), undefined);
    assert.strictEqual(
      t3OrchestrationPromptForFirstRun({ prompt: "hi", runOrdinal: 1, hasT3Mcp: false }),
      "hi",
    );
  });
});
