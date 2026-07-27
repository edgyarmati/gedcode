# TESTS — Reliable Replay, Then Task-Oriented Inbox

## TDD Rules

- Work in vertical slices: one observable failing test, minimal code to pass, then repeat.
- Exercise public subscription, command, projection, store, and UI interfaces. Avoid private-method
  tests and internal collaborator mocks.
- Run only the narrowest relevant Vitest files with `bun run test`.
- Terra agents run and independently verify tests; production code edits are restricted to Sol-low
  implementation agents.
- Record exact commands and results in the Evidence sections before each PR.

## PR 1 Planned Behavior Coverage

1. Event emitted while snapshot I/O is in flight appears exactly once after the snapshot.
2. Replay events after the snapshot cursor are ordered before buffered/live events.
3. Replay/live overlap is deduplicated by sequence.
4. Buffered events arriving out of callback order are emitted in durable sequence order.
5. Re-subscription/reconnect reconstructs the same result without duplicate application.
6. Replay distance at or below the central bound uses replay.
7. Replay distance above the bound obtains a fresh snapshot instead of unbounded catch-up.
8. Replaceable same-thread/task transport updates coalesce with an explicit covered sequence range.
9. Lifecycle/domain transitions never coalesce.
10. Intentional coalescing does not cause client gap recovery.
11. Oversized activity/tool values remain full in persistence/detail reads.
12. Replay and live WebSocket delivery apply the same trimming limit and expose original-size
    truncation metadata.
13. Shell, normal thread, project, and task subscriptions all obey the shared contract.

### WS-07 transport metadata contract

Activity truncation metadata belongs on the transport activity object as
`activity.transportTruncation`, not inside `activity.payload`. Provider/tool payloads are opaque
durable data, so reserving a field within them risks collision and would blur persisted content with
the WebSocket-only projection. The metadata is `{ truncated: true, originalBytes, retainedBytes }`,
where both byte counts are UTF-8 JSON byte lengths of the corresponding payload.

## PR 1 Required Quality Gates

- Focused server subscription/bootstrap tests.
- Focused contracts tests for protocol changes.
- Focused web recovery/runtime tests.
- `bun fmt`
- `bun lint`
- Narrowest relevant typechecks for changed packages/apps.
- `git diff --check`

## PR 1 Evidence

### WS-02 RED — snapshot/live handoff race (2026-07-27)

Command run from `apps/server`:

```text
bun run test -- --testNamePattern='subscribeThread loses a durable event emitted while its snapshot is loading' server.test.ts
```

Result: failed as intended. The tracer pauses `getThreadDetailById` at snapshot cursor 0, commits a
matching durable thread event at sequence 1 while the snapshot is in flight, deliberately returns an
empty replay, then releases snapshot loading and sends a later live sentinel. The original
snapshot → replay → subscribe architecture produces only the snapshot and sentinel:

```text
expected [ 'snapshot', 2 ] to deeply equal [ 'snapshot', 1 ]
```

This is the intended lost-event assertion, not a setup, type, or timeout failure. The original tracer
cursor of 1 was corrected during WS-03 verification because it contradicted the global sequence
contract: an event at the snapshot cursor is correctly deduplicated. The corrected cursor-0 tracer
remains a deterministic proof of the original snapshot/live attachment race.

### WS-03 GREEN — subscribe-before-snapshot tracer (2026-07-27)

Commands run from `apps/server` (each bounded by `gtimeout 45`):

```text
bun run test -- --reporter=verbose --testNamePattern='subscribeThread loses a durable event emitted while its snapshot is loading' server.test.ts
bun run test -- --reporter=verbose --testNamePattern='subscribeThread' server.test.ts
bun run typecheck
```

Results:

- The corrected tracer passed: 1 passed, 81 skipped, in 2.27 s. It received the snapshot followed
  by durable sequence 1 exactly once.
- The narrow thread-subscription suite passed: 3 passed, 79 skipped, in 2.30 s. This also covers the
  existing missing-PM snapshot and cleared-thread replay behavior.
- `apps/server` typecheck passed with no diagnostics.
- Repository-root `git diff --check` passed with no output.

