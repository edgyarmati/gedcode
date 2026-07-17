import type {
  ModelSelection,
  OrchestrationCapabilityTier,
  OrchestrationProject,
  OrchestrationStageRole,
  OrchestrationTask,
} from "@t3tools/contracts";
import type {
  SparseOrchestratorDefaults,
  SparseProjectConfig,
} from "./orchestratorConfigResolution.ts";

export function resolveCapabilityPreset(input: {
  readonly orchestratorDefaults?: Pick<SparseOrchestratorDefaults, "capabilityPresets">;
  readonly projectConfig?: Pick<SparseProjectConfig, "capabilityPresets">;
  readonly tier: OrchestrationCapabilityTier;
}): ModelSelection | null {
  return (
    input.projectConfig?.capabilityPresets?.[input.tier] ??
    input.orchestratorDefaults?.capabilityPresets?.[input.tier] ??
    null
  );
}

export function resolveStageModelSelection(input: {
  readonly orchestratorDefaults?: {
    readonly defaultWorkerModelSelection?: ModelSelection | null | undefined;
  };
  readonly project: Pick<OrchestrationProject, "defaultModelSelection" | "roleModelSelections">;
  readonly role: OrchestrationStageRole;
  readonly task: Pick<OrchestrationTask, "roleModelSelections">;
}): ModelSelection | null {
  return (
    input.task.roleModelSelections?.[input.role] ??
    input.project.roleModelSelections?.[input.role] ??
    input.orchestratorDefaults?.defaultWorkerModelSelection ??
    input.project.defaultModelSelection
  );
}

export function taskStatusForStageRole(
  role: OrchestrationStageRole,
): Extract<OrchestrationTask["status"], "planning" | "working" | "verifying"> {
  switch (role) {
    case "plan":
      return "planning";
    case "work":
      return "working";
    case "verify":
      return "verifying";
  }
}
