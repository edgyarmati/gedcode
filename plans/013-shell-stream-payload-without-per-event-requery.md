# Plan 013: The shell WebSocket stream stops issuing 3 DB queries per event per subscriber

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. Update this plan's
> row in `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/server/src/ws.ts apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts apps/server/src/orchestration/Layers/OrchestrationEngine.ts apps/server/src/server.test.ts`
> If any changed, re-confirm the excerpts below before editing; on a mismatch
> treat as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (complementary to 011)
- **Category**: perf
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/17

## Why this matters

Every thread-aggregate domain event (activity appends, message deltas, turn
updates) that flows through a shell subscription triggers a re-derivation of the
thread shell via `getThreadShellById`, which issues **3 SQL queries** (thread
row, latest turn, session). And because each connected client gets its **own**
PubSub subscription with its own `Stream.mapEffect`, that 3-query work runs once
per connected client. A single active turn fanning out to N clients does
`3 × events × N` queries just to keep sidebar rows fresh. This is wasted DB work
on the hot broadcast path; the projection already stores the denormalized thread
row, so the shell can be derived without re-querying per event per subscriber.

## Current state

- `apps/server/src/ws.ts` — `toShellStreamEvent` default branch re-derives the
  shell for every thread-aggregate event (lines 355–370):
  ```ts
  default:
    if (event.aggregateKind !== "thread") {
      return Effect.succeed(Option.none());
    }
    return projectionSnapshotQuery
      .getThreadShellById(ThreadId.make(event.aggregateId))
      .pipe(Effect.map((thread) => Option.map(thread, (nextThread) => ({
        kind: "thread-upserted" as const,
        sequence: event.sequence,
        thread: nextThread,
      }))), Effect.catch(() => Effect.succeed(Option.none())));
  ```
- `getThreadShellById` issues 3 queries (`ProjectionSnapshotQuery.ts:1858-1880`):
  ```ts
  const getThreadShellById = (threadId) => Effect.gen(function* () {
    const [threadRow, latestTurnRow, sessionRow] = yield* Effect.all([
      getActiveThreadRowById({ threadId })...,
      getLatestTurnRowByThread({ threadId })...,
      getThreadSessionRowByThread({ threadId })...,
    ]);
    // assembles the shell from the three rows
  ```
- `subscribeShell` pipes the whole domain-event stream through
  `toShellStreamEvent` via `Stream.mapEffect` (`ws.ts:763` region), and
  `OrchestrationEngine.streamDomainEvents` returns a fresh PubSub subscription
  per call (`OrchestrationEngine.ts:326` region) — so the mapEffect runs
  per-subscriber.

## Commands you will need

| Purpose       | Command                                                | Expected on success         |
| ------------- | ------------------------------------------------------ | --------------------------- |
| Typecheck     | `bun typecheck`                                        | exit 0                      |
| Test (scoped) | `cd apps/server && bunx vitest run src/server.test.ts` | all pass                    |
| Test (gate)   | `bun run test`                                         | all pass (never `bun test`) |
| Lint/format   | `bun lint` ; `bun fmt`                                 | exit 0                      |

## Scope

**In scope**:

- `apps/server/src/ws.ts` — `toShellStreamEvent` / `subscribeShell` shell
  derivation and fan-out
- Possibly `apps/server/src/orchestration/Layers/OrchestrationEngine.ts` — if you
  add a shared mapped stream upstream of per-subscriber fan-out
- `apps/server/src/server.test.ts` — extend the WS integration coverage

**Out of scope**:

- The _content_ of the emitted shell event — clients depend on it; the shape and
  values must be identical to today's `getThreadShellById` output.
- `ProjectionSnapshotQuery.getThreadShellById` itself if other (non-stream)
  callers rely on it — do not change its behavior for snapshot/initial-load
  paths; only the per-event-per-subscriber stream path should stop calling it.
- The projection write path (plan 011 covers that).

## Git workflow

- Branch: `advisor/013-shell-stream-no-requery`
- Commit message: `perf: derive shell stream payload without per-event per-subscriber re-query`
- Do NOT push or open a PR unless instructed.

## Steps

