# Tasks

## ged-tracking-and-checkpoint-recorder

1. [x] Inspect pending server and `.ged` changes.
2. [x] Confirm the recorder/server integration should not be committed as-is.
3. [x] Track appropriate `.ged` memory files and ignore runtime state.
4. [x] Verify formatting, lint, typecheck, and targeted server/Ged tests.
5. [x] Commit `.ged` tracking with a conventional commit if verification passes.

# gedcode-worktree-paths-and-push-remotes

- [x] Change default server base directory from `~/.t3` to `~/.gedcode`.
- [x] Change generated temporary worktree branch namespace away from `gedcode/<token>`.
- [x] Preserve recognition of legacy temp branch refs.
- [x] Add/update focused tests for config path derivation and branch helpers.
- [x] Run required verification: `bun fmt`, `bun lint`, `bun typecheck`.

# upstream-push-fallback

- [x] Add fallback handling for permission-denied `pushUpstream`.
- [x] Add regression coverage for an existing `origin/main` upstream that denies pushes.
- [x] Run focused VCS tests and required `bun fmt`, `bun lint`, `bun typecheck`.
