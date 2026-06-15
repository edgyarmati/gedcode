# Plan 011: Thread-shell summary counters update incrementally, not by full-history reload per event

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. Update this plan's
> row in `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/server/src/orchestration/Layers/ProjectionPipeline.ts apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts`
> If either changed, re-confirm the excerpts below before editing; on a mismatch
> treat as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: 004 recommended (run `test:coverage` on this file first to see
  which branches are protected)
- **Category**: perf
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/15

## Why this matters

AGENTS.md lists performance as core priority #1. During an active turn the
provider emits a steady stream of `thread.activity-appended` events (plus
proposed-plan / approval / user-input events). For **each** such event,
`refreshThreadShellSummary` reloads the thread's _entire_ message, proposed-plan,
activity, and pending-approval row sets from the DB and rescans them to recompute
four summary counters. Cost per turn is **O(n²)** in events-per-thread, so long,
chatty threads make every new event progressively slower to project — and that
delays the WebSocket push to every connected client. The fix: maintain the four
derived counters incrementally (or compute them with SQL aggregates) instead of
full-history reload + in-memory rescan.

## Current state

`apps/server/src/orchestration/Layers/ProjectionPipeline.ts`:

- `refreshThreadShellSummary` loads everything for the thread (lines 549–561):
  ```ts
  const existingRow = yield * projectionThreadRepository.getById({ threadId });
  if (Option.isNone(existingRow)) {
    return;
  }
  const [messages, proposedPlans, activities, pendingApprovals] =
    yield *
    Effect.all([
      projectionThreadMessageRepository.listByThreadId({ threadId }),
      projectionThreadProposedPlanRepository.listByThreadId({ threadId }),
      projectionThreadActivityRepository.listByThreadId({ threadId }),
      projectionPendingApprovalRepository.listByThreadId({ threadId }),
    ]);
  ```
- Then it rescans in memory to compute four values (lines 563–587):
  - `latestUserMessageAt` — loops all `messages` (lines 563–571)
  - `pendingApprovalCount` — `pendingApprovals.filter(status === "pending").length` (573–575)
  - `pendingUserInputCount` — `derivePendingUserInputCountFromActivities(activities)` (576)
  - `hasActionableProposedPlan` — `deriveHasActionableProposedPlan({...proposedPlans})` (577–580)
  - then `projectionThreadRepository.upsert({ ...existingRow.value, latestUserMessageAt, pendingApprovalCount, pendingUserInputCount, hasActionableProposedPlan })` (582–587)
- `derivePendingUserInputCountFromActivities` (lines 128–136) re-sorts the entire
  activity array each call:
  ```ts
  function derivePendingUserInputCountFromActivities(activities) {
    const openRequestIds = new Set<string>();
    const ordered = [...activities].toSorted(
      (l, r) => l.createdAt.localeCompare(r.createdAt) || l.activityId.localeCompare(r.activityId),
    );
    // ... walks `ordered`, opening/closing request ids ...
  }
  ```
- `refreshThreadShellSummary` is invoked on every `thread.activity-appended`
  (line ~734) plus proposed-plan-upserted / approval / user-input-response-
  requested events.

## Commands you will need

| Purpose        | Command                                                                                            | Expected on success         |
| -------------- | -------------------------------------------------------------------------------------------------- | --------------------------- |
| Typecheck      | `bun typecheck`                                                                                    | exit 0                      |
| Test (scoped)  | `cd apps/server && bunx vitest run src/orchestration/Layers/ProjectionPipeline.test.ts`            | all pass                    |
| Test (gate)    | `bun run test`                                                                                     | all pass (never `bun test`) |
| Coverage (opt) | `cd apps/server && bunx vitest run --coverage src/orchestration/Layers/ProjectionPipeline.test.ts` | report (needs plan 004)     |
| Lint/format    | `bun lint` ; `bun fmt`                                                                             | exit 0                      |

## Scope

**In scope**:

- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — the summary
  derivation and the events that trigger it
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts` — extend

**Out of scope**:

- The projection repositories' query implementations, UNLESS you add a focused
  aggregate query (a COUNT/MAX) — if you do, keep it minimal and tested.
- The per-projector transaction semantics (a separate finding; do not change).
- Any change to the emitted shell shape's _meaning_ — the four counters must
  remain numerically identical to today's full-rescan result.

## Git workflow

- Branch: `advisor/011-incremental-thread-shell-summary`
- Commit per logical step is fine; final message:
  `perf: derive thread-shell summary counters incrementally`
- Do NOT push or open a PR unless instructed.

## Steps

> **Approach choice**: There are two valid strategies — (A) incremental counter
> maintenance from the triggering event, and (B) replace the full-row-set loads
> with SQL `COUNT`/`MAX` aggregates. (B) is lower-risk for counter correctness
> (the DB is the source of truth) and is the recommended default. Use (A) only if
> the aggregate queries are awkward; (A) requires proving every trigger path
> updates the counters consistently. Pick ONE and state which in your report.

### Step 1: Characterize current behavior with a test (lock in the contract)

Before changing anything, add a test in `ProjectionPipeline.test.ts` that drives
a thread through a representative sequence (several activities incl. an open and
then resolved user-input request, a pending then approved approval, several user

- assistant messages, an actionable proposed plan) and asserts the resulting
  shell row's `latestUserMessageAt`, `pendingApprovalCount`, `pendingUserInputCount`,
  `hasActionableProposedPlan`. This captures the exact numbers the refactor must
  preserve. Model after existing tests in the file.

**Verify**: the new test passes against the _current_ code (`cd apps/server && bunx vitest run src/orchestration/Layers/ProjectionPipeline.test.ts`).

### Step 2: Replace full-history reload with aggregates (Strategy B) or incremental updates (Strategy A)

- **Strategy B (recommended)**: add repository methods that compute the four
  values via SQL (`MAX(createdAt) WHERE role='user'` for `latestUserMessageAt`;
  `COUNT(*) WHERE status='pending'` for `pendingApprovalCount`; an aggregate or
  targeted query for the open-user-input count; the existing actionable-plan
  predicate restricted to the latest turn). Replace the four `listByThreadId`
  loads + in-memory scans in `refreshThreadShellSummary` with these aggregates.
  Keep `derivePendingUserInputCountFromActivities` only if it cannot be expressed
  in SQL cleanly — if kept, do not call it with a full re-sort on the hot path
  (push the open/close logic into the query or maintain a counter).
- **Strategy A**: maintain the four counters on the existing thread row,
  adjusting them from the triggering event (increment/decrement open-request
  ids, `max()` the latest-user-message timestamp), so no full-set load happens.

Whichever you choose, the upsert must write the same fields it writes today.

**Verify**: `bun typecheck` → exit 0; the Step 1 characterization test still
passes unchanged (numbers identical).

### Step 3: Confirm all trigger paths still produce correct counters

`refreshThreadShellSummary` is called from `thread.activity-appended`,
proposed-plan-upserted, approval, and user-input-response-requested handlers.
Ensure each path yields correct counters after the refactor (especially
Strategy A, where a missed path silently drifts the sidebar badges).

**Verify**: extend the Step 1 test (or add cases) to drive each trigger event
type and assert counters after each. All pass.

### Step 4: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- New/extended tests in `ProjectionPipeline.test.ts`:
  - characterization test (Step 1) — exact counter values for a representative
    event sequence
  - per-trigger-event correctness (Step 3)
  - edge cases: empty thread, thread with only assistant messages
    (`latestUserMessageAt` stays null), an open-then-resolved user-input pair
    (count returns to 0), a pending-then-approved approval
- Structural pattern: existing `ProjectionPipeline.test.ts` cases.
- Verification: `bun run test` → all pass. The characterization test passing both
  before and after is the proof the optimization is behavior-preserving.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `refreshThreadShellSummary` no longer loads all four full row sets per call (`grep -n "listByThreadId" apps/server/src/orchestration/Layers/ProjectionPipeline.ts` shows the hot path no longer fans out to all four, or they are replaced by aggregates)
- [ ] The characterization test asserts the four counters and passes both before (against current code) and after the refactor
- [ ] Per-trigger-event tests pass
- [ ] `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] Only `ProjectionPipeline.ts`, its test, and (if Strategy B) the projection repositories are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The four counters cannot be reproduced exactly with aggregates/incremental
  logic (some derivation depends on cross-entity state that only the full scan
  has) — report which counter and stop.
- The characterization test produces different numbers before vs after — the
  refactor changed behavior; STOP and do not "adjust the test".
- `refreshThreadShellSummary` no longer matches the "Current state" excerpt.
- Adding repository aggregate methods would require schema/migration changes —
  report; that expands scope.

## Maintenance notes

- The sidebar badges (`pendingApprovalCount`, `pendingUserInputCount`,
  `hasActionableProposedPlan`) are driven by these counters; a reviewer must
  scrutinize that they stay numerically identical, since drift here shows wrong
  badges silently.
- If pagination or activity-trimming is ever added (the web side caps activities
  via `MAX_THREAD_ACTIVITIES`), an incremental Strategy-A counter must not assume
  the full activity history is present — prefer Strategy B (SQL aggregates over
  the persisted rows) for robustness.
- Plan 013 (shell-stream re-query per subscriber) is a complementary perf fix on
  the read/broadcast side; they do not conflict.
