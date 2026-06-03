# Tasks

## Planning

1. [x] Classify request and record checkpoint.
2. [x] Inspect provided screenshot.
3. [x] Run explorer reconnaissance.
4. [x] Draft/accept implementation plan.

## Slice 1: Contracts and settings

1. [x] Extend `GED_SUBAGENT_ROLES` to explorer, planner, plan-reviewer, verifier, worker.
2. [x] Add `GedCritiqueMode` and `GedRoleSettings` schemas/defaults to server settings.
3. [x] Add server settings patch support with whole-map replacement for role settings.
4. [x] Preserve existing `gedModelSelections` backward compatibility.
5. [x] Add settings tests for defaults and patches.

## Slice 2: Shared/server follow-up hardening

1. [x] Add resolver tests for expanded roles.
2. [x] Keep `GedRoleInvocationService` runtime explorer-only but type-safe with expanded roles.
3. [x] Add unsupported-role invocation test.
4. [x] Add disabled-global/disabled-explorer guard and tests for explorer invocation.
5. [x] Add low-risk service tests for unsupported/disabled role cases; deferred broader partial-failure matrix as non-blocking.
6. [x] Runtime explorer invocation now respects `gedSubagentsEnabled`; no separate prompt surface found in this slice.

## Slice 3: Global settings UI parity

1. [x] Add role display metadata for web UI.
2. [x] Replace ad hoc explorer row with a Ged orchestration section/card.
3. [x] Add subagents/intercom toggles and critique mode select.
4. [x] Render all role rows dynamically with enable toggle, model picker, inherit/reset state.
5. [x] Add runtime-status copy so non-explorer roles are clearly configuration-only for now.
6. [x] Preserve main Ged model selector.
7. [x] Covered UI-facing contracts through typecheck/build and existing web tests; no low-risk logic-only store test needed for static rendering changes.

## Slice 4: Project override UI parity

1. [x] Refactor project Ged model dialog props from single explorer role to role maps.
2. [x] Render all roles in project override dialog.
3. [x] Implement generic set/clear project role override handler.
4. [x] Show inherited vs project override state clearly.
5. [x] Covered project dialog role-map wiring through typecheck/build and existing ChatHeader tests.

## Verification

1. [x] Run targeted tests.
2. [x] Run `bun fmt`.
3. [x] Run `bun lint`.
4. [x] Run `bun typecheck`.
5. [x] Run `bun run test` if changed surface warrants full suite.
6. [x] Run clean-context verifier.
7. [ ] Commit.
