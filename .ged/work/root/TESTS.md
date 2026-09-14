# Verification Plan

## Focused automated coverage

- Task registry/playbook tests assert only `feature` is active and `release` is unavailable.
- PM prompt tests assert explicit operator-requested GitHub Actions dispatch uses ordinary shell/`gh`
  access without a GedCode release task or gate.
- PM/MCP tests assert release tools and release-source input are absent and generic approvals reject
  `release`.
- Decider tests assert release task creation and legacy release-dispatch commands are rejected while
  feature task identity and ordinary plan/land flows remain stable.
- Configuration tests assert legacy `release` task-type entries are tolerated during upgrade while
  arbitrary unknown entries still fail.
- Existing event/projector/migration and published-release fixtures prove historical release state
  remains decodable and visible.

## Repository checks

- Focused Vitest files via `bun run test`; never invoke `bun test`.
- `bun fmt`
- `bun lint`
- `bun run typecheck` from `apps/server`
- `bun run typecheck` from `apps/web`
- `git diff --check`
- Verify no diff under `.github/workflows/release.yml`, `release.sh`, or release publication scripts.

## Expected outcome

The PM can honor an explicit request to run a repository GitHub Actions workflow directly. GedCode
has no active release task, gate, or dispatch actuator, while all historical persisted release data
continues to load safely after upgrade.

## Evidence

- Server focused tests passed: 9 files, 271 tests covering task registration, playbook loading, MCP exposure, PM
  tools/prompt behavior, decider retirement guards, migration 053, and published-release database
  fixtures, plus replay of historical release-dispatch projection state.
- Contracts focused tests passed: 1 file, 72 tests, including historical release-dispatch event
  decoding.
- Web focused tests passed: 2 files, 87 tests covering legacy release status rendering and every
  published browser persistence fixture.
- `bun fmt` passed across 1,477 files.
- `bun lint` passed with existing repository warnings and no errors.
- `bun run typecheck` passed in `apps/server`, `apps/web`, and `packages/contracts`.
- `git diff --check` passed.
- Diff guards confirmed `.github/workflows/release.yml`, `release.sh`, `docs/release.md`, and release
  publication scripts are unchanged, and active server source has no release tool/actuator symbols.

## Release 0.4.5 final verification (2026-09-14)

- Current release work: `.ged/work/release-patch-0.4.5/` (separate from the completed work above).
- Parent's final `bun fmt`, `bun lint`, full `bun run typecheck` and `bun run test` passed:
  11 uncached workspace tasks, 4,374 passed tests, one existing skipped test.
- Release audit/version/smoke checks, 240 browser tests, and forced desktop build passed earlier
  in this final parent verification pass; subsequent changes affect only the lint guard and tests.
- Final guard re-review `0fd8ef06` approved; aggregate review and signing-key review approved.
- Real plugin tests: 196 passed; compiler-toolchain tests: 14 passed.
- Exact-SHA remote CI and publication/artifact verification remain pending.
- Evidence: `.ged/runtime/release-patch-0.4.5/review-fixes/PARENT-RECONCILIATION.md` and
  `/tmp/ged-release-final-{fmt,lint,typecheck,test}.log`.
