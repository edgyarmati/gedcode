# Spec: Fix harness-native Ged workflow prompt

## Goal

When Ged workflow is enabled, the workflow must always run. The selected harness/provider should be instructed to create native subagents for Ged workflow roles when native subagent tooling is available. If native subagents are unavailable, the main thread should execute the Ged steps itself.

## Scope

- Update workflow prompt copy to list Ged roles and responsibilities for harness-native orchestration.
- Make fallback explicit: no native subagents means the main agent performs explorer/planner/verifier steps directly and states that native subagents are unavailable.
- Remove user-facing Gedcode-managed role child-thread behavior and configuration.
- Keep Critique mode in settings, but remove now-invalid Intercom bridge, Ged main thread model, and Ged role model rows.
- Preserve deprecated settings fields only for compatibility where needed; default subagent runtime mode decodes as harness-native.
- Update tests to assert role/fallback prompt behavior, settings defaults, server prompt behavior, managed invocation refusal, and UI cleanup.

## Non-goals

- Do not implement provider-specific native subagent APIs.
- Do not launch Gedcode-managed child threads for Ged roles.
- Do not remove compatibility fields from persisted settings in this slice.
