# Spec

## Goal

Make the composer Ged workflow toggle chat-scoped instead of global.

## Acceptance Criteria

- Toggling Ged workflow in one chat only changes that chat's effective workflow setting.
- Existing chats retain their own workflow setting when switching between chats.
- A newly created draft chat inherits the active chat's current workflow setting, matching the way composer model state is carried forward.
- A chat created from a chat where Ged is disabled starts disabled without mutating any other chat.
- Server-side Ged prompt injection and checkpoint enforcement use the target thread's workflow setting, not only the global settings default.
- Existing historical threads decode as Ged-enabled by default so current behavior is preserved unless a thread opts out.

## Constraints

- Keep `packages/contracts` schema-only.
- Reuse the existing thread/composer draft state patterns for model/runtime/interaction settings.
- Preserve the global settings switch as the default for threads without a per-thread override.
- Do not run `bun test`; use `bun run test`.

# gedcode-worktree-paths-and-push-remotes

## Problem

New agent worktrees currently expose legacy T3 naming in user-facing paths:
`~/.t3/worktrees/<repo>/<repo>-<token>`. Temporary branch refs also use
`gedcode/<token>`, which is visible in push commands and pull request flows.

When a local checkout points only at an upstream repository that the authenticated
user cannot write to, `pushCurrentBranch` attempts to push to that upstream
remote and fails before a PR can be created.

## Desired Behavior

- Default server home and derived worktree storage use `~/.gedcode`.
- Generated temporary worktree branches use a GedCode-owned neutral namespace
  without `t3`.
- Existing temporary branch detection still recognizes old `gedcode/<token>`
  refs so current sessions are not stranded.
- Pushes continue to honor explicit `branch.<name>.pushRemote` and
  `remote.pushDefault`, then prefer the primary remote as before.
- Tests cover the new default path and generated temporary branch namespace.

# upstream-push-fallback

## Problem

`GitVcsDriver.pushCurrentBranch` now falls back from permission-denied pushes
when a branch has no upstream yet, but existing-upstream branches still use
`pushUpstream` directly. A branch tracking `origin/main` can therefore fail with
`Permission to <repo> denied` even when another writable remote is configured.

## Desired Behavior

- Existing-upstream pushes preserve the current upstream push path when it works.
- If the upstream push fails specifically with a permission/remote access error,
  retry against another configured remote using the same remote branch name.
- The returned push result reports the fallback upstream and `setUpstream: true`
  because `git push -u` updates tracking to the writable remote.
- Non-permission push failures should still surface normally.