The fix starts the durable live stream into a scoped queue immediately before snapshot I/O, then
reuses that queue through replay/buffer drain/live delivery. WS-04 owns further ordering,
deduplication, and reconnect coverage.

### WS-04 GREEN — ordered overlap and reconnect coverage (2026-07-27)

Commands run from `apps/server`, each bounded with `timeout`:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeThread deduplicates a replay/live overlap during bootstrap'
timeout 45s bun run test -- server.test.ts -t 'subscribeThread orders buffered live events by sequence instead of callback arrival order'
timeout 45s bun run test -- server.test.ts -t 'subscribeThread reconnects from its newer snapshot without replaying applied events'
timeout 60s bun run test -- server.test.ts -t 'subscribeThread'
timeout 90s bun run typecheck
git diff --check
```

Results:

- The replay/live overlap tracer passed (1 passed, 82 skipped, 2.21 s): replay sequences 1–2 plus
  buffered live duplicate 2 and live 3 were delivered as `snapshot, 1, 2, 3` exactly once.
- The callback-order tracer passed (1 passed, 83 skipped, 2.20 s): buffered sequence 2 arriving
  before sequence 1 was delivered as `snapshot, 1, 2`.
- The reconnect tracer passed (1 passed, 84 skipped, 2.23 s): the first connection received
  `snapshot, 1, 2`; a second public subscription at snapshot cursor 2 received only its newer
  snapshot, which contained both messages, with no duplicate replay.
- The narrow `subscribeThread` suite passed: 6 passed, 79 skipped, in 2.40 s.
- `apps/server` typecheck passed with no diagnostics, and repository-root `git diff --check`
  passed with no output.

WS-04 is complete. WS-05 is next and owns the replay-distance threshold and fresh-snapshot path.

### WS-05 RED — excessive replay refreshes the snapshot (2026-07-27)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeThread refreshes an excessive replay backlog from a fresh snapshot'
```

Result: failed as intended (1 failed, 85 skipped, 2.42 s), with the explicit behavioral
assertion—not a fixture, type, or timeout failure:

```text
an excessive replay must load a fresh thread snapshot: expected 1 to equal 2
```

The public WebSocket tracer gives its first snapshot global cursor 0 and its bounded replay source
1,001 durable events (one matching subscribed thread event plus 1,000 unrelated thread events), so
the threshold is measured before surface filtering. A single original live source supplies matching
sequence 1,002. The intended implementation must request each replay with `limit + 1` (1,001),
discard the stale replay, load a second snapshot at cursor 1,001 without reattaching the live
source, then emit that fresh snapshot followed by live sequence 1,002. The current implementation
loads only one snapshot and therefore demonstrates the missing fresh-snapshot recovery path.

### WS-05 GREEN — bounded replay refreshes from a progressing snapshot (2026-07-27)

Commands run from `apps/server`, each with a finite timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeThread refreshes an excessive replay backlog from a fresh snapshot'
timeout 60s bun run test -- server.test.ts -t 'subscribeThread'
timeout 90s bun run typecheck
git diff --check
```

Results:

- The replay-bound tracer passed (1 passed, 85 skipped, 2.26 s). It verifies the 1,001-event probe
  happens before surface filtering, loads a fresh cursor-1,001 snapshot, retains a single original
  live attachment, emits no stale replay, then emits live sequence 1,002.
- The narrow `subscribeThread` suite passed: 7 passed, 79 skipped, in 2.41 s.
- `apps/server` typecheck and repository-root `git diff --check` passed with no diagnostics.

Implementation inspection confirms the shared primitive requests `limit + 1` explicitly, bounds
collection with the same limit, keeps its already-attached queue through snapshot refresh, refuses a
non-progressing refreshed cursor with a typed snapshot error, and only projects events after the
final fresh cursor. The engine now forwards the explicit replay limit to persistence; no unbounded
fallback was introduced.

### WS-06 RED — thread streaming transport coalescing (2026-07-27)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeThread coalesces consecutive streaming message deltas without coalescing completion'
```

Result: failed as intended (1 failed, 86 skipped, 2.23 s). The public `subscribeThread` tracer
replays two consecutive assistant streaming deltas for the same message at sequences 1 and 2, then
a non-streaming completion at sequence 3. Current transport delivers all three individual durable
events and exposes no covered sequence range:

