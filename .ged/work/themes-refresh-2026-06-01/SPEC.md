# SPEC: Theme Refresh

## Goal

Refresh the built-in web UI themes so users can choose from:

- System — follows OS light/dark mode.
- Light — clean neutral light theme.
- Dark — clean neutral dark theme.
- Gruvbox Light — current light palette, renamed accurately.
- Gruvbox Dark — current dark palette, renamed accurately.
- Midnight — deep blue/black dark theme.
- Dracula — Dracula-inspired dark theme.

## Requirements

- Preserve existing explicit light/dark user preferences by migrating legacy `t3code:theme` values:
  - `light` -> `gruvbox-light`
  - `dark` -> `gruvbox-dark`
  - `system` -> `system`
- Keep the desktop/native theme IPC contract as `light | dark | system`; map web themes to that contract.
- Use an exact theme marker on `<html>` plus the existing `.dark` class for dark variants.
- Apply the correct theme before React first paint via `apps/web/index.html`.
- Keep terminal surfaces adaptive through CSS variables.
- Keep diff rendering readable; scheme-based Shiki mapping is acceptable unless implementation evidence shows contrast issues.

## Approach

- Introduce/centralize a theme registry for IDs, labels, color scheme, concrete system resolution, and desktop mapping.
- Store new values under a v2 key while reading the legacy key for migration.
- Set `html[data-theme="..."]` for exact palette selection and maintain `.dark` for existing Tailwind dark variants.
- Move current CSS palettes to Gruvbox selectors and define clean Light/Dark, Midnight, and Dracula palettes.
- Mirror enough resolution logic in the inline boot script to avoid theme flash.

## Risks

- Boot script and TypeScript helper can drift because the boot script cannot import app code.
- Legacy `light`/`dark` values are ambiguous; mapping them to Gruvbox preserves current visual behavior.
- Components may rely on `.dark`, so it must remain in sync with the active concrete theme.

## Plan Review Clarifications

- New storage key is `t3code:theme:v2`.
- Preference precedence: valid v2 value wins. If v2 is absent or invalid, fall back to valid legacy `t3code:theme`; if neither is valid, use `system`.
- Legacy migration maps old explicit `light`/`dark` to `gruvbox-light`/`gruvbox-dark` and writes the migrated value to v2 when app code runs. The boot script may read legacy values for first paint but need not mutate storage.
- `html[data-theme]` always stores the active concrete palette, never `system`.
- `system` resolves to clean `light` or clean `dark` based on `prefers-color-scheme`.
- Desktop IPC types remain unchanged; app code must map web themes to `light`, `dark`, or `system` before calling the bridge.
