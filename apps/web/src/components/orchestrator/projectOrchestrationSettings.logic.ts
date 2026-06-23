import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_PARALLEL_WORKERS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  DEFAULT_MAX_STAGE_HANDOFFS,
  ORCHESTRATION_STAGE_ROLES,
  OrchestratorGlobalDefaults,
  OrchestratorProjectConfig,
  type OrchestratorConfigJson,
  type OrchestratorGatePolicy,
  type OrchestratorResourceLimits,
  type OrchestratorTaskGatePolicy,
  type ModelSelection,
  type OrchestrationStageRole,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const MANDATORY_ORCHESTRATOR_STAGES = ["classify", "plan", "work"] as const;
export const OPTIONAL_ORCHESTRATOR_STAGES = ["review", "verify"] as const;
export const EDITABLE_ORCHESTRATOR_GATES = ["classify", "plan", "work", "review"] as const;
export const CANONICAL_ORCHESTRATOR_STAGE_ORDER = [
  "classify",
  "plan",
  "review",
  "work",
  "verify",
] as const satisfies ReadonlyArray<OrchestrationStageRole>;

export type OptionalOrchestratorStage = (typeof OPTIONAL_ORCHESTRATOR_STAGES)[number];
export type EditableOrchestratorGate = (typeof EDITABLE_ORCHESTRATOR_GATES)[number];

const decodeOrchestratorProjectConfig = Schema.decodeUnknownOption(OrchestratorProjectConfig);
const decodeOrchestratorGlobalDefaults = Schema.decodeUnknownOption(OrchestratorGlobalDefaults);

const DEFAULT_ORCHESTRATOR_CONFIG = Option.getOrThrow(decodeOrchestratorProjectConfig({}));
const DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS = Option.getOrThrow(
  decodeOrchestratorGlobalDefaults({}),
);

const DEFAULT_FEATURE_CONFIG = DEFAULT_ORCHESTRATOR_CONFIG.taskTypes[0] ?? {
  id: "feature" as const,
  stages: ORCHESTRATION_STAGE_ROLES,
  gatePolicy: {
    classify: "require-approval" as const,
    plan: "require-approval" as const,
    work: "require-approval" as const,
    review: "require-approval" as const,
    land: "require-approval" as const,
  },
};

// Per-role draft state for the project orchestration-settings editor. A `null`
// selection means "use the project default backend"; an empty prefix means "no
// per-role prompt prefix". Every stage role is always present so the form can
// render a row per role regardless of which keys the project has configured.
export interface OrchestrationSettingsDraft {
  readonly roleSelections: Readonly<Record<OrchestrationStageRole, ModelSelection | null>>;
  readonly rolePrefixes: Readonly<Record<OrchestrationStageRole, string>>;
  readonly orchestratorConfig: OrchestratorConfigDraft;
}

export interface OrchestratorConfigDraft {
  readonly enabled: boolean;
  readonly pmModelSelection: ModelSelection | null;
  readonly optionalStages: Readonly<Record<OptionalOrchestratorStage, boolean>>;
  readonly gatePolicy: Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>;
  readonly resourceLimits: OrchestratorResourceLimits;
}

// The subset of project config the editor reads and writes. Matches the
// `project.meta.update` config maps (replace-semantics — see
// `buildOrchestrationConfigUpdate`).
export interface ProjectOrchestrationConfig {
  readonly roleModelSelections?: Readonly<Record<string, ModelSelection>> | undefined;
  readonly rolePromptPrefixes?: Readonly<Record<string, string>> | undefined;
  readonly orchestratorConfig?: OrchestratorConfigJson | undefined;
}

// The complete config maps to send on `project.meta.update`. Both maps are
// REPLACED wholesale by the server/projectors, so the editor always emits the
// full intended state (seed-from-current → edit → submit-full), never a patch.
export interface OrchestrationConfigUpdate {
  readonly roleModelSelections: Record<string, ModelSelection>;
  readonly rolePromptPrefixes: Record<string, string>;
  readonly orchestratorConfig: OrchestratorProjectConfig;
}

// Seed editor state from a project's current config. Roles without a configured
// selection seed to `null` (use default); roles without a prefix seed to "".
export function seedOrchestrationSettingsDraft(
  config: ProjectOrchestrationConfig,
  globalDefaults?: OrchestratorGlobalDefaults,
): OrchestrationSettingsDraft {
  const roleSelections = {} as Record<OrchestrationStageRole, ModelSelection | null>;
  const rolePrefixes = {} as Record<OrchestrationStageRole, string>;
  for (const role of ORCHESTRATION_STAGE_ROLES) {
    roleSelections[role] = config.roleModelSelections?.[role] ?? null;
    rolePrefixes[role] = config.rolePromptPrefixes?.[role] ?? "";
  }
  return {
    roleSelections,
    rolePrefixes,
    orchestratorConfig: seedOrchestratorConfigDraft(config.orchestratorConfig, globalDefaults),
  };
}

