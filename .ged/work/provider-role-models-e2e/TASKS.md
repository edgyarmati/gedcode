# Tasks

## Planning

1. [x] Classify and clarify global plus per-project override requirement.
2. [x] Run explorer discovery for model selection/settings/project/server/web integration points.
3. [x] Draft e2e implementation plan.
4. [x] Review and accept plan.

## Slice 1: Contracts and project persistence

1. [x] Add `GedSubagentRole` contract/constants, initially `ged-explorer`.
2. [x] Add `ServerSettings.gedModelSelections` with legacy-safe defaults.
3. [x] Add settings patch support for global main/role selections with whole-map replacement for `roles`.
4. [x] Add `roleModelSelections` to project contracts/shells/events/commands.
5. [x] Add projection migration for project role model selections.
6. [x] Update decider/projector/projection repository/snapshot query paths with whole-map replacement semantics.
7. [x] Add contract/projection tests.

## Slice 2: Shared resolver

1. [x] Add `packages/shared/src/gedModelSelection.ts`.
2. [x] Export shared resolver subpath.
3. [x] Implement main-thread resolver.
4. [x] Implement role resolver with project role > global role > parent thread fallback.
5. [x] Add immutable role-map update/clear helpers if useful for UI.
6. [x] Add resolver tests.

## Slice 3: Server role invocation integration

1. [x] Inject/read `ServerSettingsService` in `GedRoleInvocationServiceLive`.
2. [x] Resolve role model for `ged-explorer` from project/global settings.
3. [x] Use resolved model in child `thread.create`.
4. [x] Use resolved model in child `thread.turn.start`.
5. [x] Ensure prompt reports resolved model context.
6. [x] Extend service tests for no override, global override, and project override.
7. [ ] Add remaining partial-failure tests from prior slice.

## Slice 4: Global settings UI

1. [ ] Add a reusable Ged model selection editor if needed.
2. [x] Add global “Ged model defaults” section in settings.
3. [x] Wire main-thread default to `settings.gedModelSelections.mainThread`.
4. [x] Wire explorer role default to `settings.gedModelSelections.roles["ged-explorer"]`.
5. [x] Add clear/reset behavior.
6. [ ] Add focused UI tests where existing patterns support it.

## Slice 5: Project override UI

1. [x] Add minimal project model override popover/control.
2. [x] Wire project main-thread override to `project.meta.update.defaultModelSelection`.
3. [x] Wire explorer override to `project.meta.update.roleModelSelections`.
4. [x] Show inherited/global/default state clearly.
5. [x] Ensure clear removes role override instead of leaving stale keys.
6. [ ] Add focused UI/store tests where practical.

## Slice 6: Main-thread default integration

1. [x] Update new/draft thread model resolution to use project/global main defaults.
2. [x] Preserve existing persisted thread model behavior.
3. [x] Avoid creating project main overrides implicitly for new projects unless user chooses one; new projects default `defaultModelSelection: null`.
4. [x] Update server bootstrap/default thread creation to resolve project/global/fallback main model explicitly.
5. [x] Audit and update exact main-thread call sites: draft selection, thread create/bootstrap payloads, plan implementation thread creation, and server startup bootstrap.

## Verification

1. [x] Run targeted contract/shared/server/web tests.
2. [x] Run `bun fmt`.
3. [x] Run `bun lint`.
4. [x] Run `bun typecheck`.
5. [x] Run `bun run test` if the changed surface warrants full suite.
6. [ ] Run clean-context verifier before commit.
