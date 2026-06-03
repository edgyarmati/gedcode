# Tasks

## Planning

1. [x] Classify request as non-trivial documentation release work.
2. [x] Run `ged-explorer` documentation discovery.
3. [x] Run `ged-planner` scope and verification critique.
4. [x] Replace stale root planning artifacts with documentation-release plan.
5. [x] Record the planning checkpoint.

## Documentation Edits

1. [x] Update `README.md` introductory copy, provider links, and exactly one screenshot placeholder.
2. [x] Rewrite `docs/release.md` to match the current release workflow.
3. [x] Update `REMOTE.md` SSH launch state paths.
4. [x] Sync `KEYBINDINGS.md` defaults, commands, and `when` conditions.
5. [x] Update `docs/observability.md` stale schema path and current metrics.
6. [x] Add `docs/providers/opencode.md`.
7. [x] Convert broken absolute links in `docs/effect-fn-checklist.md` to repo-relative links.

## Verification

1. [x] Run documentation/source consistency `rg` checks from `TESTS.md`.
2. [x] Run `bun fmt`.
3. [x] Run `bun lint`.
4. [x] Run `bun typecheck`.
5. [x] Run `ged-verifier` clean-context review.
6. [x] Record verifier checkpoint.
7. [x] Commit scoped documentation changes with a conventional commit.
