# Prevent Premature Worker Stage Completion

## Goal

Prevent an orchestrator worker stage from being recorded as completed, and therefore exposed to the
project manager for review or landing, until the provider has emitted the terminal
`turn.completed` event for the active worker turn.

## Problem

`turn.diff.updated` can create a placeholder turn-diff event while a worker turn is still running.
The checkpoint reactor replaces that placeholder with a real Git checkpoint. Its shared checkpoint
capture tail currently also dispatches `task.stage.complete`, so a mid-turn diff can advance the task
to review while the worker is still editing or committing. The PM can then act on an incomplete
worktree and lose later worker changes.

## Constraints

- Continue capturing real checkpoints for placeholder diff events during an active turn.
- Only a terminal provider event may authorize stage settlement.
- Preserve the existing deterministic stage-completion command ID and exactly-once PM re-entry.
- If a real checkpoint was already captured before terminal completion, the terminal event must
  refresh it from the final filesystem state and then settle rather than skipping settlement.
- Interrupted or cancelled terminal turns must not complete the stage through the checkpoint path.
- Do not add a compatibility fallback that permits pre-terminal stage completion.
- Keep the change within the checkpoint reactor and its focused tests unless verification reveals a
  necessary adjacent correction.

## Acceptance Criteria

1. A real checkpoint captured from a mid-turn placeholder does not emit `task.stage-completed` and
   leaves the task's active stage in `working` state.
2. The matching terminal `turn.completed` event subsequently emits exactly one
   `task.stage-completed` event, refreshes the recorded diff with edits made after the early
   checkpoint, and advances the task using the existing deterministic command ID.
3. Normal completion without an earlier placeholder continues to settle exactly once.
4. Interrupted or cancelled completion remains non-completing in the checkpoint reactor.
5. Focused tests, formatting, lint, and the narrow server typecheck pass.
6. The user-visible reliability fix is recorded under `CHANGELOG.md` `## Unreleased`.
