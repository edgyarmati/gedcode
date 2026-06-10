# Spec: Native Codex Ged subagent access and presets

## Goal

When Ged subagents are enabled, Codex agents should understand that the setting authorizes native Codex subagent spawning and that each Ged role must use the model and reasoning values configured in the Codex Ged subagent preset.

## Current Findings

- Codex app-server initialization already opts into `experimentalApi: true`, so native experimental tool exposure is already requested from Codex.
- The workflow prompt describes harness-native subagents, but its fallback wording can be over-read as acceptable even when native tools exist.
- The prompt says to use the preset, but does not explicitly bind each role line to native subagent tool arguments such as `model` and `reasoning_effort`.
- The global settings copy still says “role threads,” which conflicts with the intended harness-native behavior.

## Requirements

- Keep Ged subagents harness-native; do not reintroduce Gedcode-managed child role threads.
- Prompt agents to spawn native subagents whenever native delegation tools are exposed and Ged subagents are enabled.
- Prompt Codex agents to map each configured role preset to the native subagent call's model and reasoning-effort fields.
- Preserve per-provider-instance Codex preset resolution.
- Update user-facing settings copy so it describes native harness subagents, not role threads.
- Add regression coverage for the exact prompt/settings contract.
- Document the unreleased change.

## Non-Goals

- Do not implement a separate Gedcode child-thread runtime.
- Do not change Codex app-server generated protocol schemas.
- Do not make native subagents mandatory when the selected harness genuinely exposes no native subagent/delegation tool.
