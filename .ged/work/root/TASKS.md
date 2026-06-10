# TASKS

## nightly-release-0-1-1-nightly-20260610-1

1. Confirm release prerequisites
   - Verify clean worktree, auth, branch, and resolved nightly version.
   - Inspect release workflow/docs to confirm nightly semantics.

2. Prepare release notes entry
   - Add `## 0.1.1-nightly.20260610.1` under `## Unreleased` in `CHANGELOG.md`.
   - Move the current unreleased bullets under that release section if appropriate.

3. Verify release gates
   - Run `bun fmt`.
   - Run `bun lint`.
   - Run `bun typecheck`.
   - Run `bun run test`.
   - Run `bun run release:smoke`.

4. Dispatch nightly release
   - Run `./release.sh nightly patch` or equivalent documented workflow dispatch path.
   - Capture workflow dispatch confirmation.

5. Close workflow state
   - Record verification evidence in `.ged/work/root/TESTS.md`.
   - Mark Ged checkpoints complete/closed.
