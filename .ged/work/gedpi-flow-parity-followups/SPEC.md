# Spec: GedPi-style orchestration configuration parity

## Goal

Make Gedcode's Ged workflow configuration ready for user testing with UI/configuration parity to the GedPi orchestration setup screen:

- Subagents can be enabled/disabled globally.
- Intercom bridge can be configured globally.
- Critique mode can be configured globally (`off`, `risk-based`, `always`).
- Main Ged thread default model remains independently configurable.
- Ged subagent roles are visible/configurable: `ged-explorer`, `ged-planner`, `ged-plan-reviewer`, `ged-verifier`, `ged-worker`.
- Every role can be enabled/disabled and assigned its own provider/model through Gedcode's provider harness.
- Project override UI supports all roles, not just explorer.
- Existing explorer runtime model routing remains correct and safe.
- `gedSubagentsEnabled === false` or `gedRoleSettings["ged-explorer"].enabled === false` prevents explorer child-thread dispatch.
- UI copy clearly marks planner/reviewer/verifier/worker controls as configuration for upcoming runtime slices, not active execution yet.

## Scope

This slice completes follow-up hardening and configuration/UI parity. It does **not** claim all roles are runtime-dispatched yet. Runtime invocation remains implemented for `ged-explorer`; planner/reviewer/verifier/worker settings are persisted and displayed for the upcoming Ged-owned orchestration runtime slices.

## Design

- Extend `GedSubagentRole` constants to all five roles.
- Keep `gedModelSelections` as the source of model selections:
  - `mainThread: ModelSelection | null`
  - `roles: Record<string, ModelSelection>`
- Add global orchestration settings:
  - `gedSubagentsEnabled: boolean`
  - `gedIntercomBridgeEnabled: boolean`
  - `gedCritiqueMode: "off" | "risk-based" | "always"`
  - `gedRoleSettings: Record<string, { enabled: boolean }>`; missing known role keys mean enabled by default, and UI writes complete known-role maps when changing a role.
- Use `ModelSelection.options` for provider-specific thinking/reasoning where existing pickers support it. Do not introduce a parallel thinking schema in this slice.
- Use role display metadata in web/server runtime modules, not contracts, so contracts stay schema-only.
- Project role overrides continue using `project.roleModelSelections`; clearing a role removes that key.

## Deferrals

- True runtime dispatch for planner/reviewer/verifier/worker.
- True multi-step worker model-chain execution.
- Dedicated chain editor, unless it can be added without destabilizing the current UI.

## Success criteria

- Settings UI provides a clear, nice orchestration section resembling the GedPi setup concepts.
- Project override dialog lists all roles and can set/clear role overrides.
- Existing explorer child threads still use the resolved project/global role model.
- Tests cover settings defaults/patches, resolver expanded roles, server unsupported-role safety, and web store/UI logic where practical.
- `bun fmt`, `bun lint`, `bun typecheck`, and relevant tests pass before commit.
