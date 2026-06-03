# Codex Ged Subagent Preset Pickers

## Goal

Replace the Codex-only Ged subagent preset textarea with a structured selector UI: one row per supported Codex native Ged subagent role, each with a Codex model picker and reasoning-level picker.

Default preset:

```text
ged-explorer: model=gpt-5.4-mini, reasoning=medium
ged-planner: model=gpt-5.5, reasoning=xhigh
ged-verifier: model=gpt-5.5, reasoning=low
```

## Structured contract

- Keep the field name `gedSubagentPreset`, but change its value from `string` to a structured record keyed by the Codex-native roles `ged-explorer`, `ged-planner`, and `ged-verifier`.
- Each role value is `{ model: string; reasoning: "low" | "medium" | "high" | "xhigh" }`.
- No legacy string compatibility is required because the app is pre-first-release.
- Update full settings and patch schemas so persisted defaults, settings updates, and UI edits all use the same structured shape.

## Defaulting and precedence

- A missing `gedSubagentPreset` means the default structured preset.
- Partial presets are normalized role-by-role: missing role/model/reasoning values fall back to that role's default.
- Resolve order stays: selected Codex instance config first, then global Codex settings. An instance only overrides the global preset if it explicitly contains `gedSubagentPreset`; otherwise global settings apply.
- The server formats the resolved structured preset into the Codex prompt text in stable order: explorer, planner, verifier.

## UI behavior

- Render rows for `ged-explorer`, `ged-planner`, and `ged-verifier`.
- The model picker should use the exact provider instance model metadata available to the settings form. If unavailable, include current/default slugs so the control remains usable.
- Reasoning options come from the selected model's `reasoningEffort` descriptor when available; otherwise use `none`, `minimal`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`.
- If the configured reasoning is absent from the selected model descriptor, preserve it and include it as an extra option rather than coercing silently.

## Non-goals

- Do not change Gedcode-managed role model selections.
- Do not add future roles (`ged-plan-reviewer`, `ged-worker`) unless existing code already requires them.
- Do not change global Ged subagent enable/disable semantics.
