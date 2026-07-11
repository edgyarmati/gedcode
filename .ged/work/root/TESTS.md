# TESTS - Orchestrator Completion Roadmap

## Test Strategy

Each slice adds focused characterization or behavior tests first, then runs the repository gates. Cross-
component lifecycle changes require integration coverage; UI interaction changes require browser tests.

## Lifecycle Safety

- Cancel during a long-running worker command: provider receives interrupt, session stops, stage settles,
  and only then is the worktree removed.
- Interrupt rejection/timeout: worktree remains, task exposes recovery state, and retry is idempotent.
- Restart during cancellation: reconciliation completes each remaining step exactly once.
- Orphaned active stage after restart becomes retryable and no longer holds `currentStageThreadId`.
- Worktree reaper cannot remove a path owned by another live runtime.
- Landing event during reactor startup still opens one PR and cleans up once.

## Landing and Release

- PM and client landing operations reject missing/rejected/mismatched land gates.
- Approved land gate followed by land reaches `landed`, opens or reuses a PR, and records the URL.
- Repeated land/release dispatch calls are idempotent.
- Release workflow refuses dirty/unlanded state and records authoritative workflow URL/status.

## Task Lifecycle

- Archive hides a terminal task from active board queries without erasing event history.
- Restore returns an eligible task; invalid restore reports a typed error.
- Permanent delete uses explicit retention semantics and cascades or tombstones associated stage threads.
- Repeated create with the same idempotency key returns one task.
- Supersession links old/new tasks and releases capacity without ambiguity.

## PM Efficiency and Threads

- An idle worker causes no periodic PM turns or repeated `inspectStage` calls.
- Stage settlement, gate resolution, quota recovery, and interrupt outcome each wake the PM once.
- PM re-entry payload remains bounded with large task and stage histories.
- Steering reuses the active stage attempt; retry creates a linked attempt.
- Codex interrupt reaches the provider before the original turn naturally completes.
- Unsupported live steering reports queued/rejected behavior immediately.

## Task Splitting

- Parent/child relationships and child order survive projection rebuild and restart.
- `splitTask` is atomic and idempotent.
- Dependencies prevent blocked children from starting and identify the next unblocked child.
- Parent progress derives from child terminal states.

## Web and Chat

- Forking at a message creates a distinct thread with the intended history boundary.
- Source thread remains unchanged after fork.
- Active task detail omits the Plan section until a proposed plan exists; empty `No gates` is omitted;
  populated sections still render.
- Composer drafts survive route and Chat/Orchestrator surface switches without leaking between contexts.
- Project sort/manual order matches between Chat and Orchestrator.
- Project/task context menus expose only actions valid for the current state.
- Effective worker permission mode is visible.

## Compatibility Checks Requiring Explicit Decisions

- Task archive/delete event shape and retention policy.
- Legacy unknown task types when the validated registry is introduced.
- Existing persisted `allowFullAccessWorkers=false` overrides when full access becomes the default.
- Forked thread provider resume behavior across Codex, Claude, and OpenCode.

Do not add fallback behavior for these cases without a specific user decision.

## Required Commands Per Implemented Slice

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Never run `bun test`.

For web interaction slices also run the repository's browser-test command for the affected package. For
release slices also run `bun run fmt:check` and `bun run release:smoke`.

## Completed Evidence

### ORCH-LC-01 and ORCH-LC-02

- Decider tests reject progression after cancellation reservation and reject direct live-task
  abandonment outside the cancellation workflow.
- Provider reactor tests cover a queued worker start racing cancellation and skip provider startup after
  cancellation or terminal settlement.
- PM cancellation tests cover concurrent calls, phase checkpoint retries, shutdown failures, final
  abandonment failures, and terminal-task no-ops.
- Projection, migration, SQL snapshot, live subscription, and web-store tests cover replay and legacy
  compatibility for durable cancellation state.
- Repository gates passed on 2026-07-11: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`, and
  `bun run build`.
