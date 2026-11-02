import { assert, describe, it } from "@effect/vitest";

import {
  T3_CODE_ORCHESTRATION_SECTIONS,
  t3AcpPromptWithInstructions,
  t3OrchestrationPrompt,
  t3OrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

const asksForMemory = "call `ged_memory_list`";

describe("Ged agent instructions", () => {
  it("reach every instruction channel an agent with T3 MCP gets", () => {
    assert.include(t3OrchestrationSystemPrompt(true, false), asksForMemory);
    assert.include(
      t3OrchestrationPrompt({
        prompt: "hi",
        hasT3Mcp: true,
        hasDeviceTools: false,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      }),
      asksForMemory,
    );
    assert.include(
      t3AcpPromptWithInstructions({
        prompt: "hi",
        state: { interactionMode: "default", hasT3Mcp: true, hasDeviceTools: false },
      }),
      asksForMemory,
    );
  });

  it("say when to offer setup and when to stay quiet", () => {
    const instructions = t3OrchestrationSystemPrompt(true, false) ?? "";
    assert.include(instructions, "When `offerSetup` is true");
    assert.include(instructions, "When `offerSetup` is false, do not bring it up");
  });

  it("prefers usable cross-vendor review and requires fresh fallback without skipping review", () => {
    const instructions = t3OrchestrationSystemPrompt(true, false) ?? "";
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
    assert.strictEqual(t3OrchestrationSystemPrompt(false, false), undefined);
    assert.strictEqual(
      t3OrchestrationPrompt({
        prompt: "hi",
        hasT3Mcp: false,
        hasDeviceTools: false,
        orchestrationDelivered: false,
        deviceInstructionsDelivered: false,
      }),
      "hi",
    );
  });

  it("keeps the complete Ged policy within Codex's per-section limit", () => {
    for (const section of T3_CODE_ORCHESTRATION_SECTIONS) {
      assert.isBelow(Buffer.byteLength(section, "utf8"), 4_000);
    }
    assert.include(T3_CODE_ORCHESTRATION_SECTIONS[0] ?? "", asksForMemory);
    assert.include(T3_CODE_ORCHESTRATION_SECTIONS[0] ?? "", "ged_init");
  });
});
