# Plan 007: WebSocket subscription failures are observable instead of silently swallowed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/web/src/rpc/wsTransport.ts`
> If it changed, re-confirm the excerpts below before editing; on a mismatch
> treat as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/14

## Why this matters

The web WebSocket transport swallows errors in three places. If applying an
orchestration event throws (schema drift, an unhandled enum branch in a
reducer), the error is caught with an empty body and that update is silently
lost. Worse: when the underlying subscription stream fails for a
**non-connection** reason, the code `console.warn`s and `return`s — permanently
dropping the subscription with no retry and no UI signal, so the thread silently
stops receiving updates and the user has no idea. AGENTS.md lists "predictable
under load and during failures (reconnects, partial streams)" as a core
priority; a silently-dead subscription is the opposite. This plan makes these
failures observable; it deliberately keeps behavior changes minimal and does not
attempt to add UI error states (that is a follow-up).

## Current state

`apps/web/src/rpc/wsTransport.ts`:

- Listener errors swallowed with an empty `catch` (lines 103–107, inside
  `runStreamOnSession`'s per-value sync):
  ```ts
  try {
    listener(value);
  } catch {
    // Swallow listener errors so the stream can finish cleanly.
  }
  ```
- Reconnect-hook errors swallowed (lines 146–150):
  ```ts
  try {
    options?.onResubscribe?.();
  } catch {
    // Swallow reconnect hook errors so the stream can recover.
  }
  ```
- Non-connection subscription failure → warn + permanent drop (lines 164–180,
  inside `subscribe`'s retry loop):
  ```ts
  } catch (error) {
    cancelCurrentStream = NOOP;
    if (!active || this.disposed) { return; }
    if (session !== this.session) { continue; }
    const formattedError = formatErrorMessage(error);
    if (!isTransportConnectionErrorMessage(formattedError)) {
      console.warn("WebSocket RPC subscription failed", { error: formattedError });
      return;                                   // <-- subscription dies, no retry, no UI signal
    }
    // connection errors fall through to reconnect with backoff (lines 182+)
  }
  ```
- There is already a connection-disconnect path that retries with
  `sleep(retryDelayMs)` (lines 182–189). The distinction the code draws —
  reconnect transport errors vs everything else — is intentional; the problem is
  that "everything else" is dropped _invisibly_.

## Commands you will need

| Purpose     | Command                                                                                                      | Expected on success                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Typecheck   | `bun typecheck`                                                                                              | exit 0                                                 |
| Test (gate) | `bun run test`                                                                                               | all pass (never `bun test`)                            |
| Lint/format | `bun lint` ; `bun fmt`                                                                                       | exit 0                                                 |
| Find logger | `git grep -n "console.error\|reportError\|logger\." apps/web/src/rpc apps/web/src/observability 2>/dev/null` | shows the project's error-reporting convention, if any |

## Scope

**In scope**:

- `apps/web/src/rpc/wsTransport.ts` — the three swallow sites above

**Out of scope**:

- Adding a user-visible UI error/toast state — out of scope for this minimal
  fix (note it as a follow-up). The fix is observability + not-silently-dying.
- The connection-error reconnect path (lines 182+) — it is correct; do not
  change its backoff.
- Any server-side code.

## Git workflow

- Branch: `advisor/007-ws-subscribe-error-surfacing`
- One commit: `fix: surface swallowed WebSocket subscription errors`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Decide the error-reporting channel

Run the "Find logger" grep. If the web app has a structured error reporter /
observability hook, use it. If the convention is plain `console.error`, use
that (the codebase already uses `console.warn` here). Do NOT introduce a new
logging dependency.

**Verify**: you can name the one function/call you will use for reporting.

### Step 2: Replace the empty listener catch with structured reporting

At lines 103–107, replace the empty `catch {}` body with a
`console.error(...)` (or the reporter from Step 1) that includes a stable
message like `"WebSocket listener threw while applying a pushed value"` and the
error. Keep swallowing it for stream-cleanup purposes (do not rethrow — a
throwing listener must not kill the stream), but make it visible.

**Verify**: `grep -n "Swallow listener errors" apps/web/src/rpc/wsTransport.ts`
returns nothing (the empty-swallow comment is gone) and a reporting call exists
in that catch.

### Step 3: Report the reconnect-hook swallow

At lines 146–150, same treatment: report before swallowing, message e.g.
`"WebSocket onResubscribe hook threw"`.

**Verify**: the reconnect-hook catch now reports.

### Step 4: Make non-connection subscription failure observable (and decide retry)

At lines 174–179, upgrade `console.warn` → structured `console.error` (or
reporter), with a clear message that this subscription is being dropped, e.g.
`"WebSocket RPC subscription failed permanently; updates will stop for this stream"`,
including the formatted error and (if available in scope) the subscription
`tag`. Keep the `return` (do not add infinite retry of a genuinely-failing
non-connection stream — that risks a hot loop), but the failure is now loud.
Optionally, if `options.onResubscribe`/an error callback exists, invoke an
error-signal path so the caller _can_ react — only if such a hook already
exists; do not invent one.

**Verify**: `grep -n "console.warn(\"WebSocket RPC subscription failed" apps/web/src/rpc/wsTransport.ts` returns nothing (upgraded to error-level structured reporting).

### Step 5: Full gate

**Verify**: `bun typecheck` → exit 0; `bun run test` → all pass; `bun lint` and
`bun run fmt:check` → exit 0.

## Test plan

- If `wsTransport.ts` (or a sibling `.logic.ts`) has an existing unit test,
  add/extend a test that a throwing listener does NOT kill the stream AND that
  the error reporter is called (spy on `console.error`/the reporter). Search for
  `wsTransport.test` or `rpc` tests first.
- If the transport is only covered indirectly (e.g. via `server.test.ts`
  integration), and a focused unit test would require heavy WS scaffolding, it
  is acceptable to verify via: revert the change, confirm no error surfaces;
  apply, confirm a spy on the reporter is hit when a listener throws. If even a
  spy test is impractical without a large harness, STOP and report — do not ship
  an untested behavior change to the transport.
- Verification: `bun run test` → all pass including any new test.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] No empty `catch {}` remains at the three sites (`grep -n "Swallow listener errors\|Swallow reconnect hook errors" apps/web/src/rpc/wsTransport.ts` returns nothing)
- [ ] Non-connection subscription failure is reported at error level (not silent `console.warn`+return with no message change)
- [ ] A throwing listener still does not crash the stream (covered by a test or explicitly verified)
- [ ] `bun typecheck` exits 0
- [ ] `bun run test` exits 0
- [ ] `bun lint` and `bun run fmt:check` exit 0
- [ ] Only `apps/web/src/rpc/wsTransport.ts` (and possibly a sibling test) are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The three swallow sites no longer match the "Current state" excerpt.
- A focused test proving the behavior change is impractical without large WS
  scaffolding (per the Test plan) — report rather than ship untested.
- You find the non-connection failures are _expected_ and frequent (e.g. a
  normal teardown path routes through here) — in that case error-level logging
  would be noise; report your finding and propose info-level instead.

## Maintenance notes

- Follow-up (deliberately deferred, not this plan): surface a user-visible
  "live updates interrupted — reload" affordance when a subscription drops
  permanently, so the user knows the thread is stale.
- A reviewer should confirm the new logging does not include any auth token or
  PII from the event payload (log the error and a stable message, not the raw
  value).
