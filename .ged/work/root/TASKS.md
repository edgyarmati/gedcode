# Tasks

## ged-thread-workflow-toggle

1. [x] Add a per-thread `gedWorkflowEnabled` contract/projection field with historical defaults.
2. [x] Add composer draft storage/actions for a workflow override and new-draft inheritance.
3. [x] Wire ChatView to derive/toggle per-chat workflow state and send it through thread creation/meta/turn commands.
4. [x] Make Ged enforcement consult the projected thread workflow setting for each send.
5. [x] Add focused contract/store/server tests.
6. [x] Run `bun fmt`, `bun lint`, `bun typecheck`, and targeted `bun run test` suites.
7. [x] Commit with a conventional commit after verification.

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