```text
received sequence 1 text "Hello, ", sequence 2 text "world", sequence 3 completion
expected sequence 2 text "Hello, world" covering 1–2, then separate sequence 3 covering 3–3
```

The deterministic replay path exercises coalescing after durable ordering. The RED assertion is
strictly at the public WebSocket item boundary; persistence is intentionally not inspected or
changed. WS-06 remains `NEXT` until the minimal transport-only implementation and follow-up
non-coalescing coverage are complete.

### WS-06 GREEN — thread streaming transport coalescing (2026-07-28)

Commands run with finite process timeouts:

```text
cd apps/server && timeout 45s bun run test -- server.test.ts -t 'subscribeThread coalesces consecutive streaming message deltas without coalescing completion'
cd apps/server && timeout 60s bun run test -- server.test.ts -t 'subscribeThread'
cd apps/web && bun run test -- orchestrationRecovery.test.ts
cd apps/web && bun run test -- service.threadSubscriptions.test.ts
cd packages/contracts && timeout 90s bun run typecheck
cd apps/server && timeout 90s bun run typecheck
cd apps/web && bun run typecheck
git diff --check
```

Results:

- The public coalescing tracer passed (1 passed, 86 skipped, 2.33 s): the two replayed streaming
  deltas become one sequence-2 transport event with `"Hello, world"` and covered range 1–2; the
  sequence-3 non-streaming completion remains a separate range 3–3 event.
- The narrow `subscribeThread` suite passed: 8 passed, 79 skipped, in 2.44 s.
- The range-aware recovery coordinator passed: 13 passed. It applies range `1..2` once, advances to
  the covered end, ignores the duplicate, and accepts `3..3` without gap recovery.
- The thread runtime subscription suite passed: 14 passed. Its sparse-stream cases confirm that the
  thread aggregate marker advances from `coveredSequenceEnd` without treating a globally newer
  snapshot as proof its aggregate detail is fresh.
- `packages/contracts`, `apps/server`, and `apps/web` typechecks all passed with no diagnostics;
  root `git diff --check` passed with no output.

Inspection confirms compaction is applied after ordered durable delivery and only merges adjacent
assistant `thread.message-sent` items when both are streaming and have the same thread/message.
Any interleaving item or non-streaming completion flushes the pending delta; every emitted event,
including a non-compacted event, carries an explicit single- or multi-sequence range. The compact
operator has no persistence dependency or write path. WS-06 is complete; WS-07 is next.

### WS-07 RED — snapshot activity transport projection (2026-07-28)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeThread projects oversized snapshot activity only at the WebSocket boundary'
```

Result: failed as intended (1 failed, 84 skipped, 2.23 s). The public `subscribeThread` snapshot
contains a tool activity whose UTF-8 JSON payload is 40,271 bytes (an emoji-heavy tool output plus
semantic fields). Current delivery sends it unchanged:

```text
the WebSocket snapshot payload must stay within the shared 32 KiB activity limit:
expected 40271 to be at most 32768
```

The tracer also specifies that the wire copy retains `toolCallId`, `kind`, `status`, `command`,
`path`, and `taskId`, exposes top-level activity `transportTruncation`, and does not mutate the
source projection. It exercises only the snapshot public WebSocket boundary; live/replay parity is a
separate subsequent tracer. WS-07 remains `NEXT`.

### WS-07 GREEN (snapshot only) — activity transport projection (2026-07-28)

Commands run with finite process timeouts:

```text
cd apps/server && timeout 45s bun run test -- server.test.ts -t 'subscribeThread projects oversized snapshot activity only at the WebSocket boundary'
cd apps/server && timeout 60s bun run test -- server.test.ts -t 'subscribeThread'
cd apps/server && timeout 90s bun run typecheck
cd packages/contracts && timeout 90s bun run typecheck
git diff --check
```

Results:

- The snapshot projection tracer passed (1 passed, 87 skipped, 2.21 s). Its emoji-heavy source
  payload is 40,271 UTF-8 JSON bytes; the public WebSocket snapshot carries a payload at or below
  the 32 KiB limit, preserves the required tool identifiers/status/command/path/task fields, and
  reports matching top-level transport truncation byte metadata.
- The narrow `subscribeThread` suite passed: 9 passed, 79 skipped, in 2.46 s.
- `apps/server` and `packages/contracts` typechecks passed with no diagnostics; root
  `git diff --check` passed with no output.

Read-only implementation review confirms the shared projector computes the original byte size before
creating a new activity object with a preview payload; it does not assign into the input activity or
payload. The retained preview explicitly copies the asserted semantic fields. WS-07 remains `NEXT`:
the required replay/live event projection tracer has not been added or verified yet.

### WS-07 RED — replay activity transport projection (2026-07-28)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeThread projects oversized replay activity only at the WebSocket boundary'
```

