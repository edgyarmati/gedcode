# Server-Owned Normal-Chat Message Queue

Status: implemented (2026-08-30)

## Decision

Normal-chat follow-up messages use a server-owned, durable, multi-entry FIFO. The browser is a
view and command client; it does not persist queue entries, infer delivery, or drain the queue.
This keeps reconnects, paired clients, server restarts, and multi-tab use on one authoritative
state machine.

This queue remains distinct from steering. Automatic queueing waits to start a new turn. The
explicit Steer/Retry action deliberately dispatches the selected entry even while a turn is active;
the provider then applies its existing active-turn steering semantics.

## Durable model

- Migration 080 adds `projection_threads.queued_messages_json` and
  `projection_threads.message_queue_enabled`.
- The thread detail snapshot carries `queuedMessages` and `messageQueueEnabled`.
- Queue items capture the text, normalized attachments, model selection, GED workflow flag,
  runtime mode, and interaction mode that were selected when the user enqueued them.
- Commands and events cover enqueue, edit, delete, preference changes, dispatch requests, and
  matching dispatch success/failure outcomes.
- Queue attachments are retained while referenced by a queue entry and pruned after deletion or
  successful dispatch unless a projected chat message still references them.

The web store projects those server events and renders the server snapshot. The former
`composerDraftStore` queue fields and client auto-drain effect were removed as a clean cutover.
Ordinary unsent composer content remains local and is not part of this decision.

## FIFO and readiness rules

Automatic drain considers only `queuedMessages[0]`. A later entry never skips a failed, held, or
dispatching head.

The server may automatically dispatch a queued head only when all of these are true:

- the thread is normal chat rather than an orchestrator-owned thread;
- the head status is `queued`;
- the latest turn is settled;
- no approval or user-input request is pending; and
- the provider session is absent, `ready`, or `idle`.

An interrupted turn changes queued entries to `held`. An interrupted or error/stopped session is
not treated as ready. The user must explicitly steer/retry or edit a held/failed entry before work
continues.

Editing preserves FIFO identity and returns the item to `queued`. Deleting removes only the target.
The per-thread queueing preference controls whether a submission during a running turn is enqueued;
turning it off does not discard entries already in the queue.

## Delivery and recovery

Dispatch is an atomic orchestration decision that marks the item `dispatching`, projects the user
message, and requests the provider turn using the item's captured settings. Provider delivery then
emits a success command that removes only the matching attempt, or a failure command that retains
the entry as `failed` with its error.

Command fingerprints make exact semantic retries idempotent and reject changed content under a
reused command identity. Attachment IDs are deterministic from the raw thread ID, command ID,
attachment index, sanitized metadata, and sanitized content digest. Exact retries therefore reuse
the same stored file; changed content cannot overwrite earlier bytes.

After a server restart, any item left `dispatching` becomes `failed` instead of being retried
automatically. The server cannot prove whether the provider accepted work immediately before the
crash, so automatic retry could duplicate a turn. This conservative ambiguity is surfaced for an
explicit user decision.

## Cutover consequence

The previous browser-local queued entries and queue preference are intentionally not migrated.
They may be lost once at upgrade. Maintaining both queue models would reintroduce competing
authorities and the duplicate-dispatch race this design removes.
