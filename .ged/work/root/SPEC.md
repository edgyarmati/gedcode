# Codex Ged Subagent Preset

## Goal

Add a Codex-specific Ged workflow improvement so users can configure a preset describing which harness-native Ged subagents Codex should use and which reasoning/thinking levels those subagents should run with.

## Assumptions

- This is a prompt-level Codex improvement, not a new internal child-thread orchestrator.
- Codex should receive the preset only when the active provider session is Codex.
- Non-Codex providers should keep the existing Ged workflow prompt.
- The first release can use a multiline Codex provider setting instead of a larger role-by-role model picker UI.

## Scope

- Add a Codex provider setting for a Ged subagent preset.
- Pass provider context into Ged workflow prompt generation.
- Append the Codex preset to the harness-native subagent section only for Codex turns and only when subagents are enabled.
- Add tests for schema decoding, prompt generation, and service-level Codex-only behavior.
- Update public workflow docs if needed to mention Codex presets.

## Non-Goals

- No provider-native API changes.
- No automatic spawning of Gedcode-managed child threads.
- No UI redesign of the global Ged model picker.
- No changes to Claude, OpenCode, or Cursor behavior.

## Acceptance Criteria

- Codex settings include a configurable multiline Ged subagent preset.
- The preset can name Ged roles such as `ged-explorer`, `ged-planner`, and `ged-verifier` and specify model/reasoning hints.
- Codex Ged workflow prompts include the configured preset.
- Non-Codex Ged workflow prompts omit the Codex preset.
- Existing Ged workflow prompt behavior remains unchanged when no preset is configured.
- Required repo gates pass: `bun fmt`, `bun lint`, and `bun typecheck`.
