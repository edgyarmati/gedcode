# Plan 005: Stopping a Claude session resolves pending user-input requests (no leaked fibers)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report — do not improvise. Update this plan's
> row in `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/server/src/provider/Layers/ClaudeAdapter.ts apps/server/src/provider/Layers/ClaudeAdapter.test.ts`
> If either changed, re-confirm the excerpts below before editing; on a mismatch
> treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/12

## Why this matters

When a Claude session stops, `stopSessionInternal` cancels and clears every
entry in `context.pendingApprovals` (so any fiber blocked awaiting an approval
gets released) but does **nothing** for `context.pendingUserInputs`. A
`pendingUserInputs` entry exists whenever Claude is blocked on an
`AskUserQuestion` clarification (plan mode relies on this heavily). The awaiting
`canUseTool` fiber is released only if the SDK propagates an `abort` to that
tool call's signal — but stop happens via `Fiber.interrupt(streamFiber)` +
`query.close()`, and if the abort does not fire, the fiber hangs forever holding
the `Deferred`, leaking one fiber per stopped session that had an open question.
Approvals are handled correctly; user-inputs are the asymmetric gap. The fix
mirrors the existing approvals cleanup.

## Current state

- `apps/server/src/provider/Layers/ClaudeAdapter.ts`:
  - The session context type declares both maps (lines 172–173):
    ```ts
    readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
    readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
    ```
  - They are created together (lines 2669–2670) and attached to the context
    (lines 3093–3094).
  - `stopSessionInternal` (defined at line 2512) cleans up approvals only —
    excerpt (lines 2516–2544):

    ```ts
    if (context.stopped) return;
    context.stopped = true;

    for (const [requestId, pending] of context.pendingApprovals) {
      yield * Deferred.succeed(pending.decision, "cancel");
      const stamp = yield * makeEventStamp();
      yield *
        offerRuntimeEvent({
          type: "request.resolved",
          eventId: stamp.eventId,
          provider: PROVIDER,
          createdAt: stamp.createdAt,
          threadId: context.session.threadId,
          ...(context.turnState ? { turnId: asCanonicalTurnId(context.turnState.turnId) } : {}),
          requestId: asRuntimeRequestId(requestId),
          payload: { requestType: pending.requestType, decision: "cancel" },
          providerRefs: nativeProviderRefs(context),
        });
    }
    context.pendingApprovals.clear(); // <-- approvals cleared

    if (context.turnState) {
      yield * completeTurn(context, "interrupted", "Session stopped.");
    }
    yield * Queue.shutdown(context.promptQueue);
    // ... pendingUserInputs is NEVER touched here ...
    ```

  - `pendingUserInputs` is set at line 2745 (inside `handleAskUserQuestion`),
    which blocks on `Deferred.await(answersDeferred)` at line 2761, and is
    deleted on the normal resolution path by `respondToUserInput` at lines
    3327–3336. Open `respondToUserInput` to see the exact shape the answers
    deferred expects (what value represents a completed/empty answer set).

## Commands you will need

| Purpose       | Command                                                                       | Expected on success         |
| ------------- | ----------------------------------------------------------------------------- | --------------------------- |
| Typecheck     | `bun typecheck`                                                               | exit 0                      |
| Test (scoped) | `cd apps/server && bunx vitest run src/provider/Layers/ClaudeAdapter.test.ts` | all pass                    |
| Test (gate)   | `bun run test`                                                                | all pass (never `bun test`) |
| Lint/format   | `bun lint` ; `bun fmt`                                                        | exit 0                      |

## Scope

**In scope**:

- `apps/server/src/provider/Layers/ClaudeAdapter.ts` — `stopSessionInternal` only
- `apps/server/src/provider/Layers/ClaudeAdapter.test.ts` — add a regression test

**Out of scope**:

- The approvals cleanup loop (it is correct — use it only as the pattern).
- `respondToUserInput` and `handleAskUserQuestion` happy-path logic — read them
  for the answer shape, do not change them.
- The abort-listener lifecycle (that is a separate finding/plan; do not touch it
  here).

## Git workflow

