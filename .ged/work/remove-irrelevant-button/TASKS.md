# Tasks

## Slice 1: Remove ChatHeader UI

- [x] Remove the conditional render of `ProjectGedModelSettingsControl` from `ChatHeader`.
- [x] Delete `ProjectGedModelSettingsControl`.
- [x] Delete `ProjectGedModelRow`.
- [x] Remove now-unused `ChatHeaderProps` fields:
  - `projectGedMainModelSelection`
  - `resolvedGedMainModelSelection`
  - `gedModelInstanceEntries`
  - `gedModelOptionsByInstance`
  - `onSetProjectGedMainModel`
- [x] Prune unused imports from `ChatHeader.tsx`.

## Slice 2: Clean ChatView pass-through only

- [x] Remove the deleted props from the `<ChatHeader />` call.
- [x] Remove `setProjectGedMainModel` if unused.
- [x] Remove model instance/options derivations only if unused outside this dialog.
- [x] Keep composer/draft model fallback logic intact.

## Slice 3: Verification cleanup

- [x] Search for removed UI labels/components.
- [x] Run required repo checks.
