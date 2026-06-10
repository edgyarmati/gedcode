# TASKS

## fix-nightly-release-ci

1. Diagnose failed runs
   - Inspect failed release run `27283195015`.
   - Inspect prior failed CI run `27282954747`.

2. Patch release channel metadata
   - Make release preflight derive `stable` versus `nightly` from the resolved version.
   - Pass the derived channel into `scripts/resolve-previous-release-tag.ts`.
   - Add tests for stable and nightly previous-tag resolution.

3. Stabilize provider registry CI test
   - Inspect the failing timestamp assertion.
   - Adjust the test or implementation to prove a fresh probe without timestamp flakiness.

4. Update release notes
   - Document the nightly release workflow fix in `CHANGELOG.md`.

5. Verify and publish fix
   - Run focused tests.
   - Run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
   - Commit and push the fix.
   - Dispatch the nightly release again.
