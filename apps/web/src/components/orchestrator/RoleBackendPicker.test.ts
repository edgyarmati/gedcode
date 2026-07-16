import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { describe, expect, it } from "vitest";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { formatDefaultBackendLabel, reconcileBackendSelection } from "./RoleBackendPicker";

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

  it("shows the inherited thinking level", () => {
    expect(
      formatDefaultBackendLabel({
        selection: {
          ...selection("codex_worker", "gpt-5-worker"),
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        entry: { displayName: "Codex Worker" } as ProviderInstanceEntry,
      }),
    ).toBe("Use default - Codex Worker · gpt-5-worker · high");
  });
});

describe("reconcileBackendSelection", () => {
  it("preserves supported thinking options and drops stale options after a model change", () => {
    const entry = {
      instanceId: ProviderInstanceId.make("codex_worker"),
      driverKind: "codex",
      models: [
        {
          slug: "gpt-5-worker",
          name: "GPT-5 Worker",
          isCustom: false,
          capabilities: createModelCapabilities({
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning",
                type: "select",
                options: [
                  { id: "medium", label: "Medium", isDefault: true },
                  { id: "high", label: "High" },
                ],
                currentValue: "medium",
              },
            ],
          }),
        },
      ],
    } as unknown as ProviderInstanceEntry;

    expect(
      reconcileBackendSelection({
        current: {
          ...selection("other", "old"),
          options: [
            { id: "reasoningEffort", value: "high" },
            { id: "removedOption", value: true },
          ],
        },
        entry,
        model: "gpt-5-worker",
      }),
    ).toEqual({
      instanceId: "codex_worker",
      model: "gpt-5-worker",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });
});
