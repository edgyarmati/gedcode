# Spec

## Goal

Make Ged checkpoint state thread-specific so workflow status cannot leak between chats in the same project.

## Scope

- Store checkpoints under `.ged/runtime/root/threads/<threadId>/`.
- Read, write, classify, and validate workflow state using the thread-specific checkpoint path.
- Remove the project-level fallback and in-memory active-thread workaround.
- Keep project-level bootstrap for memory/templates, but bootstrap thread checkpoint files when a thread sends a turn.
- Update tests and prompt text to describe the new source of truth.

## Non-goals

- No legacy project-level checkpoint fallback.
- No migration path for existing `.ged/runtime/root/checkpoints.json`.
- No database persistence of checkpoint state.

## Acceptance Criteria

- New threads get independent checkpoint files.
- A stale checkpoint from another thread cannot affect a new trivial thread.
- Same-thread non-trivial checkpoints still preserve unfinished workflow state.
- `bun fmt`, `bun lint`, and `bun typecheck` pass.
