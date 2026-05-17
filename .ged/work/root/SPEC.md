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
