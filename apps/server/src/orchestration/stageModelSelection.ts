import type {
  ModelSelection,
  OrchestrationProject,
  OrchestrationStageRole,
  OrchestrationTask,
} from "@t3tools/contracts";

export function resolveStageModelSelection(input: {
  readonly project: Pick<OrchestrationProject, "defaultModelSelection" | "roleModelSelections">;
  readonly role: OrchestrationStageRole;
  readonly task: Pick<OrchestrationTask, "roleModelSelections">;
}): ModelSelection | null {
  return (
    input.task.roleModelSelections?.[input.role] ??
    input.project.roleModelSelections?.[input.role] ??
    input.project.defaultModelSelection
  );
}

export function taskStatusForStageRole(
  role: OrchestrationStageRole,
): Extract<
  OrchestrationTask["status"],
  "classified" | "planning" | "reviewing" | "working" | "verifying"
> {
  switch (role) {
    case "plan":
      return "planning";
    case "review":
      return "reviewing";
    case "work":
      return "working";
    case "verify":
      return "verifying";
    case "classify":
      return "classified";
  }
}
