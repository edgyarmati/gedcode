import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_PARALLEL_WORKERS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  ORCHESTRATION_STAGE_ROLES,
  type OrchestrationStageRole,
  type OrchestrationGateKind,
  type OrchestratorGatePolicy,
  type OrchestratorGlobalDefaults,
  type OrchestratorProjectConfig,
  type OrchestratorResourceLimits,
  type OrchestratorTaskType,
  type TaskTypeId,
} from "@t3tools/contracts";

export type OrchestratorNumericResourceLimitKey =
  | "maxParallelTasks"
  | "maxParallelWorkers"
  | "maxRetriesPerStage";

export type OrchestratorResourceLimitKey = OrchestratorNumericResourceLimitKey;

export type OrchestratorResourceLimitProjectConfig = {
  readonly resourceLimits?: Partial<
    Pick<OrchestratorResourceLimits, OrchestratorResourceLimitKey>
  > | null;
};

export type OrchestratorResourceLimitGlobalDefaults = Partial<
  Pick<OrchestratorGlobalDefaults, OrchestratorResourceLimitKey>
>;

export type OrchestratorGatePolicyProjectConfig = {
  readonly taskTypes?: ReadonlyArray<{
    readonly id: TaskTypeId | string;
    readonly gatePolicy?: Partial<Record<OrchestrationGateKind, OrchestratorGatePolicy>> | null;
  }> | null;
};

export type OrchestratorGatePolicyGlobalDefaults = {
  readonly gatePolicy?: Partial<Record<OrchestrationGateKind, OrchestratorGatePolicy>> | null;
};

export type OrchestratorStagesProjectConfig = {
  readonly taskTypes?: ReadonlyArray<{
    readonly id: TaskTypeId | string;
    readonly stages?: ReadonlyArray<OrchestrationStageRole> | null;
  }> | null;
};

export type OrchestratorStagesGlobalDefaults = {
  readonly stages?: ReadonlyArray<OrchestrationStageRole> | null;
};

export interface ResolveGatePolicyInput {
  readonly config: OrchestratorGatePolicyProjectConfig;
  readonly defaults?: OrchestratorGatePolicyGlobalDefaults;
  readonly taskTypeId: TaskTypeId | string;
  readonly gate: OrchestrationGateKind;
}

export interface ResolveStagesInput {
  readonly config: OrchestratorStagesProjectConfig;
  readonly defaults?: OrchestratorStagesGlobalDefaults;
  readonly taskTypeId: TaskTypeId | string;
}

export interface ResolveResourceLimitInput {
  readonly config: OrchestratorResourceLimitProjectConfig;
  readonly defaults: OrchestratorResourceLimitGlobalDefaults;
  readonly key: OrchestratorNumericResourceLimitKey;
}

export interface ResolveResourceLimitsInput {
  readonly config: OrchestratorResourceLimitProjectConfig;
  readonly defaults: OrchestratorResourceLimitGlobalDefaults;
}

export type OrchestratorOpenPrAsDraftProjectConfig = {
  readonly openPrAsDraft?: boolean | null;
};

export type OrchestratorOpenPrAsDraftGlobalDefaults = {
  readonly openPrAsDraft?: boolean | null;
};

export interface ResolveOpenPrAsDraftInput {
  readonly config?: OrchestratorOpenPrAsDraftProjectConfig | null;
  readonly defaults?: OrchestratorOpenPrAsDraftGlobalDefaults | null;
}

const DEFAULT_RESOURCE_LIMIT_BY_KEY = {
  maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,
  maxParallelWorkers: DEFAULT_MAX_PARALLEL_WORKERS,
  maxRetriesPerStage: DEFAULT_MAX_RETRIES_PER_STAGE,
} as const satisfies Record<OrchestratorNumericResourceLimitKey, number>;

export function resolveConfigValue<T>(layers: ReadonlyArray<T | null | undefined>, fallback: T): T {
  for (const layer of layers) {
    if (layer !== null && layer !== undefined) {
      return layer;
    }
  }
  return fallback;
}

export function findTaskType(
  config: OrchestratorProjectConfig,
  typeId: TaskTypeId | string,
): OrchestratorTaskType | undefined {
  return config.taskTypes.find((taskType) => taskType.id === typeId);
}

function findConfiguredTaskType<TTaskType extends { readonly id: TaskTypeId | string }>(
  taskTypes: ReadonlyArray<TTaskType> | null | undefined,
  typeId: TaskTypeId | string,
): TTaskType | undefined {
  return taskTypes?.find((taskType) => taskType.id === typeId);
}

export function resolveStages(input: ResolveStagesInput): ReadonlyArray<OrchestrationStageRole> {
  return resolveConfigValue(
    [
      findConfiguredTaskType(input.config.taskTypes, input.taskTypeId)?.stages,
      input.defaults?.stages,
    ],
    ORCHESTRATION_STAGE_ROLES,
  );
}

export function resolveGatePolicy(input: ResolveGatePolicyInput): OrchestratorGatePolicy {
  if (input.gate === "land" || input.gate === "release") {
    return "require-approval";
  }

  return resolveConfigValue(
    [
      findConfiguredTaskType(input.config.taskTypes, input.taskTypeId)?.gatePolicy?.[input.gate],
      input.defaults?.gatePolicy?.[input.gate],
    ],
    "require-approval",
  );
}

export function resolveResourceLimit(input: ResolveResourceLimitInput): number {
  return resolveConfigValue(
    [input.config.resourceLimits?.[input.key], input.defaults[input.key]],
    DEFAULT_RESOURCE_LIMIT_BY_KEY[input.key],
  );
}

export function resolveResourceLimits(
  input: ResolveResourceLimitsInput,
): OrchestratorResourceLimits {
  return {
    maxParallelTasks: resolveResourceLimit({ ...input, key: "maxParallelTasks" }),
    maxParallelWorkers: resolveResourceLimit({ ...input, key: "maxParallelWorkers" }),
    maxRetriesPerStage: resolveResourceLimit({ ...input, key: "maxRetriesPerStage" }),
  };
}

export function resolveOpenPrAsDraft(input: ResolveOpenPrAsDraftInput): boolean {
  return resolveConfigValue([input.config?.openPrAsDraft, input.defaults?.openPrAsDraft], false);
}
