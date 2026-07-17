import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOrchestratorProjectConfig,
  buildOrchestrationConfigUpdate,
  orchestratorConfigDraftsEqual,
  orchestrationSettingsDraftsEqual,
  resolveRoleDefaultSelection,
  seedOrchestratorConfigDraft,
  seedOrchestratorInheritedDefaultsDraft,
  seedOrchestrationSettingsDraft,
  type OrchestratorConfigDraft,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";

const selection = (instanceId: string, model: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make(instanceId),
  model,
});

describe("retained orchestrator role settings", () => {
  it("seeds only plan, work, and verify roles", () => {
    const draft = seedOrchestrationSettingsDraft({
      roleModelSelections: {
        plan: selection("codex_plan", "gpt-5-plan"),
        review: selection("removed_review", "removed-model"),
      },
      rolePromptPrefixes: { work: "Use the checklist.", classify: "removed" },
    });

    expect(Object.keys(draft.roleSelections).toSorted()).toEqual(["plan", "verify", "work"]);
    expect(draft.roleSelections.plan).toEqual(selection("codex_plan", "gpt-5-plan"));
    expect(draft.roleSelections.work).toBeNull();
    expect(draft.rolePrefixes.work).toBe("Use the checklist.");
    expect(draft.rolePrefixes.verify).toBe("");
  });

  it("writes only configured retained roles and trims prefixes", () => {
    const draft: OrchestrationSettingsDraft = {
      roleSelections: {
        plan: selection("codex_plan", "gpt-5-plan"),
        work: selection("codex_work", "gpt-5-work"),
        verify: null,
      },
      rolePrefixes: {
        plan: "  Inspect first.  ",
        work: "",
        verify: "  Verify independently.  ",
      },
      orchestratorConfig: seedOrchestratorConfigDraft({}),
    };

    expect(buildOrchestrationConfigUpdate(draft)).toEqual({
      roleModelSelections: {
        plan: selection("codex_plan", "gpt-5-plan"),
        work: selection("codex_work", "gpt-5-work"),
      },
      rolePromptPrefixes: {
        plan: "Inspect first.",
        verify: "Verify independently.",
      },
      orchestratorConfig: { pmModelSelection: null },
    });
  });
});

describe("seedOrchestratorConfigDraft", () => {
  it("keeps an absent project config sparse and inherited", () => {
    expect(seedOrchestratorConfigDraft(undefined)).toEqual({
      pmModelSelection: null,
      openPrAsDraft: null,
      optionalStages: null,
      gatePolicy: { plan: null },
      resourceLimits: {
        maxParallelTasks: null,
        maxParallelWorkers: null,
        maxRetriesPerStage: null,
      },
    });
  });

  it("normalizes retained stages, plan gate, PM backend, and resource limits", () => {
    const draft = seedOrchestratorConfigDraft({
      pmModelSelection: {
        ...selection("claudeAgent", "claude-sonnet-4-6"),
        options: [{ id: "effort", value: "high" }],
      },
      openPrAsDraft: true,
      taskTypes: [
        {
          id: "feature",
          stages: ["plan", "work", "verify"],
          gatePolicy: { plan: "auto", land: "require-approval" },
        },
      ],
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxRetriesPerStage: 5,
      },
    });

    expect(draft).toEqual({
      pmModelSelection: {
        ...selection("claudeAgent", "claude-sonnet-4-6"),
        options: [{ id: "effort", value: "high" }],
      },
      openPrAsDraft: true,
      optionalStages: {},
      gatePolicy: { plan: "auto" },
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxRetriesPerStage: 5,
      },
    });
  });
});

describe("buildOrchestratorProjectConfig", () => {
  it("builds a minimal sparse config when everything inherits", () => {
    expect(buildOrchestratorProjectConfig(seedOrchestratorConfigDraft({}))).toEqual({
      pmModelSelection: null,
    });
  });

  it("writes retained stages, a plan gate override, PM selection, and limits", () => {
    const draft: OrchestratorConfigDraft = {
      pmModelSelection: selection("openai", "gpt-5-pm"),
      openPrAsDraft: true,
      optionalStages: {},
      gatePolicy: { plan: "auto" },
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxRetriesPerStage: 5,
      },
    };

    expect(buildOrchestratorProjectConfig(draft)).toEqual({
      pmModelSelection: selection("openai", "gpt-5-pm"),
      openPrAsDraft: true,
      taskTypes: [
        {
          id: "feature",
          stages: ["plan", "work", "verify"],
          gatePolicy: { plan: "auto" },
        },
      ],
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxRetriesPerStage: 5,
      },
    });
  });
});

describe("seedOrchestratorInheritedDefaultsDraft", () => {
  it("formats retained global defaults for the project editor", () => {
    expect(
      seedOrchestratorInheritedDefaultsDraft({
        stages: ["plan", "work", "verify"],
        gatePolicy: { plan: "require-approval", land: "require-approval" },
        maxParallelTasks: 3,
        maxParallelWorkers: 4,
        maxRetriesPerStage: 5,
        pmReconciliationIntervalMs: 120_000,
        worktreeReaperIntervalMinutes: 10,
        pmModelSelection: selection("openai", "gpt-5-pm"),
        defaultWorkerModelSelection: selection("codex_global", "gpt-5-global"),
        capabilityPresets: null,
        openPrAsDraft: true,
      }),
    ).toEqual({
      pmModelSelection: selection("openai", "gpt-5-pm"),
      defaultWorkerModelSelection: selection("codex_global", "gpt-5-global"),
      optionalStages: {},
      gatePolicy: { plan: "require-approval" },
      openPrAsDraft: true,
      resourceLimits: {
        maxParallelTasks: 3,
        maxParallelWorkers: 4,
        maxRetriesPerStage: 5,
      },
    });
  });
});

describe("orchestration settings equality", () => {
  const base = seedOrchestrationSettingsDraft({
    roleModelSelections: { work: selection("codex_work", "gpt-5-work") },
    rolePromptPrefixes: { verify: "Verify behavior." },
  });

  it("ignores surrounding prefix whitespace but detects meaningful role changes", () => {
    expect(
      orchestrationSettingsDraftsEqual(base, {
        ...base,
        rolePrefixes: { ...base.rolePrefixes, verify: "  Verify behavior.  " },
      }),
    ).toBe(true);
    expect(
      orchestrationSettingsDraftsEqual(base, {
        ...base,
        rolePrefixes: { ...base.rolePrefixes, plan: "Inspect migrations." },
      }),
    ).toBe(false);
  });

  it("detects PM, gate, and resource config changes", () => {
    const config = seedOrchestratorConfigDraft({});
    expect(orchestratorConfigDraftsEqual(config, { ...config })).toBe(true);
    expect(
      orchestratorConfigDraftsEqual(config, {
        ...config,
        gatePolicy: { plan: "auto" },
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(config, {
        ...config,
        resourceLimits: { ...config.resourceLimits, maxParallelWorkers: 4 },
      }),
    ).toBe(false);
  });
});

describe("resolveRoleDefaultSelection", () => {
  it("prefers the global worker default and falls back to the project", () => {
    const project = { defaultModelSelection: selection("codex", "gpt-5-default") };
    expect(
      resolveRoleDefaultSelection(project, {
        defaultWorkerModelSelection: selection("codex_global", "gpt-5-global"),
      }),
    ).toEqual(selection("codex_global", "gpt-5-global"));
    expect(resolveRoleDefaultSelection(project, { defaultWorkerModelSelection: null })).toEqual(
      selection("codex", "gpt-5-default"),
    );
  });
});
