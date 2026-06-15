# Plan 006: A turn-interrupt event with no turnId still settles the running turn in the UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/web/src/store.ts apps/web/src/store.test.ts packages/contracts/src/orchestration.ts`
> If any changed, re-confirm the excerpts below before editing; on a mismatch
> treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/13

## Why this matters

The `thread.turn-interrupt-requested` reducer in the web store returns state
**unchanged** when `event.payload.turnId` is `undefined`. But the contract
declares `turnId` as `Schema.optional` — it is legitimately allowed to be
absent. When such an event arrives, the running turn's `latestTurn.state` stays
`running` in the client forever (until/unless a later `thread.session-set`
settles it). If that follow-up never arrives, the UI shows a stuck spinner / a
turn that looks active when it is not. The fix: when there is no `turnId`, fall
back to settling the current `latestTurn` if it is still in a running state.

## Current state

- `apps/web/src/store.ts`, the interrupt reducer branch (lines 1388–1399):
  ```ts
  case "thread.turn-interrupt-requested": {
    if (event.payload.turnId === undefined) {
      return state;                                 // <-- bug: turn left running
    }
    return updateThreadState(state, event.payload.threadId, (thread) => {
      const latestTurn = thread.latestTurn;
      if (latestTurn === null || latestTurn.turnId !== event.payload.turnId) {
        return thread;
      }
      return {
        ...thread,
        latestTurn: buildLatestTurn({
          // ...settles latestTurn to interrupted...
        }),
      };
    });
  }
  ```
- The payload contract (`packages/contracts/src/orchestration.ts:927-931`):
  ```ts
  export const ThreadTurnInterruptRequestedPayload = Schema.Struct({
    threadId: ThreadId,
    turnId: Schema.optional(TurnId),
    createdAt: IsoDateTime,
  });
  ```
- `buildLatestTurn(...)` and the set of turn states (`running`, `requested`,
  `interrupted`, etc.) are defined in the same store/types modules — read how the
  existing `turnId`-present branch builds the `interrupted` latestTurn and reuse
  exactly that construction for the fallback.

## Commands you will need

| Purpose       | Command                                            | Expected on success         |
| ------------- | -------------------------------------------------- | --------------------------- |
| Typecheck     | `bun typecheck`                                    | exit 0                      |
| Test (scoped) | `cd apps/web && bunx vitest run src/store.test.ts` | all pass                    |
| Test (gate)   | `bun run test`                                     | all pass (never `bun test`) |
| Lint/format   | `bun lint` ; `bun fmt`                             | exit 0                      |

## Scope

**In scope**:

- `apps/web/src/store.ts` — the `thread.turn-interrupt-requested` branch only
- `apps/web/src/store.test.ts` — add regression tests

**Out of scope**:

- The contract in `packages/contracts/src/orchestration.ts` — `turnId` is
  intentionally optional; do NOT make it required (that would be a breaking
  schema change and is out of scope).
- Any other reducer branch.

## Git workflow

- Branch: `advisor/006-interrupt-without-turnid`
- One commit: `fix: settle running turn on interrupt events without a turnId`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the early `return state` with a fallback that settles latestTurn

In the `turnId === undefined` branch, instead of `return state`, call
`updateThreadState(state, event.payload.threadId, (thread) => { ... })` and:

- read `thread.latestTurn`;
- if `latestTurn` is null, return `thread` unchanged (nothing to settle);
- if `latestTurn.state` is a still-active state (`running`, and `requested` if
  that is also "not yet settled" — confirm the exact active-state set from the
  type definitions and the present-`turnId` branch), settle it to `interrupted`
  using the same `buildLatestTurn({...})` construction the present-`turnId`
  branch uses;
- otherwise (already settled), return `thread` unchanged so a late no-`turnId`
  event cannot regress an already-completed turn.

Keep the existing present-`turnId` branch exactly as is.

**Verify**: `bun typecheck` → exit 0.

### Step 2: Add regression tests

In `apps/web/src/store.test.ts`, add tests that apply orchestration events via
the exported `applyOrchestrationEvent` (the file already imports it) and assert
on `latestTurn.state`:

- interrupt with no `turnId` while `latestTurn` is `running` → `latestTurn.state`
  becomes `interrupted`;
- interrupt with no `turnId` while there is no `latestTurn` → state unchanged;
- interrupt with no `turnId` while `latestTurn` is already settled (e.g.
  `completed`) → unchanged (no regression);
- the existing present-`turnId` behavior still settles only the matching turn.

Model after the existing turn-lifecycle tests in `store.test.ts` (search for
`turn-interrupt` or `latestTurn`). The file uses plain `vitest`
(`import { describe, expect, it } from "vitest"`) and builds typed events with
`ThreadId`, `TurnId`, etc. from `@t3tools/contracts`.

**Verify**: `cd apps/web && bunx vitest run src/store.test.ts` → all pass. Revert Step 1, confirm the no-`turnId` test FAILS, then re-apply.

### Step 3: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- New tests in `apps/web/src/store.test.ts` covering the four cases in Step 2.
- Structural pattern: existing `store.test.ts` turn-lifecycle tests.
- Verification: `bun run test` → all pass including new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The `turnId === undefined` branch no longer does a bare `return state` (`grep -n "turn-interrupt-requested" apps/web/src/store.ts` then read the branch)
- [ ] New tests exist and pass; the no-`turnId` test fails when Step 1 is reverted
- [ ] An already-settled turn is NOT regressed by a no-`turnId` interrupt (covered by a test)
- [ ] `bun typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun lint` and `bun run fmt:check` exit 0
- [ ] Only `store.ts` and `store.test.ts` are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The exact set of "active" turn states is ambiguous from the types (you cannot
  tell which states should be settled) — report; do not guess and risk settling
  a turn that legitimately should stay open.
- `buildLatestTurn` requires fields you cannot derive without a `turnId` —
  report what is missing.
- The reducer branch no longer matches the "Current state" excerpt.

## Maintenance notes

- The server side may legitimately emit interrupts without a `turnId` (e.g. a
  thread-level interrupt). A reviewer should confirm with the server's interrupt
  emitter that "no turnId" means "interrupt the current turn", which is the
  assumption this fix encodes.
- If the server is later changed to always include a `turnId`, this fallback
  becomes dead but harmless; it can be removed then.
