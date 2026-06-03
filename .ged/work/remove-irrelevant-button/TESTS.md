# Verification

## Required checks

```sh
bun fmt
bun lint
bun typecheck
```

Never run `bun test`; use `bun run test`.

## Targeted test, if useful

```sh
cd apps/web && bun run test src/components/chat/ChatHeader.test.ts
```

## Focused searches

```sh
rg -n "Ged models|Project Ged models|ProjectGedModelSettingsControl|ProjectGedModelRow" apps/web/src
rg -n "projectGedMainModelSelection|resolvedGedMainModelSelection|gedModelInstanceEntries|gedModelOptionsByInstance|onSetProjectGedMainModel|setProjectGedMainModel" apps/web/src/components
```

Expected: no remaining matches for removed header dialog/button plumbing, except intentionally retained unrelated model-resolution symbols.
