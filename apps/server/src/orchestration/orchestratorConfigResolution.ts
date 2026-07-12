import {
  type OrchestrationGateKind,
  type OrchestrationStageRole,
  type OrchestratorConfigJson,
  type OrchestratorGatePolicy,
  type OrchestratorGlobalDefaults,
  type OrchestratorResourceLimits,
} from "@t3tools/contracts";
import {
  type OrchestratorResourceLimitKey,
  type OrchestratorStagesGlobalDefaults,
  type OrchestratorResourceLimitGlobalDefaults,
  type OrchestratorGatePolicyGlobalDefaults,
} from "@t3tools/shared/orchestrator";

export type SparseTaskTypeConfig = {
  readonly id: string;
  readonly stages?: ReadonlyArray<OrchestrationStageRole>;
  readonly gatePolicy?: Partial<Record<OrchestrationGateKind, OrchestratorGatePolicy>>;
};

export type SparseResourceLimits = Partial<{
  -readonly [Key in OrchestratorResourceLimitKey]: OrchestratorResourceLimits[Key];
}>;

export type SparseProjectConfig = {
  readonly openPrAsDraft?: boolean;
  readonly resourceLimits?: SparseResourceLimits | null;
  readonly taskTypes?: ReadonlyArray<SparseTaskTypeConfig>;
};

export type SparseOrchestratorDefaults = Partial<Omit<OrchestratorGlobalDefaults, "gatePolicy">> &
  OrchestratorStagesGlobalDefaults &
  OrchestratorResourceLimitGlobalDefaults &
  OrchestratorGatePolicyGlobalDefaults;

const numericResourceLimitKeys = [
  "maxParallelTasks",
  "maxParallelWorkers",
  "maxRetriesPerStage",
] as const satisfies ReadonlyArray<keyof OrchestratorResourceLimits>;

const gatePolicyKeys = [
  "classify",
  "plan",
  "work",
  "review",
  "land",
] as const satisfies ReadonlyArray<OrchestrationGateKind>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function explicitlySetProjectConfig(
  rawConfig: OrchestratorConfigJson | undefined,
): SparseProjectConfig {
  const raw: Record<string, unknown> = rawConfig ?? {};
  const resourceLimits = asRecord(raw.resourceLimits);
  const sparseResourceLimits: SparseResourceLimits = {};
  if (resourceLimits !== undefined) {
    for (const key of numericResourceLimitKeys) {
      if (typeof resourceLimits[key] === "number") {
        sparseResourceLimits[key] = resourceLimits[key];
      }
    }
  }

  const taskTypes = Array.isArray(raw.taskTypes)
    ? raw.taskTypes.flatMap((rawTaskType): ReadonlyArray<SparseTaskTypeConfig> => {
        const taskType = asRecord(rawTaskType);
        if (taskType === undefined || typeof taskType.id !== "string") {
          return [];
        }

        const gatePolicy = asRecord(taskType.gatePolicy);
        const sparseGatePolicy: Partial<Record<OrchestrationGateKind, OrchestratorGatePolicy>> = {};
        if (gatePolicy !== undefined) {
          for (const key of gatePolicyKeys) {
            if (gatePolicy[key] === "auto" || gatePolicy[key] === "require-approval") {
              sparseGatePolicy[key] = gatePolicy[key];
            }
          }
        }

        return [
          {
            id: taskType.id,
            ...(Array.isArray(taskType.stages)
              ? { stages: taskType.stages as ReadonlyArray<OrchestrationStageRole> }
              : {}),
            ...(Object.keys(sparseGatePolicy).length > 0 ? { gatePolicy: sparseGatePolicy } : {}),
          },
        ];
      })
    : undefined;

  return {
    ...(typeof raw.openPrAsDraft === "boolean" ? { openPrAsDraft: raw.openPrAsDraft } : {}),
    ...(Object.keys(sparseResourceLimits).length > 0
      ? { resourceLimits: sparseResourceLimits }
      : {}),
    ...(taskTypes !== undefined ? { taskTypes } : {}),
  };
}
