# Tests

## Plan

- `bun fmt`
- Confirm `apps/server/src/server.ts` is clean and recorder files are not present.
- `bun lint`
- `bun typecheck`

## Evidence

- `bun run test src/gedWorkflow/Layers/GedWorkflowCheckpointRecorder.test.ts` from `apps/server/` passed while evaluating the recorder: 1 file, 3 tests.
- Final verifier found the recorder over-credited verifier checkpoints, so the server change was removed instead of committed.
- `git diff -- apps/server/src/server.ts` is empty; recorder source and test files are absent.
- `bun fmt` passed on the final state.
- `bun lint` passed on the final state with existing warnings outside this change.
- `bun typecheck` passed on the final state: 14 packages.

# gedcode-worktree-paths-and-push-remotes

Planned verification:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Focused coverage to add/update:

- CLI config default path resolves under `~/.gedcode`.
- Temporary worktree branch generation uses the new namespace.
- Legacy `gedcode/<token>` refs are still recognized as temporary worktree refs.

Results:

- `bun fmt` passed.
- `bunx vitest run packages/shared/src/git.test.ts scripts/dev-runner.test.ts` passed: 2 files, 29 tests.
- `bunx vitest run apps/server/src/cli/config.test.ts apps/server/src/vcs/GitVcsDriverCore.test.ts packages/ssh/src/tunnel.test.ts` passed: 3 files, 34 tests.
- `bunx vitest run --config vitest.browser.config.ts src/components/ChatView.browser.tsx` from `apps/web` ran 74/75 passing; one pre-existing unrelated plan-mode lookup failed.
- `bun lint` passed with existing warnings.
- `bun typecheck` passed: 14 packages.
- `git diff --check` passed.

# upstream-push-fallback

Planned verification:

- Focused VCS regression test for existing-upstream fallback.
- `bun fmt`
- `bun lint`
- `bun typecheck`

Results:

- `bunx vitest run apps/server/src/vcs/GitVcsDriverCore.test.ts` passed: 1 file, 14 tests.
- `bun fmt` passed.
- `bun lint` passed with existing warnings.
- `bun typecheck` passed: 14 packages.
- `git diff --check` passed.
