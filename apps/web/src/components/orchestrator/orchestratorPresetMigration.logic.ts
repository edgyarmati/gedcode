import type {
  ModelSelection,
  OrchestratorCompletePresetMigrationInput,
  OrchestratorPresetMigrationState,
  ProjectId,
} from "@t3tools/contracts";

export const CAPABILITY_PRESET_KEYS = ["cheap", "smart", "genius"] as const;
export type CapabilityPresetKey = (typeof CAPABILITY_PRESET_KEYS)[number];

export type MigrationGlobalDraft = Record<CapabilityPresetKey, ModelSelection | null>;

export type MigrationProjectDecision =
  | { readonly kind: "inherit" }
  | {
      readonly kind: "customize";
      readonly presets: Record<CapabilityPresetKey, ModelSelection | null>;
    };

export type MigrationProjectDraft = ReadonlyMap<ProjectId, MigrationProjectDecision>;

export function emptyPresetDraft(): MigrationGlobalDraft {
  return { cheap: null, smart: null, genius: null };
}

export function isPresetMigrationDraftComplete(input: {
  readonly state: OrchestratorPresetMigrationState;
  readonly global: MigrationGlobalDraft;
  readonly projects: MigrationProjectDraft;
}): boolean {
  if (CAPABILITY_PRESET_KEYS.some((key) => input.global[key] === null)) return false;
  return input.state.projects.every((project) => {
    const decision = input.projects.get(project.projectId);
    if (!decision) return false;
    if (decision.kind === "inherit") return true;
    return CAPABILITY_PRESET_KEYS.some((key) => decision.presets[key] !== null);
  });
}

export function buildPresetMigrationCompletion(input: {
  readonly state: OrchestratorPresetMigrationState;
  readonly global: MigrationGlobalDraft;
  readonly projects: MigrationProjectDraft;
}): OrchestratorCompletePresetMigrationInput | null {
  if (!isPresetMigrationDraftComplete(input)) return null;

  const cheap = input.global.cheap;
  const smart = input.global.smart;
  const genius = input.global.genius;
  if (!cheap || !smart || !genius) return null;

  return {
    globalPresets: { cheap, smart, genius },
    projects: input.state.projects.map((project) => {
      const decision = input.projects.get(project.projectId)!;
      if (decision.kind === "inherit") {
        return { projectId: project.projectId, capabilityPresets: {} };
      }
      const capabilityPresets = Object.fromEntries(
        CAPABILITY_PRESET_KEYS.flatMap((key) => {
          const selection = decision.presets[key];
          return selection ? [[key, selection] as const] : [];
        }),
      );
      return { projectId: project.projectId, capabilityPresets };
    }),
  };
}
