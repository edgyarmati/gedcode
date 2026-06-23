import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_PARALLEL_WORKERS,
  DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_ENABLED,
  DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS,
  DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_RESERVE_TOKENS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  DEFAULT_MAX_STAGE_HANDOFFS,
  type OrchestratorAutoCompactionDefaults,
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
  | "maxStageHandoffs"
  | "maxRetriesPerStage";

export type OrchestratorResourceLimitKey =
  | OrchestratorNumericResourceLimitKey
  | "allowFullAccessWorkers";

export type OrchestratorResourceLimitProjectConfig = {
  readonly resourceLimits?: Partial<
    Pick<OrchestratorResourceLimits, OrchestratorResourceLimitKey>
  > | null;
};

export type OrchestratorResourceLimitGlobalDefaults = Partial<
  Pick<OrchestratorGlobalDefaults, OrchestratorResourceLimitKey>
>;

export interface ResolveGatePolicyInput {
  readonly config: OrchestratorProjectConfig;
  readonly taskTypeId: TaskTypeId | string;
  readonly gate: OrchestrationGateKind;
}

export interface ResolveResourceLimitInput {
  readonly config: OrchestratorResourceLimitProjectConfig;
  readonly defaults: OrchestratorResourceLimitGlobalDefaults;
  readonly key: OrchestratorNumericResourceLimitKey;
}

export interface ResolveAllowFullAccessWorkersInput {
  readonly config: OrchestratorResourceLimitProjectConfig;
  readonly defaults: OrchestratorResourceLimitGlobalDefaults;
}

export interface ResolveResourceLimitsInput {
  readonly config: OrchestratorResourceLimitProjectConfig;
  readonly defaults: OrchestratorResourceLimitGlobalDefaults;
}

export type OrchestratorAutoCompactionProjectConfig = {
  readonly autoCompaction?: Partial<OrchestratorAutoCompactionDefaults> | null;
};

export type OrchestratorAutoCompactionGlobalDefaults = {
  readonly autoCompaction?: Partial<OrchestratorGlobalDefaults["autoCompaction"]> | null;
};

export interface ResolveAutoCompactionInput {
  readonly config?: OrchestratorAutoCompactionProjectConfig;
  readonly defaults: OrchestratorAutoCompactionGlobalDefaults;
}

const DEFAULT_RESOURCE_LIMIT_BY_KEY = {
  maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,
  maxParallelWorkers: DEFAULT_MAX_PARALLEL_WORKERS,
  maxStageHandoffs: DEFAULT_MAX_STAGE_HANDOFFS,
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

export function resolveGatePolicy(input: ResolveGatePolicyInput): OrchestratorGatePolicy {
  if (input.gate === "land") {
    return "require-approval";
  }

  return resolveConfigValue(
    [findTaskType(input.config, input.taskTypeId)?.gatePolicy[input.gate]],
    "require-approval",
  );
}

export function resolveResourceLimit(input: ResolveResourceLimitInput): number {
  return resolveConfigValue(
    [input.config.resourceLimits?.[input.key], input.defaults[input.key]],
    DEFAULT_RESOURCE_LIMIT_BY_KEY[input.key],
  );
}

export function resolveAllowFullAccessWorkers(input: ResolveAllowFullAccessWorkersInput): boolean {
  return (
    input.config.resourceLimits?.allowFullAccessWorkers === true ||
    input.defaults.allowFullAccessWorkers === true
  );
}

export function resolveResourceLimits(
  input: ResolveResourceLimitsInput,
): OrchestratorResourceLimits {
  return {
    maxParallelTasks: resolveResourceLimit({ ...input, key: "maxParallelTasks" }),
    maxParallelWorkers: resolveResourceLimit({ ...input, key: "maxParallelWorkers" }),
    maxStageHandoffs: resolveResourceLimit({ ...input, key: "maxStageHandoffs" }),
    maxRetriesPerStage: resolveResourceLimit({ ...input, key: "maxRetriesPerStage" }),
    allowFullAccessWorkers: resolveAllowFullAccessWorkers(input),
  };
}

export function resolveAutoCompaction(
  input: ResolveAutoCompactionInput,
): OrchestratorAutoCompactionDefaults {
  const customInstructions = resolveConfigValue(
    [
      input.config?.autoCompaction?.customInstructions,
      input.defaults.autoCompaction?.customInstructions,
    ],
    undefined,
  );

  return {
    enabled: resolveConfigValue(
      [input.config?.autoCompaction?.enabled, input.defaults.autoCompaction?.enabled],
      DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_ENABLED,
    ),
    reserveTokens: resolveConfigValue(
      [input.config?.autoCompaction?.reserveTokens, input.defaults.autoCompaction?.reserveTokens],
      DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_RESERVE_TOKENS,
    ),
    keepRecentTokens: resolveConfigValue(
      [
        input.config?.autoCompaction?.keepRecentTokens,
        input.defaults.autoCompaction?.keepRecentTokens,
      ],
      DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS,
    ),
    ...(customInstructions !== undefined ? { customInstructions } : {}),
  };
}