- Branch: `advisor/005-claude-pending-user-inputs-cleanup`
- One commit: `fix: resolve pending Claude user-input requests when a session stops`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Determine the "cancelled answer" value

Open `respondToUserInput` (around lines 3327–3336) and `handleAskUserQuestion`
(around lines 2745–2762). Identify the success type of the `answers` deferred
inside `PendingUserInput` and what an empty/cancelled answer looks like (e.g. an
empty answers array, or a dedicated cancelled variant). Confirm the
`PendingUserInput` field name for the deferred (it is awaited at line 2761).

**Verify**: you can state, in one sentence, the exact value to pass to
`Deferred.succeed(...)` to represent "the question was cancelled because the
session stopped". If you cannot (the type has no safe empty value), STOP — see
STOP conditions.

### Step 2: Add a pendingUserInputs cleanup loop in stopSessionInternal

Immediately after `context.pendingApprovals.clear();` (line 2538) and before the
`if (context.turnState)` block, add a symmetric loop over
`context.pendingUserInputs`:

- `Deferred.succeed` each entry's answers deferred with the cancelled value from
  Step 1.
- Optionally emit a `request.resolved` runtime event mirroring the approvals
  loop (use `requestType` of the user-input and a `decision`/`cancel`-equivalent
  if the payload shape supports it; if it does not map cleanly, resolving the
  deferred is the load-bearing fix — do not invent an event shape).
- Then `context.pendingUserInputs.clear();`.

Keep it inside the same `Effect.fn` generator; use `yield*` like the approvals
loop does.

**Verify**: `bun typecheck` → exit 0 (the `Deferred.succeed` value typechecks
against the deferred's success type).

### Step 3: Add a regression test

In `ClaudeAdapter.test.ts`, add a test that: starts a session, drives it to the
point where a `pendingUserInputs` entry exists with a fiber awaiting the answers
deferred, stops the session, and asserts the awaiting fiber completes (does not
hang) — i.e. the deferred is resolved and the map is empty. Model it after the
existing approvals-cancellation test in the same file (search the file for
`pendingApprovals` / `"cancel"` / session-stop tests and mirror its harness,
which uses the mocked Claude SDK layer already present in this test file).

**Verify**: `cd apps/server && bunx vitest run src/provider/Layers/ClaudeAdapter.test.ts` → all pass, including your new test. Temporarily revert the Step 2 edit and confirm the new test FAILS (proving it covers the bug), then re-apply.

### Step 4: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck` → exit 0; `bun lint` and
`bun run fmt:check` → exit 0.

## Test plan

- New test in `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`:
  - happy path unchanged (existing tests still pass)
  - regression: a session stopped while a user-input question is open resolves
    the awaiting fiber and empties `pendingUserInputs`
- Structural pattern: the existing approvals-cancellation-on-stop test in the
  same file; reuse its mocked-SDK setup.
- Verification: `bun run test` → all pass, including the new test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `stopSessionInternal` clears `pendingUserInputs` (`grep -n "pendingUserInputs" apps/server/src/provider/Layers/ClaudeAdapter.ts` shows a reference between the approvals `.clear()` and the `turnState` block)
- [ ] New regression test exists and passes; it fails when the Step 2 edit is reverted
- [ ] `bun typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun lint` and `bun run fmt:check` exit 0
- [ ] Only `ClaudeAdapter.ts` and `ClaudeAdapter.test.ts` are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The `PendingUserInput` answers deferred has no representable empty/cancelled
  success value (resolving it would require fabricating a malformed answer).
- `stopSessionInternal` no longer matches the "Current state" excerpt (it has
  been refactored since `65e913c7`).
- You cannot construct the open-question state in a test using the existing
  mocked SDK harness after one reasonable attempt — report what is missing.

## Maintenance notes

- If a new kind of pending request map is ever added to `ClaudeSessionContext`,
  it must get the same stop-time cleanup; a reviewer should check that
  `stopSessionInternal` drains _every_ pending map, not just approvals.
- The related abort-listener-removal smell (listeners not removed on the happy
  path in `canUseToolEffect`/`handleAskUserQuestion`) is a separate, lower-risk
  cleanup deliberately not bundled here.
