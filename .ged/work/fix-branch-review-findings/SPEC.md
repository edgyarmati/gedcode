# SPEC: Fix branch review findings

## Goal

Fix all concrete findings from the branch review:

1. Make `packages/ged-workflow` pass TSGo typecheck.
2. Complete desktop GedCode identity/user-data rebrand while preserving legacy T3 fallback paths.
3. Update marketing links/cache/demo text from upstream `pingdotgg/t3code` to `edgyarmati/gedcode` / GedCode.
4. Make `setStickyModelSelection(null | undefined)` clear sticky model selection state.

## Design

- Use direct `vitest` imports in ged-workflow tests that only use plain Vitest APIs. Keep or convert Effect-specific tests so TSGo can typecheck them.
- Desktop canonical identity should use lower-case slug values (`gedcode`, `gedcode-dev`) for user data dirs, Linux desktop entry names, WM class, and bundle/app IDs. Legacy fallback should continue checking old T3 display-name dirs (`T3 Code (Alpha)`, `T3 Code (Dev)`) and old slug dirs where applicable if current resolution supports it.
- Marketing release constants and all hardcoded GitHub/release/fork/contributing links should target `edgyarmati/gedcode`; cache key should become `gedcode-latest-release`; demo shell text should use `gedcode`.
- Sticky model selection null/undefined should explicitly clear `stickyModelSelectionByProvider` and `stickyActiveProvider`, with regression tests.

## Constraints

- Run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` before completion.
- Never run `bun test`.
- Preserve intentional internal `@t3tools/*` package names and compatibility identifiers unless part of the explicit findings.

## Plan-review clarifications

Desktop fallback must be explicit and tested:

- Canonical user-data names: prod `gedcode`, dev `gedcode-dev`.
- Legacy candidate names: prod `t3code` and `T3 Code (Alpha)`; dev `t3code-dev` and `T3 Code (Dev)`.
- Precedence: prefer canonical if it exists; otherwise use the first existing legacy candidate; otherwise use canonical for fresh installs.
- Package/build identity files, including desktop artifact scripts and dev Electron launcher, are in scope for the rebrand.
