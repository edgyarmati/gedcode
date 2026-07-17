import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_PARALLEL_WORKERS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  ModelSelection,
  ORCHESTRATION_CAPABILITY_TIERS,
  ORCHESTRATION_STAGE_ROLES,
  type OrchestratorCapabilityPresets,
  OrchestratorGlobalDefaults,
  type OrchestratorConfigJson,
  type OrchestratorGatePolicy,
  type OrchestratorResourceLimits,
  type OrchestrationStageRole,
} from "@t3tools/contracts";
import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const MANDATORY_ORCHESTRATOR_STAGES = ["plan", "work", "verify"] as const;
export const OPTIONAL_ORCHESTRATOR_STAGES = [] as const;
export const EDITABLE_ORCHESTRATOR_GATES = ["plan"] as const;
export const CANONICAL_ORCHESTRATOR_STAGE_ORDER = ORCHESTRATION_STAGE_ROLES;

export type OptionalOrchestratorStage = (typeof OPTIONAL_ORCHESTRATOR_STAGES)[number];
export type EditableOrchestratorGate = (typeof EDITABLE_ORCHESTRATOR_GATES)[number];
export type InheritableOrchestratorStages = Readonly<
  Record<OptionalOrchestratorStage, boolean>
> | null;
export type InheritableOrchestratorGatePolicy = Readonly<
  Record<EditableOrchestratorGate, OrchestratorGatePolicy | null>
>;
export interface InheritableOrchestratorResourceLimits {
  readonly maxParallelTasks: number | null;
  readonly maxParallelWorkers: number | null;
  readonly maxRetriesPerStage: number | null;
}

const decodeOrchestratorGlobalDefaults = Schema.decodeUnknownOption(OrchestratorGlobalDefaults);

const DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS = Option.getOrThrow(
  decodeOrchestratorGlobalDefaults({}),
);

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
  readonly pmModelSelection: ModelSelection | null;
  readonly openPrAsDraft: boolean | null;
  readonly capabilityPresets: Readonly<
    Record<(typeof ORCHESTRATION_CAPABILITY_TIERS)[number], ModelSelection | null>
  >;
  readonly optionalStages: InheritableOrchestratorStages;
  readonly gatePolicy: InheritableOrchestratorGatePolicy;
  readonly resourceLimits: InheritableOrchestratorResourceLimits;
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
  readonly orchestratorConfig: OrchestratorConfigJson;
}

