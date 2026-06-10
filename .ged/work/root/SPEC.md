# Spec: Strict Ged subagent sequencing and role toggles

## Goal

Ged workflow prompts should make enabled role subagents sequential gates instead of parallel sidecars, while still preserving single-writer checkpoint ownership. Users should also be able to disable explorer, planner, or verifier subagents individually and have the main agent perform that role instead.

## Decisions

- Keep single-writer checkpoint ownership. Subagents never edit checkpoint files.
- Enabled role subagents must be waited on before the main agent proceeds through that role's gate.
- Disabled or unavailable roles run on the main agent and record the same checkpoint gate using `source: "main"`.
- Add UI controls for `ged-explorer`, `ged-planner`, and `ged-verifier` role enablement.

## Requirements

- The prompt must direct the main agent to wait for explorer before local source inspection.
- The prompt must direct the main agent to wait for planner before finalizing `SPEC.md`, `TASKS.md`, and `TESTS.md`.
- The prompt must direct the main agent to run verifier after checks, fix findings, rerun checks, and rerun verifier until clean before committing.
- The prompt must clearly state subagents return structured evidence and the main agent writes checkpoint confirmations.
- Checkpoint schema/validation must accept `source: "main"`.
- Server prompt generation must pass existing `gedRoleSettings` into the workflow prompt.
- Settings UI must expose per-role subagent toggles without dropping other `gedRoleSettings` entries.
- Update tests and `CHANGELOG.md`.

## Non-Goals

- Do not add hard server-side enforcement for source-inspection sequencing in this slice.
- Do not reintroduce Gedcode-managed child role threads.
- Do not add a new settings field when existing `gedRoleSettings` can represent role enablement.
