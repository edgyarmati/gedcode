import { assert, describe, it } from "@effect/vitest";
import { GED_AGENT_INSTRUCTIONS } from "@t3tools/provider-core/server/orchestrationInstructions";

import {
  buildCodexAdditionalContext,
  CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES,
} from "../provider/CodexDeveloperInstructions.ts";

describe("Ged in Codex turn context", () => {
  it("delivers the full Ged section within Codex's per-entry byte limit", () => {
    const context = buildCodexAdditionalContext({
      model: "gpt-6.1-sol",
      reasoningEffort: "high",
    });
    const sections = Object.entries(context)
      .filter(([key]) => /^t3_code_orchestration_\d{2}$/.test(key))
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => entry.value);
    assert.isNotEmpty(sections);
    assert.include(sections.join("\n\n"), GED_AGENT_INSTRUCTIONS.trim());
    for (const section of sections) {
      assert.isAtMost(Buffer.byteLength(section, "utf8"), CODEX_ADDITIONAL_CONTEXT_VALUE_MAX_BYTES);
    }
  });
});
