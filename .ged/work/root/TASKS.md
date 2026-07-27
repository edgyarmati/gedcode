# TASKS — Reliable Replay, Then Task-Oriented Inbox

Status values: `NEXT`, `TODO`, `DONE`, `BLOCKED`.

## PR 1 — Durable Subscription Bootstrap

| ID | Status | Bounded slice | Verification |
| --- | --- | --- | --- |
| WS-01 | DONE | Map the existing shell/thread/project/task snapshot and live interfaces; define the smallest shared ordered-bootstrap public contract and central replay bound. | Design notes identify all four callers and the observable stream contract without changing raw provider streams. |
| WS-02 | DONE | Add one failing integration-style test that interleaves a durable event with snapshot loading. | Test fails because the current snapshot-then-subscribe path loses the event. |
| WS-03 | DONE | Implement the minimal shared subscribe-before-snapshot buffer/replay/drain primitive and adopt it for the tracer path. | The interleaving test passes and emits the event exactly once in sequence. |
| WS-04 | DONE | Add ordered/deduplicated replay-buffer-live and reconnect tests, one behavior at a time, extending the primitive minimally after each RED. | Focused tests cover duplicates, replay overlap, live overlap, and reconnect. |
| WS-05 | DONE | Add a replay-bound test and fresh-snapshot recovery behavior. | A `limit + 1` backlog selects a newer snapshot and does not emit an unbounded replay. |
| WS-06 | DONE | Add transport coalescing with explicit covered-sequence semantics for replaceable same-thread/task projection updates only. | Focused tests prove replaceable updates coalesce while lifecycle/domain transitions remain lossless and do not trigger false gaps. |
| WS-07 | DONE | Add one shared WebSocket payload projector with explicit truncation metadata, then apply it to replay and live delivery. | Persistence/detail reads retain full payloads; replay/live transport previews share the same limit and metadata. |
| WS-08 | DONE | Migrate all shell, thread, project, and task subscriptions to the shared bootstrap primitive and align defensive client recovery. | Focused server/web tests prove identical bootstrap behavior across all four surfaces. |
| WS-09 | DONE | Document PR 1 and run required quality gates. | `CHANGELOG.md`, `docs/upstream-decisions.md`, focused tests, `bun fmt`, `bun lint`, narrow typechecks, and `git diff --check` pass. |
| WS-10 | DONE | Commit, push, and open a detailed PR 1. | Remote branch and PR exist; PR describes architecture, behavior, compatibility boundary, and verification. |

## Merge Checkpoint

| ID | Status | Bounded slice | Verification |
| --- | --- | --- | --- |
| MERGE-01 | NEXT | Wait for human review and merge of PR 1; do not self-merge without explicit approval. | PR 1 is merged and the local PR 2 base is updated to that merge. |

## PR 2 — Task-Oriented Inbox

| ID | Status | Bounded slice | Verification |
| --- | --- | --- | --- |
| INBOX-01 | TODO | Add lifecycle command/event/schema tests and minimal durable thread/task lifecycle fields. | Legacy/current persisted state decodes under the chosen no-shim schema; transitions replay deterministically. |
| INBOX-02 | TODO | Add settle blockers, idempotence, auto-settle, snooze, and reopen tests one behavior at a time; minimally extend decider/projector per RED. | Focused server tests cover every documented lifecycle invariant. |
| INBOX-03 | TODO | Add pure web partition/classification tests for Threads/Orchestrator and Active/Snoozed/Settled. | Raised-hand precedence, pins, bad dates, snooze expiry, and ordering are deterministic. |
| INBOX-04 | TODO | Add DST-safe snooze preset tests and implement upstream-aligned presets. | One-hour, evening, tomorrow, and next-Monday results pass across DST boundaries. |
| INBOX-05 | TODO | Build the Inbox view, sliding type pill, lifecycle filter, distinct rows, and status treatment without project grouping. | Focused component tests prove selection, filtering, row treatment, and accessibility. |
| INBOX-06 | TODO | Wire Orchestrator row navigation to the project-level route and normal thread navigation to chat. | Focused navigation tests prove no task-detail navigation. |
| INBOX-07 | TODO | Document PR 2 and run required quality gates. | Changelog, upstream decision removal/update, focused tests, format, lint, narrow typechecks, and diff check pass. |
| INBOX-08 | TODO | Commit, push, and open a detailed PR 2. | Remote branch and PR exist with full behavior and verification notes. |