> **Approach choice**: Two levers, can combine — (A) **derive from the projected
> row** instead of re-querying: the projection write that produced the event
> already has/updates the denormalized thread row, so the shell can be built from
> that single source instead of 3 fresh queries; (B) **compute once, share across
> subscribers**: map the domain-event stream to shell events _once_ (a shared
> `Stream`/hub) and fan that out, rather than `mapEffect` per subscription. (B)
> removes the ×N multiplier; (A) removes the ×3 per event. State which you
> implement.

### Step 1: Characterize the shell stream output (lock the contract)

In `server.test.ts`, add/extend a test that subscribes to the shell stream
(`subscribeShell`) and drives a thread through events (activity append, turn
update, session change), asserting the sequence of emitted `thread-upserted`
shell payloads (their `thread` contents and `sequence`). This captures exactly
what clients receive today. `server.test.ts` already drives a real `RpcClient`
over a real WebSocket — model after its existing `subscribeShell` test.

**Verify**: the test passes against current code (`cd apps/server && bunx vitest run src/server.test.ts`).

### Step 2: Remove the ×N multiplier and/or the ×3 per-event query

Implement (A) and/or (B):

- (B) lower-risk first: introduce a single mapping of domain events → shell
  events shared across shell subscribers (e.g. map once in `OrchestrationEngine`
  or a shared stream in `ws.ts`), so the derivation runs once per event, not per
  subscriber. Each subscriber then receives the already-mapped event.
- (A): replace the `getThreadShellById` 3-query call in the default branch with
  shell assembly from the projected thread row (which the shell projection
  already maintains — see plan 011's `projectionThreadRepository` row). If the
  emitted shell needs latest-turn/session fields not on the denormalized row,
  either add them to the projection row or fetch them once per event (not per
  subscriber). Ensure the emitted shell reflects post-event state (sequencing
  against the projection write — the event is emitted after the projection
  commits, so reading the projected row is correct; confirm this ordering).

**Verify**: `bun typecheck` → exit 0; the Step 1 characterization test passes
unchanged (identical shell payloads).

### Step 3: Prove the query/derivation count dropped

Add a test that asserts the derivation runs once per event regardless of
subscriber count: subscribe N shell streams for the same thread, emit one event,
and assert the shell-derivation (whatever you can observe — a spy/counter on the
mapping function, or that `getThreadShellById` is called 0–1 times not N times).
If a clean spy point is hard, at minimum assert all N subscribers receive
identical shell payloads from a single emit (proving shared mapping).

**Verify**: the count/sharing test passes; revert Step 2, confirm it fails
(per-subscriber re-derivation), re-apply.

### Step 4: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- Characterization test (Step 1): exact shell payload sequence for a thread's
  event stream.
- Sharing/count test (Step 3): one emit → one derivation → N identical payloads.
- Edge cases: a non-thread aggregate event (must still emit `Option.none()`); a
  thread that does not exist (graceful `none`, matching the existing
  `Effect.catch(() => none)`).
- Structural pattern: existing `subscribeShell` tests in `server.test.ts`.
- Verification: `bun run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The shell stream no longer calls `getThreadShellById` once-per-event-per-subscriber (verified by the Step 3 test: one emit does not produce N derivations)
- [ ] The characterization test passes before AND after with identical shell payloads
- [ ] Non-thread events still emit nothing; missing thread still degrades gracefully
- [ ] `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The emitted shell requires fields that are NOT available without a fresh query
  and are NOT on the projected row — report; adding them to the projection row
  may belong with plan 011.
- The event-vs-projection-commit ordering is NOT "event emitted after projection
  commits" (so reading the projected row would yield pre-event state) — STOP; the
  derive-from-row approach would emit stale shells.
- The characterization test shows different payloads after the change — STOP, do
  not edit the test.
- `toShellStreamEvent`/`subscribeShell` no longer match the "Current state"
  excerpt.

## Maintenance notes

- This pairs with plan 011: 011 makes producing the projected row cheap; 013
  makes broadcasting it cheap. Ideally land 011 first so the projected row is the
  cheap single source 013 reads from.
- A reviewer should confirm the shared-mapping approach (B) does not introduce a
  per-subscriber filtering bug (each subscriber must still only see events for
  threads it is allowed to see, if such scoping exists).
- If client count grows large, this is the difference between linear and constant
  DB load per event — worth a load note in the PR.
