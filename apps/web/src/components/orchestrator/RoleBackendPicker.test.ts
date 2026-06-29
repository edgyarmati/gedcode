import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { formatDefaultBackendLabel } from "./RoleBackendPicker";

function selection(instanceId: string, model: string): ModelSelection {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    model,
  };
}

describe("formatDefaultBackendLabel", () => {
  it("shows the resolved backend in the inherited default label", () => {
    expect(
      formatDefaultBackendLabel({
        selection: selection("codex_worker", "gpt-5-worker"),
        entry: { displayName: "Codex Worker" } as ProviderInstanceEntry,
      }),
    ).toBe("Use default - Codex Worker · gpt-5-worker");
  });

  it("falls back to the raw instance id when the provider entry is missing", () => {
    expect(
      formatDefaultBackendLabel({
        selection: selection("codex_worker", "gpt-5-worker"),
        entry: undefined,
      }),
    ).toBe("Use default - codex_worker · gpt-5-worker");
  });

  it("does not invent a backend label when no default resolves", () => {
    expect(formatDefaultBackendLabel({ selection: null, entry: undefined })).toBe("Use default");
  });
});