Result: failed as intended (1 failed, 85 skipped, 2.27 s). The public replay tracer starts from a
normal thread snapshot then replays one `thread.activity-appended` event containing an emoji-heavy
tool payload. Current delivery sends its 40,265-byte UTF-8 JSON payload unchanged:

```text
the WebSocket replay payload must stay within the shared 32 KiB activity limit:
expected 40265 to be at most 32768
```

The tracer additionally specifies preserved semantic tool fields, top-level activity truncation
metadata, retained covered range `1..1`, and an unchanged source replay event/activity after wire
delivery. It is intentionally replay-only; live delivery remains out of scope for this cycle.
WS-07 remains `NEXT`.

### WS-07 GREEN (thread snapshot/replay/live) — activity transport projection (2026-07-28)

Commands run with finite process timeouts:

```text
cd apps/server && timeout 45s bun run test -- server.test.ts -t 'subscribeThread projects oversized replay activity only at the WebSocket boundary'
cd apps/server && timeout 45s bun run test -- server.test.ts -t 'subscribeThread projects oversized live activity only at the WebSocket boundary'
cd apps/server && timeout 60s bun run test -- server.test.ts -t 'subscribeThread projects oversized (snapshot|replay|live) activity only at the WebSocket boundary'
cd apps/server && timeout 60s bun run test -- server.test.ts -t 'subscribeThread'
cd apps/server && timeout 90s bun run typecheck
cd packages/contracts && timeout 90s bun run typecheck
git diff --check
```

Results:

- The existing replay tracer passed (1 passed, 88 skipped, 2.20 s). The newly added live tracer
  passed (1 passed, 89 skipped, 2.24 s).
- The combined snapshot/replay/live activity projection suite passed: 3 passed, 87 skipped, in
  2.31 s. Each path trims the oversized activity payload to the common 32 KiB limit, retains the
  semantic tool fields, emits top-level truncation metadata, retains its `1..1` covered range where
  applicable, and leaves the source snapshot/event untouched.
- The narrow `subscribeThread` suite passed: 11 passed, 79 skipped, in 2.51 s.
- `apps/server` and `packages/contracts` typechecks passed with no diagnostics; root
  `git diff --check` passed with no output.

WS-07 remains `NEXT`. These tests establish the thread stream's three public delivery paths; the
remaining review must confirm equivalent activity-bearing event projection for `replayEvents` and
the other durable subscription surfaces before marking the slice complete.

### WS-07 RED — `replayEvents` activity transport projection (2026-07-28)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'replayEvents projects oversized thread activity only at the WebSocket boundary'
```

Result: failed as intended (1 failed, 87 skipped, 2.21 s). The public `orchestration.replayEvents`
RPC receives one durable `thread.activity-appended` event from the engine and returns its
40,286-byte UTF-8 JSON payload unchanged:

```text
the replayEvents WebSocket payload must stay within the shared 32 KiB activity limit:
expected 40286 to be at most 32768
```

The tracer specifies the same semantic tool-field retention and top-level activity truncation
metadata as thread subscriptions, while asserting the source engine event remains full and
unmodified. It leaves project/task subscription coverage out of scope. WS-07 remains `NEXT`.

### WS-07 GREEN — `replayEvents` activity transport projection (2026-07-28)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'replayEvents projects oversized thread activity only at the WebSocket boundary'
```

Result: passed (1 passed, 90 skipped, 2.20 s). The `replayEvents` result now applies the same
activity transport projection as thread subscriptions while retaining the engine-owned event object
unchanged. WS-07 remains `NEXT` pending the project/task subscription surfaces.

