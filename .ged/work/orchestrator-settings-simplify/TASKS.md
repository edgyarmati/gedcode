# Tasks: Simplify Orchestrator settings

## Goal

Make Orchestrator configuration UI less confusing by removing stage-pipeline and gate-autonomy controls from both global defaults and project settings, while preserving supported settings that operators still need.

## Scope

- Global Settings → Orchestrator defaults page.
- Project Orchestration settings dialog.
- Project/global settings draft logic and tests affected by no longer editing stages/gate policy.
- Keep runtime schemas/resolvers compatible with existing persisted config; do not delete backend support for existing stage/gate config in this slice.

## Implementation slices

1. Remove stage and gate-autonomy controls from Orchestrator settings UI surfaces.
2. Keep project enable/PM routing where required for operation, and keep landing PR mode plus operational knobs.
3. Preserve existing stage/gate values when saving settings so opening the simplified UI does not silently erase persisted config.
4. Tune operational defaults to be safer/less aggressive if needed and update tests/docs/changelog.
5. Run `bun fmt`, `bun lint`, and `bun typecheck`.
