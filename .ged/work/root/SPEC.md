# Spec: Light-Mode Destructive Outline Button Visibility

## Goal

Fix light-mode visibility for destructive outline buttons, including the Revoke controls in the connectivity settings panel.

## User-Visible Behavior

- Destructive outline buttons must show readable destructive-colored labels on light surfaces.
- Existing filled destructive buttons and dark-mode outline behavior should remain visually consistent.
- The fix should apply through the shared button variant so other destructive outline actions benefit from the same contrast correction.

## Scope

- Update the shared `destructive-outline` button styling in the web UI.
- Add a focused regression assertion for the connectivity settings Revoke button in light mode.
- Document the unreleased user-visible fix.

## Non-Goals

- Redesign settings rows, menus, or connectivity flows.
- Change revoke behavior or server access APIs.
- Rework theme token semantics outside the minimum needed for button visibility.

## Acceptance Criteria

- In light mode, the Revoke button in connectivity settings is not white-on-white.
- `bun fmt`, `bun lint`, and `bun typecheck` pass.
- Relevant test coverage is updated and passes via `bun run test`, not `bun test`.
