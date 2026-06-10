# SPEC

## Goal

Fix the desktop updater path so installing a nightly update from the app applies the released version predictably, and verify whether the UI version label reflects the installed app version.

## Scope

- Electron updater install/restart behavior.
- Release/update manifest generation and artifact metadata.
- In-app version display source.
- Regression coverage for any changed updater/version logic.

## Non-Goals

- Redesign the settings UI.
- Change unrelated release signing or packaging behavior unless required for updater correctness.
