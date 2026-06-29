import {
  PiProviderId,
  ProviderInstanceId,
  type ModelSelection,
  type PiModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOrchestratorProjectConfig,
  buildEnabledPiProviderPickerEntries,
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

const pmSelection = (piProvider: string, model: string): PiModelSelection => ({
  piProvider: PiProviderId.make(piProvider),
  model,
});

describe("seedOrchestrationSettingsDraft", () => {
  it("includes every stage role, defaulting unset selections/prefixes", () => {
    const draft = seedOrchestrationSettingsDraft({
      roleModelSelections: { review: selection("codex_project", "gpt-5-project") },
      rolePromptPrefixes: { work: "Use the checklist." },
    });
    expect(Object.keys(draft.roleSelections).toSorted()).toEqual([
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

  it("seeds an unconfigured project as all inherited orchestrator settings", () => {
    const draft = seedOrchestrationSettingsDraft({});

    expect(draft.orchestratorConfig).toEqual({
      enabled: false,
      pmModelSelection: null,
      openPrAsDraft: null,
      optionalStages: null,
      gatePolicy: {
        classify: null,
        plan: null,
        work: null,
        review: null,
      },
      resourceLimits: {
        maxParallelTasks: null,
        maxParallelWorkers: null,
        maxStageHandoffs: null,
        maxRetriesPerStage: null,
        allowFullAccessWorkers: null,
      },
    });
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
      orchestratorConfig: seedOrchestratorConfigDraft({}),
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
    expect(update.orchestratorConfig).toEqual(
      buildOrchestratorProjectConfig(draft.orchestratorConfig),
    );
    expect(update.orchestratorConfig).toEqual({ enabled: false, pmModelSelection: null });
  });

  it("round-trips a seeded sparse config back to the same maps", () => {
    const config = {
      roleModelSelections: { work: selection("codex_task", "gpt-5-task") },
      rolePromptPrefixes: { verify: "Verify behavior." },
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: pmSelection("openai", "gpt-5-pm"),
        openPrAsDraft: true,
        taskTypes: [
          {
            id: "feature" as const,
            stages: ["classify", "plan", "work"],
            gatePolicy: {
              plan: "require-approval" as const,
            },
          },
        ],
        resourceLimits: {
          maxParallelWorkers: 3,
        },
      },
    };
    expect(buildOrchestrationConfigUpdate(seedOrchestrationSettingsDraft(config))).toEqual(config);
  });
});

describe("seedOrchestratorConfigDraft", () => {
  it("uses inherited values when config is absent", () => {
    const draft = seedOrchestratorConfigDraft(undefined);
    expect(draft).toEqual({
      enabled: false,
      pmModelSelection: null,
      openPrAsDraft: null,
      optionalStages: null,
      gatePolicy: {
        classify: null,
        plan: null,
        work: null,
        review: null,
      },
      resourceLimits: {
        maxParallelTasks: null,
        maxParallelWorkers: null,
        maxStageHandoffs: null,
        maxRetriesPerStage: null,
        allowFullAccessWorkers: null,
      },
    });
  });

  it("normalizes a project config into the editor draft", () => {
    const draft = seedOrchestratorConfigDraft({
      enabled: true,
      pmModelSelection: pmSelection("openai", "gpt-5-pm"),
      openPrAsDraft: true,
      taskTypes: [
        {
          id: "feature",
          stages: ["classify", "plan", "review", "work"],
          gatePolicy: {
            classify: "auto",
            plan: "require-approval",
            work: "auto",
            review: "auto",
            land: "require-approval",
          },
        },
      ],
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxStageHandoffs: 4,
        maxRetriesPerStage: 5,
        allowFullAccessWorkers: true,
      },
    });
    expect(draft.enabled).toBe(true);
    expect(draft.pmModelSelection).toEqual(pmSelection("openai", "gpt-5-pm"));
    expect(draft.openPrAsDraft).toBe(true);
    expect(draft.optionalStages).toEqual({ review: true, verify: false });
    expect(draft.gatePolicy).toEqual({
      classify: "auto",
      plan: "require-approval",
      work: "auto",
      review: "auto",
    });
    expect(draft.resourceLimits).toEqual({
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxStageHandoffs: 4,
      maxRetriesPerStage: 5,
      allowFullAccessWorkers: true,
    });
  });

  it("seeds an empty project config as inherited rather than global-filled", () => {
    const draft = seedOrchestratorConfigDraft({});

    expect(draft.enabled).toBe(false);
    expect(draft.pmModelSelection).toBeNull();
    expect(draft.openPrAsDraft).toBeNull();
    expect(draft.optionalStages).toBeNull();
    expect(draft.gatePolicy).toEqual({
      classify: null,
      plan: null,
      work: null,
      review: null,
    });
    expect(draft.resourceLimits).toEqual({
      maxParallelTasks: null,
      maxParallelWorkers: null,
      maxStageHandoffs: null,
      maxRetriesPerStage: null,
      allowFullAccessWorkers: null,
    });
  });

  it("seeds only the current project's explicit sparse config", () => {
    const draft = seedOrchestratorConfigDraft({
      enabled: true,
      pmModelSelection: pmSelection("openai", "gpt-5-pm"),
      openPrAsDraft: false,
      taskTypes: [
        {
          id: "feature",
          gatePolicy: {
            work: "auto",
          },
        },
      ],
      resourceLimits: {
        maxRetriesPerStage: 5,
      },
    });

    expect(draft.enabled).toBe(true);
    expect(draft.pmModelSelection).toEqual(pmSelection("openai", "gpt-5-pm"));
    expect(draft.openPrAsDraft).toBe(false);
    expect(draft.optionalStages).toBeNull();
    expect(draft.gatePolicy).toEqual({
      classify: null,
      plan: null,
      work: "auto",
      review: null,
    });
    expect(draft.resourceLimits).toEqual({
      maxParallelTasks: null,
      maxParallelWorkers: null,
      maxStageHandoffs: null,
      maxRetriesPerStage: 5,
      allowFullAccessWorkers: null,
    });
  });
});

describe("buildOrchestratorProjectConfig", () => {
  it("builds a minimal sparse config when all inheritable settings use global", () => {
    const draft = seedOrchestratorConfigDraft({});

    expect(buildOrchestratorProjectConfig(draft)).toEqual({
      enabled: false,
      pmModelSelection: null,
    });
  });

  it("writes only one overridden gate under the feature task type", () => {
    const draft: OrchestratorConfigDraft = {
      ...seedOrchestratorConfigDraft({}),
      gatePolicy: {
        classify: null,
        plan: "auto",
        work: null,
        review: null,
      },
    };

    expect(buildOrchestratorProjectConfig(draft)).toEqual({
      enabled: false,
      pmModelSelection: null,
      taskTypes: [
        {
          id: "feature",
          gatePolicy: {
            plan: "auto",
          },
        },
      ],
    });
  });

  it("writes only one overridden resource limit", () => {
    const draft: OrchestratorConfigDraft = {
      ...seedOrchestratorConfigDraft({}),
      resourceLimits: {
        maxParallelTasks: null,
        maxParallelWorkers: 3,
        maxStageHandoffs: null,
        maxRetriesPerStage: null,
        allowFullAccessWorkers: null,
      },
    };

    expect(buildOrchestratorProjectConfig(draft)).toEqual({
      enabled: false,
      pmModelSelection: null,
      resourceLimits: {
        maxParallelWorkers: 3,
      },
    });
  });

  it("writes only an explicit landing PR mode override", () => {
    const draft: OrchestratorConfigDraft = {
      ...seedOrchestratorConfigDraft({}),
      openPrAsDraft: true,
    };

    expect(buildOrchestratorProjectConfig(draft)).toEqual({
      enabled: false,
      pmModelSelection: null,
      openPrAsDraft: true,
    });
    expect(seedOrchestratorConfigDraft(buildOrchestratorProjectConfig(draft))).toEqual(draft);
  });

  it("builds sparse feature config from edited settings", () => {
    const draft: OrchestratorConfigDraft = {
      enabled: true,
      pmModelSelection: pmSelection("openai", "gpt-5-pm"),
      openPrAsDraft: true,
      optionalStages: { review: false, verify: true },
      gatePolicy: {
        classify: "auto",
        plan: "require-approval",
        work: "auto",
        review: "auto",
      },
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxStageHandoffs: 4,
        maxRetriesPerStage: 5,
        allowFullAccessWorkers: true,
      },
    };
    expect(buildOrchestratorProjectConfig(draft)).toEqual({
      enabled: true,
      pmModelSelection: pmSelection("openai", "gpt-5-pm"),
      openPrAsDraft: true,
      taskTypes: [
        {
          id: "feature",
          stages: ["classify", "plan", "work", "verify"],
          gatePolicy: {
            classify: "auto",
            plan: "require-approval",
            work: "auto",
            review: "auto",
          },
        },
      ],
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxStageHandoffs: 4,
        maxRetriesPerStage: 5,
        allowFullAccessWorkers: true,
      },
    });
  });

  it("keeps land require-approval across round trips", () => {
    const draft = seedOrchestratorConfigDraft({
      enabled: true,
      taskTypes: [
        {
          id: "feature",
          stages: ["classify", "plan", "work"],
          gatePolicy: {
            classify: "auto",
            plan: "auto",
            work: "auto",
            review: "auto",
            land: "require-approval",
          },
        },
      ],
    });
    const built = buildOrchestratorProjectConfig(draft);
    const feature = (
      built.taskTypes as
        | ReadonlyArray<{ readonly gatePolicy?: Record<string, unknown> }>
        | undefined
    )?.[0];
    expect(feature?.gatePolicy).not.toHaveProperty("land");
    expect(seedOrchestratorConfigDraft(built)).toEqual(draft);
  });
});

describe("seedOrchestratorInheritedDefaultsDraft", () => {
  it("formats global defaults for inherited display without writing them to project seed", () => {
    expect(
      seedOrchestratorInheritedDefaultsDraft({
        stages: ["classify", "plan", "work", "verify"],
        gatePolicy: {
          classify: "auto",
          plan: "require-approval",
          work: "auto",
          review: "require-approval",
          land: "require-approval",
        },
        maxParallelTasks: 3,
        maxParallelWorkers: 4,
        maxStageHandoffs: 9,
        maxRetriesPerStage: 5,
        pmReconciliationIntervalMs: 120_000,
        worktreeReaperIntervalMinutes: 10,
        pmModelSelection: pmSelection("openai", "gpt-5-pm"),
        defaultWorkerModelSelection: selection("codex_global", "gpt-5-global"),
        openPrAsDraft: true,
        autoCompaction: {
          enabled: true,
          reserveTokens: 8_000,
          keepRecentTokens: 12_000,
        },
        allowFullAccessWorkers: true,
      }),
    ).toEqual({
      pmModelSelection: pmSelection("openai", "gpt-5-pm"),
      defaultWorkerModelSelection: selection("codex_global", "gpt-5-global"),
      optionalStages: { review: false, verify: true },
      gatePolicy: {
        classify: "auto",
        plan: "require-approval",
        work: "auto",
        review: "require-approval",
      },
      openPrAsDraft: true,
      resourceLimits: {
        maxParallelTasks: 3,
        maxParallelWorkers: 4,
        maxStageHandoffs: 9,
        maxRetriesPerStage: 5,
        allowFullAccessWorkers: true,
      },
    });
  });
});

describe("buildEnabledPiProviderPickerEntries", () => {
  it("lists only enabled pi providers with their models", () => {
    expect(
      buildEnabledPiProviderPickerEntries({
        catalog: [
          {
            id: PiProviderId.make("openai"),
            displayName: "OpenAI",
            kind: "apiKey",
            configured: true,
            enabled: true,
          },
          {
            id: PiProviderId.make("anthropic"),
            displayName: "Anthropic",
            kind: "oauth",
            configured: true,
            enabled: false,
          },
        ],
        modelsByProvider: {
          openai: [{ id: "gpt-5", name: "GPT-5", contextWindow: 128_000 }],
          anthropic: [{ id: "claude-opus-4-6", name: "Claude Opus", contextWindow: 200_000 }],
        },
      }),
    ).toEqual([
      {
        piProvider: PiProviderId.make("openai"),
        displayName: "OpenAI",
        models: [{ id: "gpt-5", name: "GPT-5" }],
      },
    ]);
  });
});

describe("resolveRoleDefaultSelection", () => {
  const project = {
    defaultModelSelection: selection("codex", "gpt-5-default"),
  };
  const globalDefaults = {
    defaultWorkerModelSelection: selection("codex_global", "gpt-5-global"),
  };

  it("uses the global worker default before the project default", () => {
    expect(resolveRoleDefaultSelection(project, globalDefaults)).toEqual(
      selection("codex_global", "gpt-5-global"),
    );
  });

  it("falls back to the project default when the global default is unset", () => {
    expect(resolveRoleDefaultSelection(project, { defaultWorkerModelSelection: null })).toEqual(
      selection("codex", "gpt-5-default"),
    );
  });

  it("is null when neither the global worker default nor project default exists", () => {
    expect(
      resolveRoleDefaultSelection(
        { defaultModelSelection: null },
        { defaultWorkerModelSelection: null },
      ),
    ).toBeNull();
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
      orchestratorConfig: base.orchestratorConfig,
    };
    expect(orchestrationSettingsDraftsEqual(base, padded)).toBe(true);
  });

  it("is false when a selection or prefix changes meaningfully", () => {
    const changedSelection: OrchestrationSettingsDraft = {
      roleSelections: { ...base.roleSelections, work: selection("codex", "gpt-5-default") },
      rolePrefixes: base.rolePrefixes,
      orchestratorConfig: base.orchestratorConfig,
    };
    const changedPrefix: OrchestrationSettingsDraft = {
      roleSelections: base.roleSelections,
      rolePrefixes: { ...base.rolePrefixes, classify: "Classify strictly." },
      orchestratorConfig: base.orchestratorConfig,
    };
    const changedOrchestratorConfig: OrchestrationSettingsDraft = {
      roleSelections: base.roleSelections,
      rolePrefixes: base.rolePrefixes,
      orchestratorConfig: { ...base.orchestratorConfig, enabled: !base.orchestratorConfig.enabled },
    };
    expect(orchestrationSettingsDraftsEqual(base, changedSelection)).toBe(false);
    expect(orchestrationSettingsDraftsEqual(base, changedPrefix)).toBe(false);
    expect(orchestrationSettingsDraftsEqual(base, changedOrchestratorConfig)).toBe(false);
  });
});

