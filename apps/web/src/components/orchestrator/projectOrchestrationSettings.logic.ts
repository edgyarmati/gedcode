import {
  ORCHESTRATION_STAGE_ROLES,
  type ModelSelection,
  type OrchestrationStageRole,
} from "@t3tools/contracts";

// Per-role draft state for the project orchestration-settings editor. A `null`
// selection means "use the project default backend"; an empty prefix means "no
// per-role prompt prefix". Every stage role is always present so the form can
// render a row per role regardless of which keys the project has configured.
export interface OrchestrationSettingsDraft {
  readonly roleSelections: Readonly<Record<OrchestrationStageRole, ModelSelection | null>>;
  readonly rolePrefixes: Readonly<Record<OrchestrationStageRole, string>>;
}

// The subset of project config the editor reads and writes. Matches the
// `project.meta.update` config maps (replace-semantics — see
// `buildOrchestrationConfigUpdate`).
export interface ProjectOrchestrationConfig {
  readonly roleModelSelections?: Readonly<Record<string, ModelSelection>> | undefined;
  readonly rolePromptPrefixes?: Readonly<Record<string, string>> | undefined;
}

// The complete config maps to send on `project.meta.update`. Both maps are
// REPLACED wholesale by the server/projectors, so the editor always emits the
// full intended state (seed-from-current → edit → submit-full), never a patch.
export interface OrchestrationConfigUpdate {
  readonly roleModelSelections: Record<string, ModelSelection>;
  readonly rolePromptPrefixes: Record<string, string>;
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
  return { roleSelections, rolePrefixes };
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
  return { roleModelSelections, rolePromptPrefixes };
}

function modelSelectionsEqual(left: ModelSelection | null, right: ModelSelection | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.instanceId === right.instanceId && left.model === right.model;
}

// True when two drafts would produce the same persisted config — used to keep
// the Save action disabled until the editor actually changes something.
export function orchestrationSettingsDraftsEqual(
  left: OrchestrationSettingsDraft,
  right: OrchestrationSettingsDraft,
): boolean {
  return ORCHESTRATION_STAGE_ROLES.every(
    (role) =>
      modelSelectionsEqual(left.roleSelections[role], right.roleSelections[role]) &&
      left.rolePrefixes[role].trim() === right.rolePrefixes[role].trim(),
  );
}
