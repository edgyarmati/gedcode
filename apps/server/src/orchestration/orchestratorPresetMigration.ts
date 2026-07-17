import type {
  OrchestrationCapabilityPresetOverrides,
  OrchestrationCapabilityPresets,
  OrchestrationProject,
  OrchestrationReadModel,
  OrchestratorCompletePresetMigrationInput,
  OrchestratorPresetMigrationState,
  ServerSettings,
} from "@t3tools/contracts";

function hasLegacyRoleSelections(project: OrchestrationProject): boolean {
  return Object.keys(project.roleModelSelections ?? {}).length > 0;
}

export function buildOrchestratorPresetMigrationState(input: {
  readonly settings: ServerSettings;
  readonly readModel: Pick<OrchestrationReadModel, "projects">;
}): OrchestratorPresetMigrationState {
  const projects = input.readModel.projects
    .filter((project) => project.deletedAt === null && hasLegacyRoleSelections(project))
    .map((project) => ({
      projectId: project.id,
      title: project.title,
      roleModelSelections: project.roleModelSelections ?? {},
    }))
    .toSorted(
      (left, right) =>
        left.title.localeCompare(right.title) ||
        String(left.projectId).localeCompare(right.projectId),
    );

  return {
    status:
      input.settings.orchestratorDefaults.capabilityPresets === null ? "required" : "completed",
    legacyGlobalSelection: input.settings.orchestratorDefaults.defaultWorkerModelSelection ?? null,
    projects,
  };
}

export function validateOrchestratorPresetMigrationCompletion(input: {
  readonly state: OrchestratorPresetMigrationState;
  readonly completion: OrchestratorCompletePresetMigrationInput;
}): ReadonlyMap<string, OrchestrationCapabilityPresetOverrides> {
  const decisions = new Map<string, OrchestrationCapabilityPresetOverrides>();
  for (const project of input.completion.projects) {
    const projectId = String(project.projectId);
    if (decisions.has(projectId)) {
      throw new Error(`Duplicate project preset migration decision for '${projectId}'.`);
    }
    decisions.set(projectId, project.capabilityPresets);
  }

  const requiredIds = new Set(input.state.projects.map((project) => String(project.projectId)));
  const missing = [...requiredIds].filter((projectId) => !decisions.has(projectId));
  const unknown = [...decisions.keys()].filter((projectId) => !requiredIds.has(projectId));
  if (missing.length > 0 || unknown.length > 0) {
    const details = [
      ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
      ...(unknown.length > 0 ? [`unknown: ${unknown.join(", ")}`] : []),
    ];
    throw new Error(`Project preset migration decisions must be exact (${details.join("; ")}).`);
  }
  return decisions;
}

export function configuredOrchestratorDefaults(input: {
  readonly settings: ServerSettings;
  readonly globalPresets: OrchestrationCapabilityPresets;
}): ServerSettings["orchestratorDefaults"] {
  return {
    ...input.settings.orchestratorDefaults,
    capabilityPresets: input.globalPresets,
    defaultWorkerModelSelection: null,
  };
}
