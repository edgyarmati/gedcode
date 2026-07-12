# Orchestrator Thread Reuse Policy

The Orchestrator deliberately uses two thread lifetimes:

- A project has exactly one persistent PM thread. Its ID is deterministically derived as
  `pm:<projectId>`, so runtime restarts, model changes, settlements, and later human messages resume the
  same projected conversation.
- Each worker stage attempt gets one new thread. Starting or retrying a stage creates a fresh thread so
  the attempt has an isolated provider session, turn history, model selection, and terminal outcome.
  Attempts remain linked and ordered through the owning task's `stageThreadIds` and `stageHistory`.

Steering is not a new attempt. It appends a turn request to the selected existing stage thread (the
current/latest attempt by default), preserving that attempt's provider conversation and runtime mode.
Quota recovery is a retry: it copies the original bounded instructions into a new stage attempt and
marks the blocked attempt resumed in the task projection.

This policy prevents PM conversation fragmentation while keeping failed or retried worker execution
auditable. Code that needs another attempt must dispatch `task.stage.start`; code that wants to refine an
active attempt must dispatch `thread.turn.start` for its existing stage thread.