describe("orchestratorConfigDraftsEqual", () => {
  const base = seedOrchestratorConfigDraft({
    enabled: true,
    pmModelSelection: pmSelection("openai", "gpt-5-pm"),
    openPrAsDraft: true,
    taskTypes: [
      {
        id: "feature",
        stages: ["classify", "plan", "review", "work", "verify"],
        gatePolicy: {
          classify: "auto",
          plan: "require-approval",
          work: "auto",
          review: "require-approval",
          land: "require-approval",
        },
      },
    ],
    resourceLimits: {
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxStageHandoffs: 4,
      maxRetriesPerStage: 5,
      allowFullAccessWorkers: false,
    },
  });

  it("tracks edits across enabled, pm model, landing PR mode, stages, gates, and limits", () => {
    expect(orchestratorConfigDraftsEqual(base, { ...base })).toBe(true);
    expect(orchestratorConfigDraftsEqual(base, { ...base, enabled: false })).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        pmModelSelection: pmSelection("openai", "gpt-5-other"),
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        openPrAsDraft: false,
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        optionalStages: { review: false, verify: true },
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        gatePolicy: { ...base.gatePolicy, plan: "auto" },
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        resourceLimits: { ...base.resourceLimits, maxParallelWorkers: 4 },
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(seedOrchestratorConfigDraft({}), {
        ...seedOrchestratorConfigDraft({}),
        optionalStages: { review: true, verify: true },
      }),
    ).toBe(false);
  });
});
