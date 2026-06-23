import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildOrchestratorProjectConfig,
  buildOrchestrationConfigUpdate,
  orchestratorConfigDraftsEqual,
  orchestrationSettingsDraftsEqual,
  resolveRoleDefaultSelection,
  seedOrchestratorConfigDraft,
  seedOrchestrationSettingsDraft,
  type OrchestratorConfigDraft,
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

  it("seeds an unconfigured project from global orchestrator defaults", () => {
    const draft = seedOrchestrationSettingsDraft(
      {},
      {
        ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
        stages: ["classify", "plan", "work"],
        gatePolicy: {
          classify: "auto",
          plan: "auto",
          work: "require-approval",
          review: "auto",
          land: "require-approval",
        },
        maxParallelTasks: 3,
        maxParallelWorkers: 4,
        maxStageHandoffs: 11,
        maxRetriesPerStage: 6,
        allowFullAccessWorkers: true,
      },
    );

    expect(draft.orchestratorConfig.enabled).toBe(false);
    expect(draft.orchestratorConfig.pmModelSelection).toBeNull();
    expect(draft.orchestratorConfig.optionalStages).toEqual({ review: false, verify: false });
    expect(draft.orchestratorConfig.gatePolicy).toEqual({
      classify: "auto",
      plan: "auto",
      work: "require-approval",
      review: "auto",
    });
    expect(draft.orchestratorConfig.resourceLimits).toEqual({
      maxParallelTasks: 3,
      maxParallelWorkers: 4,
      maxStageHandoffs: 11,
      maxRetriesPerStage: 6,
      allowFullAccessWorkers: true,
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
  });

  it("round-trips a seeded config back to the same maps", () => {
    const config = {
      roleModelSelections: { work: selection("codex_task", "gpt-5-task") },
      rolePromptPrefixes: { verify: "Verify behavior." },
      orchestratorConfig: {
        enabled: true,
        pmModelSelection: selection("codex_pm", "gpt-5-pm"),
        taskTypes: [
          {
            id: "feature" as const,
            stages: ["classify", "plan", "work"],
            gatePolicy: {
              classify: "auto" as const,
              plan: "require-approval" as const,
              work: "auto" as const,
              review: "require-approval" as const,
              land: "require-approval" as const,
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
      },
    };
    expect(buildOrchestrationConfigUpdate(seedOrchestrationSettingsDraft(config))).toEqual(config);
  });
});

describe("seedOrchestratorConfigDraft", () => {
  it("uses schema defaults when config is absent", () => {
    const draft = seedOrchestratorConfigDraft(undefined);
    expect(draft).toEqual({
      enabled: false,
      pmModelSelection: null,
      optionalStages: { review: true, verify: true },
      gatePolicy: {
        classify: "require-approval",
        plan: "require-approval",
        work: "require-approval",
        review: "require-approval",
      },
      resourceLimits: {
        maxParallelTasks: 1,
        maxParallelWorkers: 1,
        maxStageHandoffs: 8,
        maxRetriesPerStage: 2,
        allowFullAccessWorkers: false,
      },
    });
  });

  it("normalizes a project config into the editor draft", () => {
    const draft = seedOrchestratorConfigDraft({
      enabled: true,
      pmModelSelection: selection("codex_pm", "gpt-5-pm"),
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
    expect(draft.pmModelSelection).toEqual(selection("codex_pm", "gpt-5-pm"));
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

  it("uses global defaults only for an empty project config", () => {
    const draft = seedOrchestratorConfigDraft(
      {},
      {
        ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
        stages: ["classify", "plan", "work", "verify"],
        gatePolicy: {
          classify: "auto",
          plan: "auto",
          work: "auto",
          review: "require-approval",
          land: "require-approval",
        },
        maxParallelTasks: 7,
        maxParallelWorkers: 8,
        maxStageHandoffs: 9,
        maxRetriesPerStage: 10,
        allowFullAccessWorkers: true,
      },
    );

    expect(draft.enabled).toBe(false);
    expect(draft.pmModelSelection).toBeNull();
    expect(draft.optionalStages).toEqual({ review: false, verify: true });
    expect(draft.gatePolicy).toEqual({
      classify: "auto",
      plan: "auto",
      work: "auto",
      review: "require-approval",
    });
    expect(draft.resourceLimits).toEqual({
      maxParallelTasks: 7,
      maxParallelWorkers: 8,
      maxStageHandoffs: 9,
      maxRetriesPerStage: 10,
      allowFullAccessWorkers: true,
    });
  });

  it("keeps a configured project config authoritative over global defaults", () => {
    const draft = seedOrchestratorConfigDraft(
      {
        enabled: true,
        pmModelSelection: selection("codex_pm", "gpt-5-pm"),
        taskTypes: [
          {
            id: "feature",
            stages: ["classify", "plan", "review", "work"],
            gatePolicy: {
              classify: "require-approval",
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
          allowFullAccessWorkers: false,
        },
      },
      {
        ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
        stages: ["classify", "plan", "work", "verify"],
        gatePolicy: {
          classify: "auto",
          plan: "auto",
          work: "auto",
          review: "require-approval",
          land: "require-approval",
        },
        maxParallelTasks: 7,
        maxParallelWorkers: 8,
        maxStageHandoffs: 9,
        maxRetriesPerStage: 10,
        allowFullAccessWorkers: true,
      },
    );

    expect(draft.enabled).toBe(true);
    expect(draft.pmModelSelection).toEqual(selection("codex_pm", "gpt-5-pm"));
    expect(draft.optionalStages).toEqual({ review: true, verify: false });
    expect(draft.gatePolicy).toEqual({
      classify: "require-approval",
      plan: "require-approval",
      work: "auto",
      review: "auto",
    });
    expect(draft.resourceLimits).toEqual({
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxStageHandoffs: 4,
      maxRetriesPerStage: 5,
      allowFullAccessWorkers: false,
    });
  });
});

describe("buildOrchestratorProjectConfig", () => {
  it("builds the full single-feature config from edited settings", () => {
    const draft: OrchestratorConfigDraft = {
      enabled: true,
      pmModelSelection: selection("codex_pm", "gpt-5-pm"),
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
      pmModelSelection: selection("codex_pm", "gpt-5-pm"),
      taskTypes: [
        {
          id: "feature",
          stages: ["classify", "plan", "work", "verify"],
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
    expect(built.taskTypes[0]?.gatePolicy.land).toBe("require-approval");
    expect(seedOrchestratorConfigDraft(built)).toEqual(draft);
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
    pmModelSelection: selection("codex_pm", "gpt-5-pm"),
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

  it("tracks edits across enabled, pm model, stages, gates, and limits", () => {
    expect(orchestratorConfigDraftsEqual(base, { ...base })).toBe(true);
    expect(orchestratorConfigDraftsEqual(base, { ...base, enabled: false })).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        pmModelSelection: selection("codex_pm", "gpt-5-other"),
      }),
    ).toBe(false);
    expect(
      orchestratorConfigDraftsEqual(base, {
        ...base,
        optionalStages: { ...base.optionalStages, review: false },
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
  });
});
