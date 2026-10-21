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

  it("prefers usable cross-vendor review and requires fresh fallback without skipping review", () => {
    const instructions = t3OrchestrationSystemPrompt(true) ?? "";
    for (const text of [
      "Cross-vendor review is preferred, never a subscription gate",
      "unknown quota telemetry is not confirmed exhaustion",
      "automatically delegate a strong same-provider reviewer in a fresh context",
      "ged_verdict_write.selectionReason",
      "never fabricate `otherVendorAvailable`",
    ])
      assert.include(instructions, text);
    assert.include(instructions, "or repeatedly retry an exhausted provider");
    assert.include(instructions, "two independent fresh review contexts");
    assert.include(instructions, "Actual failing findings remain blocking");
    assert.include(instructions, "If no provider can review, report pending/unavailable");
  });

  it("stay out of agents without T3 MCP, which cannot call the tool", () => {
    assert.strictEqual(t3OrchestrationSystemPrompt(false), undefined);
    assert.strictEqual(
      t3OrchestrationPromptForFirstRun({ prompt: "hi", runOrdinal: 1, hasT3Mcp: false }),
      "hi",
    );
  });
});