### WS-07 RED — project PM activity transport projection (2026-07-28)

Command run from `apps/server` with a finite process timeout:

```text
timeout 45s bun run test -- server.test.ts -t 'subscribeProject projects oversized PM snapshot and replay activity only at the WebSocket boundary'
```

Result: failed as intended (1 failed, 88 skipped, 2.20 s). One public project subscription tracer
contains both an oversized PM-thread snapshot activity and a subsequent PM
`thread.activity-appended` replay event. The first unchecked outgoing activity is 40,295 UTF-8 JSON
bytes, above the shared 32 KiB boundary:

```text
expected 40295 to be at most 32768
```

The deterministic tracer specifies both paths' semantic tool-field retention and top-level
truncation metadata, and verifies that neither the source PM snapshot activity nor the source
replay event may be mutated. It remains red-only; no project transport implementation was added.
WS-07 remains `NEXT`.

### WS-07 GREEN — complete activity transport projection verification (2026-07-28)

Commands run with finite process timeouts:

```text
cd apps/server && timeout 45s bun run test -- server.test.ts -t 'subscribeProject projects oversized PM snapshot and replay activity only at the WebSocket boundary'
cd apps/server && timeout 60s bun run test -- server.test.ts -t 'projects oversized (snapshot|replay|live|thread activity|PM snapshot)'
cd apps/server && timeout 60s bun run test -- server.test.ts -t 'subscribe(Thread|Project)'
cd apps/server && timeout 90s bun run typecheck
cd packages/contracts && timeout 90s bun run typecheck
git diff --check
```

Results:

- The PM project snapshot/replay tracer passed: 1 passed, 91 skipped, in 2.18 s.
- All five public activity paths passed: normal-thread snapshot, replay, and live; global
  `replayEvents`; and PM-thread project snapshot plus replay (5 passed, 87 skipped, 2.32 s).
- The relevant public subscription suite passed: 12 passed, 80 skipped, in 2.57 s.
- `apps/server` and `packages/contracts` typechecks passed with no diagnostics; root
  `git diff --check` passed with no output.

Route audit confirms projection is applied at the WebSocket boundary for `replayEvents`,
`subscribeThread`, and `subscribeProject`. `subscribeShell` and `subscribeTask` contain no activity
payload surface, so no projector is required there. Persistence and HTTP/detail reads are untouched.
The shared projector uses UTF-8 byte accounting, preserves declared semantic fields, emits top-level
`activity.transportTruncation`, and returns copies; the public tests prove snapshot/event sources
remain unmodified. WS-07 is complete; WS-08 is next.

### WS-08 GREEN — all durable subscription surfaces use ordered bootstrap (2026-07-28)

Commands run from the repository root:

```text
bun run test --filter=gedcode -- src/server.test.ts --testNamePattern='subscribe(Thread loses|Project delivers|Task loses|Shell loses)'
bun run test --filter=gedcode -- src/server.test.ts --testNamePattern='subscribe(Thread|Project|Task|Shell)'
bun run test --filter=@t3tools/web -- src/environments/runtime/service.threadSubscriptions.test.ts
bun run typecheck --filter=@t3tools/contracts
bun run typecheck --filter=gedcode
bun run typecheck --filter=@t3tools/web
git diff --check
```

Results:

- The four public snapshot-loading race tracers passed (4 passed, 89 skipped): normal thread,
  project PM thread, task, and shell each deliver sequence 1 after a cursor-0 snapshot instead of
  losing it to the later sentinel.
- The narrow server durable-subscription suite passed (17 passed, 76 skipped). It includes shell
  covered-range delivery for sparse shell projections, bounded replay refresh, ordered buffering,
  deduplication, compaction, and transport-only activity projection.
- The web runtime suite passed (15 passed), including the cursor-0 shell range `1..3` regression:
  it applies once, advances projection state through sequence 3, ignores the duplicate and stale
  cursor-2 snapshot, and does not reconnect.
- Contracts, server (including dependencies), and web typechecks all passed. `git diff --check`
  passed with no output.