// Build the `project.meta.update` config maps from editor state. Roles left on
// "use default" are omitted from `roleModelSelections`; blank/whitespace-only
// prefixes are omitted from `rolePromptPrefixes` (the contract requires
// non-empty trimmed prefix values). The remaining prefixes are trimmed.
export function buildOrchestrationConfigUpdate(
  draft: OrchestrationSettingsDraft,
): OrchestrationConfigUpdate {
  const roleModelSelections: Record<string, ModelSelection> = {};
  const rolePromptPrefixes: Record<string, string> = {};
  for (const role of ORCHESTRATION_STAGE_ROLES) {
    const selection = draft.roleSelections[role];
    if (selection !== null) {
      roleModelSelections[role] = selection;
    }
    const prefix = draft.rolePrefixes[role].trim();
    if (prefix.length > 0) {
      rolePromptPrefixes[role] = prefix;
    }
  }
  return {
    roleModelSelections,
    rolePromptPrefixes,
    orchestratorConfig: buildOrchestratorProjectConfig(draft.orchestratorConfig),
  };
}

function normalizeOrchestratorProjectConfig(
  config: OrchestratorConfigJson | OrchestratorProjectConfig | undefined,
): OrchestratorProjectConfig {
  return Option.getOrElse(decodeOrchestratorProjectConfig(config ?? {}), () => ({
    ...DEFAULT_ORCHESTRATOR_CONFIG,
    taskTypes: [...DEFAULT_ORCHESTRATOR_CONFIG.taskTypes],
    resourceLimits: { ...DEFAULT_ORCHESTRATOR_CONFIG.resourceLimits },
  }));
}

function normalizeOrchestratorGlobalDefaults(
  globalDefaults: OrchestratorGlobalDefaults | undefined,
): OrchestratorGlobalDefaults {
  return Option.getOrElse(decodeOrchestratorGlobalDefaults(globalDefaults ?? {}), () => ({
    ...DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS,
    stages: [...DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.stages],
    gatePolicy: { ...DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.gatePolicy },
  }));
}

export function isProjectOrchestratorConfigUnconfigured(
  config: OrchestratorConfigJson | OrchestratorProjectConfig | undefined,
): boolean {
  return config === undefined || Object.keys(config).length === 0;
}

export function seedOrchestratorConfigDraft(
  config: OrchestratorConfigJson | OrchestratorProjectConfig | undefined,
  globalDefaults?: OrchestratorGlobalDefaults,
): OrchestratorConfigDraft {
  if (isProjectOrchestratorConfigUnconfigured(config) && globalDefaults !== undefined) {
    const normalizedGlobals = normalizeOrchestratorGlobalDefaults(globalDefaults);
    const stageSet = new Set(normalizedGlobals.stages);
    return {
      enabled: false,
      pmModelSelection: null,
      optionalStages: {
        review: stageSet.has("review"),
        verify: stageSet.has("verify"),
      },
      gatePolicy: {
        classify: normalizedGlobals.gatePolicy.classify,
        plan: normalizedGlobals.gatePolicy.plan,
        work: normalizedGlobals.gatePolicy.work,
        review: normalizedGlobals.gatePolicy.review,
      },
      resourceLimits: {
        maxParallelTasks: normalizedGlobals.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS,
        maxParallelWorkers: normalizedGlobals.maxParallelWorkers ?? DEFAULT_MAX_PARALLEL_WORKERS,
        maxStageHandoffs: normalizedGlobals.maxStageHandoffs ?? DEFAULT_MAX_STAGE_HANDOFFS,
        maxRetriesPerStage: normalizedGlobals.maxRetriesPerStage ?? DEFAULT_MAX_RETRIES_PER_STAGE,
        allowFullAccessWorkers: normalizedGlobals.allowFullAccessWorkers ?? false,
      },
    };
  }

  const normalized = normalizeOrchestratorProjectConfig(config);
  const featureConfig =
    normalized.taskTypes.find((taskType) => taskType.id === "feature") ?? DEFAULT_FEATURE_CONFIG;
  const stageSet = new Set(featureConfig.stages);
  return {
    enabled: normalized.enabled,
    pmModelSelection: normalized.pmModelSelection,
    optionalStages: {
      review: stageSet.has("review"),
      verify: stageSet.has("verify"),
    },
    gatePolicy: {
      classify: featureConfig.gatePolicy.classify,
      plan: featureConfig.gatePolicy.plan,
      work: featureConfig.gatePolicy.work,
      review: featureConfig.gatePolicy.review,
    },
    resourceLimits: {
      maxParallelTasks: normalized.resourceLimits.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS,
      maxParallelWorkers:
        normalized.resourceLimits.maxParallelWorkers ?? DEFAULT_MAX_PARALLEL_WORKERS,
      maxStageHandoffs: normalized.resourceLimits.maxStageHandoffs ?? DEFAULT_MAX_STAGE_HANDOFFS,
      maxRetriesPerStage:
        normalized.resourceLimits.maxRetriesPerStage ?? DEFAULT_MAX_RETRIES_PER_STAGE,
      allowFullAccessWorkers: normalized.resourceLimits.allowFullAccessWorkers ?? false,
    },
  };
}

