# Spec: Runtime Ged Auto-Escalation

## Goal

Make Ged workflow enforcement robust when an agent leaves a seeded trivial classification in place while editing multiple source files.

## Behavior

- Closed lifecycle reset must still create a fresh active turn, but then run server-side classification heuristics against the new user input.
- Trivial active checkpoints must auto-escalate to non-trivial when runtime file-change evidence shows more than one source/worktree file changed.
- Dot-directory metadata changes such as `.ged/**` and `.git/**` must not count toward source edit thresholds.
- Ambiguous file-change events fail safe for invalidation and count as one unknown source edit for escalation.
- Source edits continue to invalidate verifier checkpoints.

## Non-Goals

- Do not build full per-turn orchestration persistence.
- Do not change checkpoint schema version.
- Do not rely on provider-specific event payloads.

## Acceptance Criteria

- A trivial task changing two source files becomes non-trivial in checkpoint state.
- Post-close turns with obvious non-trivial wording classify as non-trivial immediately.
- Existing dot-directory filtering behavior remains intact.
- Required repo checks pass: `bun fmt`, `bun lint`, `bun typecheck`.
