import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOrchestrationConfigUpdate,
  orchestrationSettingsDraftsEqual,
  resolveRoleDefaultSelection,
  seedOrchestrationSettingsDraft,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";

const selection = (instanceId: string, model: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});

describe("seedOrchestrationSettingsDraft", () => {
  it("includes every stage role, defaulting unset selections/prefixes", () => {
    const draft = seedOrchestrationSettingsDraft({
      roleModelSelections: { review: selection("codex_project", "gpt-5-project") },
      rolePromptPrefixes: { work: "Use the checklist." },
    });
    expect(Object.keys(draft.roleSelections).sort()).toEqual([
      "classify",
      "plan",
      "review",
      "verify",
      "work",
    ]);
    expect(draft.roleSelections.review).toEqual(selection("codex_project", "gpt-5-project"));
    expect(draft.roleSelections.classify).toBeNull();
    expect(draft.rolePrefixes.work).toBe("Use the checklist.");
    expect(draft.rolePrefixes.classify).toBe("");
  });

  it("treats absent config maps as all-default", () => {
    const draft = seedOrchestrationSettingsDraft({});
    expect(Object.values(draft.roleSelections).every((value) => value === null)).toBe(true);
    expect(Object.values(draft.rolePrefixes).every((value) => value === "")).toBe(true);
  });
});

describe("buildOrchestrationConfigUpdate", () => {
  it("omits default selections and blank prefixes, trimming the rest", () => {
    const draft: OrchestrationSettingsDraft = {
      roleSelections: {
        classify: null,
        plan: null,
        review: selection("codex_project", "gpt-5-project"),
        work: selection("codex_task", "gpt-5-task"),
        verify: null,
      },
      rolePrefixes: {
        classify: "",
        plan: "   ",
        review: "",
        work: "  Implement carefully.  ",
        verify: "Verify behavior.",
      },
    };
    const update = buildOrchestrationConfigUpdate(draft);
    expect(update.roleModelSelections).toEqual({
      review: selection("codex_project", "gpt-5-project"),
      work: selection("codex_task", "gpt-5-task"),
    });
    expect(update.roleModelSelections.classify).toBeUndefined();
    expect(update.rolePromptPrefixes).toEqual({
      work: "Implement carefully.",
      verify: "Verify behavior.",
    });
    expect(update.rolePromptPrefixes.plan).toBeUndefined();
  });

  it("round-trips a seeded config back to the same maps", () => {
    const config = {
      roleModelSelections: { work: selection("codex_task", "gpt-5-task") },
      rolePromptPrefixes: { verify: "Verify behavior." },
    };
    expect(buildOrchestrationConfigUpdate(seedOrchestrationSettingsDraft(config))).toEqual(config);
  });
});

describe("resolveRoleDefaultSelection", () => {
  const project = {
    defaultModelSelection: selection("codex", "gpt-5-default"),
    roleModelSelections: { review: selection("codex_project", "gpt-5-project") },
  };

  it("prefers the project per-role selection over the project default", () => {
    expect(resolveRoleDefaultSelection("review", project)).toEqual(
      selection("codex_project", "gpt-5-project"),
    );
  });

  it("falls back to the project default when the role is unset", () => {
    expect(resolveRoleDefaultSelection("work", project)).toEqual(
      selection("codex", "gpt-5-default"),
    );
  });

  it("is null when neither a role selection nor a project default exists", () => {
    expect(resolveRoleDefaultSelection("work", { defaultModelSelection: null })).toBeNull();
  });
});

describe("orchestrationSettingsDraftsEqual", () => {
  const base = seedOrchestrationSettingsDraft({
    roleModelSelections: { work: selection("codex_task", "gpt-5-task") },
    rolePromptPrefixes: { verify: "Verify behavior." },
  });

  it("is true for drafts that differ only by prefix whitespace", () => {
    const padded: OrchestrationSettingsDraft = {
      roleSelections: base.roleSelections,
      rolePrefixes: { ...base.rolePrefixes, verify: "  Verify behavior.  " },
    };
    expect(orchestrationSettingsDraftsEqual(base, padded)).toBe(true);
  });

  it("is false when a selection or prefix changes meaningfully", () => {
    const changedSelection: OrchestrationSettingsDraft = {
      roleSelections: { ...base.roleSelections, work: selection("codex", "gpt-5-default") },
      rolePrefixes: base.rolePrefixes,
    };
    const changedPrefix: OrchestrationSettingsDraft = {
      roleSelections: base.roleSelections,
      rolePrefixes: { ...base.rolePrefixes, classify: "Classify strictly." },
    };
    expect(orchestrationSettingsDraftsEqual(base, changedSelection)).toBe(false);
    expect(orchestrationSettingsDraftsEqual(base, changedPrefix)).toBe(false);
  });
});