// Seed editor state from a project's current config. Roles without a configured
// selection seed to `null` (use default); roles without a prefix seed to "".
export function seedOrchestrationSettingsDraft(
  config: ProjectOrchestrationConfig,
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
    orchestratorConfig: seedOrchestratorConfigDraft(config.orchestratorConfig),
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

function normalizeOrchestratorGlobalDefaults(
  globalDefaults: OrchestratorGlobalDefaults | undefined,
): OrchestratorGlobalDefaults {
  return Option.getOrElse(decodeOrchestratorGlobalDefaults(globalDefaults ?? {}), () => ({
    ...DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS,
    stages: [...DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.stages],
    gatePolicy: { ...DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.gatePolicy },
  }));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asGatePolicy(value: unknown): OrchestratorGatePolicy | null {
  return value === "auto" || value === "require-approval" ? value : null;
}

const decodeModelSelectionOption = Schema.decodeUnknownOption(ModelSelection);

function asModelSelection(value: unknown): ModelSelection | null {
  return Option.getOrNull(decodeModelSelectionOption(value));
}

function findFeatureTaskType(config: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(config.taskTypes)) {
    return undefined;
  }
  return config.taskTypes.map(asRecord).find((taskType) => taskType?.id === "feature");
}

export function seedOrchestratorConfigDraft(
  config: OrchestratorConfigJson | undefined,
): OrchestratorConfigDraft {
  const raw = asRecord(config) ?? {};
  const featureConfig = findFeatureTaskType(raw);
  const explicitStages = Array.isArray(featureConfig?.stages)
    ? new Set(featureConfig.stages)
    : null;
  const gatePolicy = asRecord(featureConfig?.gatePolicy);
  const resourceLimits = asRecord(raw.resourceLimits);
  const capabilityPresets = asRecord(raw.capabilityPresets);
  return {
    pmModelSelection: asModelSelection(raw.pmModelSelection),
    openPrAsDraft: typeof raw.openPrAsDraft === "boolean" ? raw.openPrAsDraft : null,
    capabilityPresets: {
      cheap: asModelSelection(capabilityPresets?.cheap),
      smart: asModelSelection(capabilityPresets?.smart),
      genius: asModelSelection(capabilityPresets?.genius),
    },
    optionalStages: explicitStages === null ? null : {},
    gatePolicy: {
      plan: asGatePolicy(gatePolicy?.plan),
    },
    resourceLimits: {
      maxParallelTasks: asPositiveInt(resourceLimits?.maxParallelTasks),
      maxParallelWorkers: asPositiveInt(resourceLimits?.maxParallelWorkers),
      maxRetriesPerStage: asPositiveInt(resourceLimits?.maxRetriesPerStage),
    },
  };
}

export function buildOrchestratorProjectConfig(
  draft: OrchestratorConfigDraft,
): OrchestratorConfigJson {
  const featureConfig: Record<string, unknown> = { id: "feature" };
  if (draft.optionalStages !== null) {
    const stageSet = new Set<OrchestrationStageRole>(MANDATORY_ORCHESTRATOR_STAGES);
    for (const stage of OPTIONAL_ORCHESTRATOR_STAGES) {
      if (draft.optionalStages[stage]) {
        stageSet.add(stage);
      }
    }
    featureConfig.stages = CANONICAL_ORCHESTRATOR_STAGE_ORDER.filter((stage) =>
      stageSet.has(stage),
    );
  }

  const gatePolicy = Object.fromEntries(
    EDITABLE_ORCHESTRATOR_GATES.flatMap((gate) => {
      const policy = draft.gatePolicy[gate];
      return policy === null ? [] : [[gate, policy]];
    }),
  );
  if (Object.keys(gatePolicy).length > 0) {
    featureConfig.gatePolicy = gatePolicy;
  }

  const resourceLimits = Object.fromEntries(
    (["maxParallelTasks", "maxParallelWorkers", "maxRetriesPerStage"] as const).flatMap((key) => {
      const value = draft.resourceLimits[key];
      return value === null ? [] : [[key, value]];
    }),
  );
  const capabilityPresets = Object.fromEntries(
    ORCHESTRATION_CAPABILITY_TIERS.flatMap((preset) => {
      const selection = draft.capabilityPresets[preset];
      return selection === null ? [] : [[preset, selection]];
    }),
  );

  return {
    pmModelSelection: draft.pmModelSelection,
    capabilityPresets,
    ...(draft.openPrAsDraft === null ? {} : { openPrAsDraft: draft.openPrAsDraft }),
    ...(Object.keys(featureConfig).length > 1 ? { taskTypes: [featureConfig] } : {}),
    ...(Object.keys(resourceLimits).length > 0 ? { resourceLimits } : {}),
  };
}

export function seedOrchestratorInheritedDefaultsDraft(
  globalDefaults: OrchestratorGlobalDefaults | undefined,
): {
  readonly pmModelSelection: ModelSelection | null;
  readonly defaultWorkerModelSelection: ModelSelection | null;
  readonly capabilityPresets: OrchestratorCapabilityPresets | null;
  readonly optionalStages: Readonly<Record<OptionalOrchestratorStage, boolean>>;
  readonly gatePolicy: Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>;
  readonly openPrAsDraft: boolean;
  readonly resourceLimits: OrchestratorResourceLimits;
} {
  const normalizedGlobals = normalizeOrchestratorGlobalDefaults(globalDefaults);
  return {
    pmModelSelection: normalizedGlobals.pmModelSelection,
    defaultWorkerModelSelection: normalizedGlobals.defaultWorkerModelSelection,
    capabilityPresets: normalizedGlobals.capabilityPresets,
    optionalStages: {},
    gatePolicy: {
      plan: normalizedGlobals.gatePolicy.plan,
    },
    openPrAsDraft: normalizedGlobals.openPrAsDraft,
    resourceLimits: {
      maxParallelTasks: normalizedGlobals.maxParallelTasks ?? DEFAULT_MAX_PARALLEL_TASKS,
      maxParallelWorkers: normalizedGlobals.maxParallelWorkers ?? DEFAULT_MAX_PARALLEL_WORKERS,
      maxRetriesPerStage: normalizedGlobals.maxRetriesPerStage ?? DEFAULT_MAX_RETRIES_PER_STAGE,
    },
  };
}

function modelSelectionsEqual(left: ModelSelection | null, right: ModelSelection | null): boolean {
  return Equal.equals(left, right);
}

// The backend a project role inherits when left on "use default": the global
// worker default, else the project default. Shown in the picker so the inherited
// backend is visible before clearing a per-role override.
export function resolveRoleDefaultSelection(
  project: {
    readonly defaultModelSelection?: ModelSelection | null;
  },
  globalDefaults?:
    | {
        readonly defaultWorkerModelSelection?: ModelSelection | null | undefined;
      }
    | undefined,
): ModelSelection | null {
  return globalDefaults?.defaultWorkerModelSelection ?? project.defaultModelSelection ?? null;
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
    modelSelectionsEqual(left.pmModelSelection, right.pmModelSelection) &&
    ORCHESTRATION_CAPABILITY_TIERS.every((preset) =>
      modelSelectionsEqual(left.capabilityPresets[preset], right.capabilityPresets[preset]),
    ) &&
    left.openPrAsDraft === right.openPrAsDraft &&
    ((left.optionalStages === null && right.optionalStages === null) ||
      (left.optionalStages !== null &&
        right.optionalStages !== null &&
        OPTIONAL_ORCHESTRATOR_STAGES.every(
          (stage) => left.optionalStages?.[stage] === right.optionalStages?.[stage],
        ))) &&
    EDITABLE_ORCHESTRATOR_GATES.every((gate) => left.gatePolicy[gate] === right.gatePolicy[gate]) &&
    left.resourceLimits.maxParallelTasks === right.resourceLimits.maxParallelTasks &&
    left.resourceLimits.maxParallelWorkers === right.resourceLimits.maxParallelWorkers &&
    left.resourceLimits.maxRetriesPerStage === right.resourceLimits.maxRetriesPerStage
  );
}
