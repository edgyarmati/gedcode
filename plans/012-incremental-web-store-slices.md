# Plan 012: Web store updates messages/activities incrementally instead of rebuilding full arrays per streamed event

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/web/src/store.ts apps/web/src/store.test.ts`
> If either changed, re-confirm the excerpts below before editing; on a mismatch
> treat as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 004 recommended
- **Category**: perf
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/16

## Why this matters

Each streamed token delta and each appended activity rebuilds the focused
thread's entire message/activity array **and** its `byId` index. Over a turn with
a long thread this is O(n²) (messages) / O(n² log n) (activities) of pure main-
thread work in the browser, causing UI jank that scales with conversation length
— exactly when the turn is most active. The lookup maps the store already
maintains (`messageByThreadId`, `activityByThreadId`) make an incremental update
straightforward and behavior-preserving.

## Current state

`apps/web/src/store.ts`:

- Message event reducer does `find` then full `map` rebuild (lines 1427–1438):
  ```ts
  const existingMessage = thread.messages.find((entry) => entry.id === message.id);
  const messages = existingMessage
    ? thread.messages.map((entry) =>
        entry.id !== message.id ? entry : {
          ...entry,
          text: message.streaming ? `${entry.text}${message.text}` : (message.text.length > 0 ? message.text : entry.text),
          streaming: message.streaming,
          // ...
        })
    : /* append path */;
  ```
- `thread.activity-appended` filters + re-sorts the whole array (lines 1694–1701):
  ```ts
  const activities = [
    ...thread.activities.filter((activity) => activity.id !== event.payload.activity.id),
    { ...event.payload.activity },
  ]
    .toSorted(compareActivities)
    .slice(-MAX_THREAD_ACTIVITIES);
  ```
- The derived slices rebuild the full `byId`/`ids` whenever the arrays change
  (lines 636–663):
  ```ts
  if (previousThread?.messages !== nextThread.messages) {
    const nextMessageSlice = buildMessageSlice(nextThread);  // full Object.fromEntries(messages.map(...))
    nextState = { ...nextState, messageIdsByThreadId: {..., [id]: nextMessageSlice.ids}, messageByThreadId: {..., [id]: nextMessageSlice.byId} };
  }
  if (previousThread?.activities !== nextThread.activities) {
    const nextActivitySlice = buildActivitySlice(nextThread); // full rebuild
    nextState = { ...nextState, activityIdsByThreadId: {...}, activityByThreadId: {...} };
  }
  ```
- The store already maintains `messageByThreadId` / `activityByThreadId` lookup
  maps (those are the slices being rebuilt) — confirm their exact shape
  (`{ byId, ids }`) by reading `buildMessageSlice` / `buildActivitySlice`.

## Commands you will need

| Purpose       | Command                                            | Expected on success         |
| ------------- | -------------------------------------------------- | --------------------------- |
| Typecheck     | `bun typecheck`                                    | exit 0                      |
| Test (scoped) | `cd apps/web && bunx vitest run src/store.test.ts` | all pass                    |
| Test (gate)   | `bun run test`                                     | all pass (never `bun test`) |
| Lint/format   | `bun lint` ; `bun fmt`                             | exit 0                      |

## Scope

**In scope**:

- `apps/web/src/store.ts` — the message reducer, the `thread.activity-appended`
  reducer, and the slice-rebuild block
- `apps/web/src/store.test.ts` — extend

**Out of scope**:

- The serialized shape of `messages`/`activities`/the slices as observed by
  selectors/components — must stay identical (same `ids` order, same `byId`
  contents). This is an internal optimization only.
- `composerDraftStore.ts` (a separate perf finding, plan not in this batch).
- Component code (`ChatView.tsx` etc.).

## Git workflow

- Branch: `advisor/012-incremental-web-store-slices`
- Commit message: `perf: update web message/activity store slices incrementally`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Characterization test (lock the observable contract)

In `store.test.ts`, add a test that applies (via `applyOrchestrationEvent` /
`applyOrchestrationEvents`, already imported) a sequence of events to one thread:
several message-sent events (including streaming deltas that append text to the
same `messageId`), and several `thread.activity-appended` events (including a
re-send of an existing activity id, to exercise the dedup/replace path). Assert
the final `thread.messages`, `thread.activities`, and the derived slices
(`selectThreadByRef` or the relevant selector) — capture exact arrays, `ids`
order, and `byId` contents. This is the contract the refactor must preserve.

**Verify**: the new test passes against current code.

### Step 2: Use the lookup map for message updates; update the slice incrementally

- In the message reducer, replace `thread.messages.find(...)` with a lookup via
  the existing `messageByThreadId[threadId].byId[message.id]` (O(1)) to decide
  update-vs-append. For the array, prefer an incremental update: replace the one
  changed entry in place (still producing a new array reference for immutability,
  but without re-scanning to _find_ it) or maintain the array + byId together.
- In the slice-rebuild block (lines 636–648), instead of calling
  `buildMessageSlice` (full `Object.fromEntries`) on every change, update the
  `byId`/`ids` for just the changed message (replace one key; append one id for a
  new message). Keep `buildMessageSlice` for the initial/bulk path (e.g. snapshot
  application) where a full build is correct.

**Verify**: `bun typecheck` → exit 0; Step 1 test passes unchanged.

### Step 3: Make activity append incremental

- For `thread.activity-appended`, avoid the full `filter` + `toSorted` when the
  appended activity is newer than the current tail (the common streaming case):
  if it sorts to the end, push + trim to `MAX_THREAD_ACTIVITIES`; only fall back
  to filter+sort when the activity id already exists (replace) or arrives
  out-of-order. Update `activityByThreadId` incrementally to match.
- Preserve the exact final ordering `compareActivities` produces and the
  `slice(-MAX_THREAD_ACTIVITIES)` cap.

**Verify**: `bun typecheck` → exit 0; Step 1 test (which includes a re-sent
activity id) passes unchanged.

### Step 4: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- Characterization test (Step 1) — exact arrays + slices for a mixed event
  sequence, including streaming delta concatenation and activity-id replacement.
- Edge cases: streaming delta to a not-yet-seen message id (append path);
  out-of-order activity (must still sort correctly); exceeding
  `MAX_THREAD_ACTIVITIES` (trim correctness); non-streaming message replacing a
  streaming one.
- Structural pattern: existing `store.test.ts` (`import { describe, expect, it } from "vitest"`, builds typed `OrchestrationEvent`s from `@t3tools/contracts`).
- Verification: `bun run test` → all pass; the characterization test passing both
  before and after proves behavior preservation.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The message reducer no longer uses `thread.messages.find(...)` to locate the entry (uses the byId map) — `grep -n "thread.messages.find" apps/web/src/store.ts` returns nothing in that reducer
- [ ] `buildMessageSlice`/`buildActivitySlice` are no longer called on every single streamed delta (still used for bulk/snapshot paths)
- [ ] Characterization test passes before AND after the refactor with identical assertions (no test edits to accommodate behavior change)
- [ ] Edge-case tests pass
- [ ] `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] Only `store.ts` and `store.test.ts` modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The incremental update produces a different `ids` order or `byId` content than
  the full rebuild for any case in the characterization test — STOP; do not edit
  the test to match. The optimization must be invisible.
- The reducers no longer match the "Current state" excerpt.
- `compareActivities` ordering cannot be preserved by the incremental path
  (e.g. ties depend on more than the tail) — report and keep the filter+sort for
  the ambiguous case only.

## Maintenance notes

- The whole point is behavior-preserving speed: a reviewer should diff the
  characterization-test assertions and confirm they are unchanged.
- If the message/activity shape gains fields that affect sort order or identity,
  the incremental paths must be revisited — keep the full-build functions as the
  fallback so the bulk/snapshot path stays trivially correct.
- Plan 011 (server-side incremental shell summary) is the complementary fix on
  the producing side.