export function buildOrchestratorProjectConfig(
  draft: OrchestratorConfigDraft,
): OrchestratorProjectConfig {
  const stageSet = new Set<OrchestrationStageRole>(MANDATORY_ORCHESTRATOR_STAGES);
  for (const stage of OPTIONAL_ORCHESTRATOR_STAGES) {
    if (draft.optionalStages[stage]) {
      stageSet.add(stage);
    }
  }
  const gatePolicy: OrchestratorTaskGatePolicy = {
    classify: draft.gatePolicy.classify,
    plan: draft.gatePolicy.plan,
    work: draft.gatePolicy.work,
    review: draft.gatePolicy.review,
    land: "require-approval",
  };
  return {
    enabled: draft.enabled,
    pmModelSelection: draft.pmModelSelection,
    taskTypes: [
      {
        id: "feature",
        stages: CANONICAL_ORCHESTRATOR_STAGE_ORDER.filter((stage) => stageSet.has(stage)),
        gatePolicy,
      },
    ],
    resourceLimits: {
      maxParallelTasks: draft.resourceLimits.maxParallelTasks,
      maxParallelWorkers: draft.resourceLimits.maxParallelWorkers,
      maxStageHandoffs: draft.resourceLimits.maxStageHandoffs,
      maxRetriesPerStage: draft.resourceLimits.maxRetriesPerStage,
      allowFullAccessWorkers: draft.resourceLimits.allowFullAccessWorkers,
    },
  };
}

function modelSelectionsEqual(left: ModelSelection | null, right: ModelSelection | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.instanceId === right.instanceId && left.model === right.model;
}

// The backend a per-task override would inherit for a role when left on
// "use default": the project's per-role selection, else the project default.
// Shown in the task override editor's "use default" option so the inherited
// backend is visible.
export function resolveRoleDefaultSelection(
  role: OrchestrationStageRole,
  project: {
    readonly defaultModelSelection?: ModelSelection | null;
    readonly roleModelSelections?: Readonly<Record<string, ModelSelection>> | undefined;
  },
): ModelSelection | null {
  return project.roleModelSelections?.[role] ?? project.defaultModelSelection ?? null;
}

// True when two drafts would produce the same persisted config — used to keep
// the Save action disabled until the editor actually changes something.
export function orchestrationSettingsDraftsEqual(
  left: OrchestrationSettingsDraft,
  right: OrchestrationSettingsDraft,
): boolean {
  return (
    ORCHESTRATION_STAGE_ROLES.every(
      (role) =>
        modelSelectionsEqual(left.roleSelections[role], right.roleSelections[role]) &&
        left.rolePrefixes[role].trim() === right.rolePrefixes[role].trim(),
    ) && orchestratorConfigDraftsEqual(left.orchestratorConfig, right.orchestratorConfig)
  );
}

export function orchestratorConfigDraftsEqual(
  left: OrchestratorConfigDraft,
  right: OrchestratorConfigDraft,
): boolean {
  return (
    left.enabled === right.enabled &&
    modelSelectionsEqual(left.pmModelSelection, right.pmModelSelection) &&
    OPTIONAL_ORCHESTRATOR_STAGES.every(
      (stage) => left.optionalStages[stage] === right.optionalStages[stage],
    ) &&
    EDITABLE_ORCHESTRATOR_GATES.every((gate) => left.gatePolicy[gate] === right.gatePolicy[gate]) &&
    left.resourceLimits.maxParallelTasks === right.resourceLimits.maxParallelTasks &&
    left.resourceLimits.maxParallelWorkers === right.resourceLimits.maxParallelWorkers &&
    left.resourceLimits.maxStageHandoffs === right.resourceLimits.maxStageHandoffs &&
    left.resourceLimits.maxRetriesPerStage === right.resourceLimits.maxRetriesPerStage &&
    left.resourceLimits.allowFullAccessWorkers === right.resourceLimits.allowFullAccessWorkers
  );
}
