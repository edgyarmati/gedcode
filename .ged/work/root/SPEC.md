# Spec

## Goal

Clean up the remaining Ged workflow worktree changes:

- Remove the pending server checkpoint-recorder wiring because review found it can over-credit verifier checkpoints.
- Track the `.ged` files that are durable or branch-local workflow memory.
- Keep runtime/session state ignored automatically.

## Scope

- `.ged/.gitignore`
- `.ged` durable memory files
- `.ged/work/root/*`

## Decisions

- Do not commit `apps/server/src/server.ts` or `GedWorkflowCheckpointRecorder` in this slice.
- Commit `.ged` root memory and `.ged/work/root` files because the Ged context map defines root as durable project context and work as branch-local planning artifacts.
- Do not commit `.ged/runtime`, which remains ignored by `.ged/.gitignore`.

## Non-Goals

- Rework the Ged workflow architecture.
- Add runtime checkpoint automation.
- Rename existing Ged concepts or public APIs.
- Push commits.

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