Implementation inspection confirms all four WebSocket routes call `orderedDurableSubscription`:
shell consumes sparse engine shell projections and adds covered sequence ranges at transport; thread,
project, and task consume contiguous durable domain events. The shared primitive still enforces the
central `limit + 1` replay bound and fresh-snapshot retry, while the existing thread/project WebSocket
transport projectors remain at the outbound boundary. Persistence and raw provider streams are not
part of this slice. WS-08 is complete; WS-09 is next.

### WS-09 GREEN — PR 1 final verification (2026-07-28)

Commands run from their relevant workspace directories:

```text
bun fmt
bun lint
cd packages/contracts && bun run typecheck
cd apps/server && bun run typecheck
cd apps/web && bun run typecheck
cd apps/server && bun run test src/server.test.ts src/orchestration/Layers/OrchestrationEngine.test.ts
cd apps/web && bun run test src/orchestrationRecovery.test.ts src/environments/runtime/service.threadSubscriptions.test.ts src/localApi.test.ts
cd packages/contracts && bun run test src/orchestration.test.ts
git diff --check
```

Results:

- `bun fmt` completed across 1,432 files. `bun lint` completed successfully with existing warnings
  only; it reported no errors.
- All narrow typechecks passed: contracts (0.69 s), server (5.20 s), and web (3.96 s).
- Focused server tests passed: 2 files, 111 tests, 6.00 s. This includes the shared engine replay
  limit path and the public shell/thread/project/task subscription tracers.
- Focused web tests passed: 3 files, 46 tests, 1.23 s. They cover range-aware recovery, thread
  subscription application, and local API schema handling. Contract orchestration tests also
  passed: 1 file, 70 tests, 0.30 s.
- `git diff --check` completed with no output.

Final read-only review maps the implementation to every PR 1 acceptance criterion: all four durable
surfaces use the same subscribe-before-snapshot ordered bootstrap; replay, buffered, and live items
deduplicate by sequence; the central `1,000 + 1` replay query refreshes the snapshot rather than
delivering an excessive history; only adjacent same-message streaming assistant deltas compact at
transport with covered ranges; activity previews are projected only while serializing WebSocket
snapshots/events and retain explicit byte metadata; persistence, HTTP/detail reads, and raw provider
streams retain their full or existing semantics. The source diff contains no protocol-compatibility
shim. WS-09 is complete; WS-10 is next.

### WS-10 publication (2026-07-28)

- Branch: `agent/harden-orchestration-replay`
- Implementation commit: `5170f0b20`
- Draft pull request: <https://github.com/edgyarmati/gedcode/pull/67>
- Target: `edgyarmati/gedcode:main`
- Status: awaiting human review and merge; PR 2 must start from the merged PR 1 base.

## PR 2 Planned Behavior Coverage

1. Settle/snooze/activate lifecycle events survive persistence, restart, snapshot, and replay.
2. Commands are idempotent and reject pending approval/input or fresh unadopted user work.
3. New user activity clears settled/snoozed state for only the target normal thread.
4. Durable resumed execution reopens only the affected Orchestrator task.
5. Viewing/navigation and unrelated project PM messages do not reopen work.
6. Completed Orchestrator tasks auto-settle.
7. Normal thread inactivity auto-settles at the configured 1–90 day threshold; null disables it.
8. Explicit active override suppresses automatic settlement until new user activity.
9. Running background work does not cancel snooze.
10. Approval/input/new failure after snooze raises the item into Active.
11. Snooze expiry uses a precise timer and returns the item without a synthetic unsnooze event.
12. Presets produce one hour, eligible evening, tomorrow 09:00, and next Monday 09:00 using local
    calendar arithmetic across DST.
13. The sliding pill partitions Threads and Orchestrator tasks; lifecycle filter partitions Active,
    Snoozed, and Settled; no project grouping appears.
14. Internal PM/worker threads remain excluded.
15. Orchestrator rows navigate to the owning project's Orchestrator view; thread rows navigate to chat.

## PR 2 Required Quality Gates

- Focused contracts, decider, projector, persistence, and replay tests.
- Focused web classification/store/component/navigation tests.
- `bun fmt`
- `bun lint`
- Narrowest relevant typechecks for changed packages/apps.
- `git diff --check`

## PR 2 Evidence

Blocked until PR 1 is merged.
