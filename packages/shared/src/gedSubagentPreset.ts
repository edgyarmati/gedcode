import {
  CODEX_GED_SUBAGENT_PRESET_ROLES,
  DEFAULT_CODEX_GED_SUBAGENT_PRESET,
  type CodexGedSubagentPreset,
  type CodexGedSubagentPresetRole,
} from "@t3tools/contracts";

export function normalizeCodexGedSubagentPreset(
  preset:
    | Partial<
        Record<
          CodexGedSubagentPresetRole,
          Partial<CodexGedSubagentPreset[CodexGedSubagentPresetRole]>
        >
      >
    | undefined,
): CodexGedSubagentPreset {
  return Object.fromEntries(
    CODEX_GED_SUBAGENT_PRESET_ROLES.map((role) => {
      const defaults = DEFAULT_CODEX_GED_SUBAGENT_PRESET[role];
      const value = preset?.[role];
      return [
        role,
        {
          model: value?.model?.trim() || defaults.model,
          reasoning: value?.reasoning ?? defaults.reasoning,
        },
      ];
    }),
  ) as CodexGedSubagentPreset;
}

export function formatCodexGedSubagentPreset(preset: CodexGedSubagentPreset): string {
  const normalized = normalizeCodexGedSubagentPreset(preset);
  return CODEX_GED_SUBAGENT_PRESET_ROLES.map((role) => {
    const value = normalized[role];
    return `${role}: model=${value.model}, reasoning=${value.reasoning}`;
  }).join("\n");
}
