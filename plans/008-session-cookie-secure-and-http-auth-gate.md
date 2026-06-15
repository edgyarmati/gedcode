# Plan 008: Session cookie is marked Secure and auth over plaintext HTTP is gated when network-exposed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/server/src/auth/http.ts apps/server/src/server.ts apps/server/src/cli/config.ts`
> If any changed, re-confirm the excerpts below; on a mismatch treat as a STOP.

> **Note**: This plan is intentionally NOT published as a public GitHub issue —
> it describes a security-hardening change on a public repository. Keep it local.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: _(intentionally unpublished — security)_

## Why this matters

The browser session cookie is set with `httpOnly`, `sameSite: lax`, and `path`,
but **without `Secure`**. The server binds to `config.host` over plain HTTP and
the `--host` flag explicitly invites binding to `0.0.0.0` or a Tailnet IP
(documented remote-access workflow). When the server is reachable on a non-
loopback address over plaintext HTTP without a TLS-terminating proxy, the
session token rides in cleartext on every request and the cookie — lacking
`Secure` — would also be replayed on any HTTP origin. This is a defensive-
hardening fix: mark the cookie `Secure` when the effective origin is HTTPS, and
warn (or refuse cookie auth) when binding to a non-loopback host without TLS.
The bearer/`wsToken` auth flow is unaffected.

## Current state

- `apps/server/src/auth/http.ts` — bootstrap-credential exchange sets the
  session cookie (lines ~92–97), with no `secure` attribute:
  ```ts
  HttpServerResponse.setCookie(sessions.cookieName, result.sessionToken, {
    expires: DateTime.toDate(result.response.expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
  }),
  ```
  (There is a second bootstrap route, `/api/auth/bootstrap/bearer`, around line
  102, which returns a bearer token and does NOT set a cookie — leave it.)
- `apps/server/src/cli/config.ts:37` — the `--host` flag definition (binding to
  `0.0.0.0`/Tailnet is an intended, documented mode; see `REMOTE.md`).
- `apps/server/src/server.ts:113` (approx) — the HTTP server binds to
  `config.host` over plain HTTP; TLS termination, when present, is external
  (Tailscale Serve / a reverse proxy).
- Read how `config`/the request exposes whether the effective origin is HTTPS
  (e.g. an `X-Forwarded-Proto` header from Tailscale Serve / a proxy, the
  request URL scheme, or a config flag). This determines how Step 1 decides
  `secure: true`.

## Commands you will need

| Purpose         | Command                                                                | Expected on success         |
| --------------- | ---------------------------------------------------------------------- | --------------------------- |
| Typecheck       | `bun typecheck`                                                        | exit 0                      |
| Test (scoped)   | `cd apps/server && bunx vitest run src/auth`                           | all pass                    |
| Test (gate)     | `bun run test`                                                         | all pass (never `bun test`) |
| Lint/format     | `bun lint` ; `bun fmt`                                                 | exit 0                      |
| Find auth tests | `git grep -ln "setCookie\|cookieName\|bootstrap" apps/server/src/auth` | lists the auth test files   |

## Scope

**In scope**:

- `apps/server/src/auth/http.ts` — the cookie attributes on the
  cookie-bootstrap route
- A startup warning when binding non-loopback without TLS — place it where the
  server reads `config.host` and decides to bind (likely `server.ts` or the
  startup module that already logs the bind address). Reuse the existing logger.
- The relevant auth test file(s) for the cookie attributes

**Out of scope**:

- The bearer bootstrap route and the `wsToken` flow — do not change.
- Adding TLS to the server itself — out of scope; TLS termination stays external.
- Changing the default bind host or breaking the loopback/desktop dev flow.

## Git workflow

- Branch: `advisor/008-session-cookie-secure`
- One commit: `fix(auth): mark session cookie Secure on HTTPS origins and warn on plaintext network bind`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Set `secure: true` on the cookie when the effective origin is HTTPS

In `apps/server/src/auth/http.ts`, add `secure: <isHttpsOrigin>` to the
`setCookie` options on the cookie-bootstrap route. Derive `isHttpsOrigin` from
whatever signal the request/config exposes (request URL scheme, a forwarded-
proto header set by Tailscale Serve / proxy, or a config flag). Do NOT
hard-code `secure: true` unconditionally — that would break the loopback/desktop
HTTP dev flow where the browser must still accept the cookie over `http://`
localhost. The rule: `secure` when the user-facing origin is HTTPS, otherwise
not.

**Verify**: `bun typecheck` → exit 0; reading the code, the cookie is `Secure`
on an HTTPS origin and not on plain `http://localhost`.

### Step 2: Warn (or refuse cookie auth) on non-loopback plaintext bind

Where the server binds to `config.host`, detect when the host is non-loopback
(not `127.0.0.1`/`::1`/`localhost`) AND no TLS/forwarded-HTTPS is in effect, and
emit a single clear startup warning via the existing logger, e.g.
`"Binding to a non-loopback host over plain HTTP; session cookies are exposed in cleartext. Use Tailscale Serve / an HTTPS proxy, or rely on the wsToken bearer flow."`
Do not crash the server (the bearer flow remains valid); a warning is the
minimal correct behavior. (If the team prefers refusing cookie auth in this mode
instead of warning, note it as an option in your report — default to warn.)

**Verify**: `bun typecheck` → exit 0.

### Step 3: Update/extend auth tests

In the auth test file that covers the bootstrap routes (find via the grep
above), add/extend tests asserting:

- the cookie is set with `secure: true` for an HTTPS-origin request;
- the cookie is NOT `secure` for a plain `http://localhost` request (dev flow);
- `httpOnly`, `sameSite: lax`, `path` are preserved.
  Model after the existing bootstrap/cookie tests in that file. Auth/server tests
  use the Effect testing style (`@effect/vitest`) — match the file you are editing.

**Verify**: `cd apps/server && bunx vitest run src/auth` → all pass including new assertions. Revert Step 1, confirm the HTTPS-secure test fails, re-apply.

### Step 4: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- Cookie-attribute tests in the auth test file (Step 3 cases).
- Structural pattern: existing bootstrap-route tests in the same file (and
  `apps/server/src/auth/Layers/AuthControlPlane.test.ts` for the auth harness).
- Verification: `bun run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] The cookie-bootstrap `setCookie` includes a `secure` attribute driven by the HTTPS-origin signal (not hard-coded true)
- [ ] A startup warning is emitted when binding non-loopback without TLS (grep the warning string)
- [ ] New/updated auth tests assert Secure-on-HTTPS and not-Secure-on-localhost, and they pass
- [ ] `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- There is no available signal to distinguish an HTTPS origin from plain HTTP at
  cookie-set time (so `secure` cannot be set conditionally) — report; do not
  hard-code `secure: true` and break the localhost dev flow.
- The `setCookie` call no longer matches the "Current state" excerpt.
- Existing auth tests break in a way that suggests the loopback dev flow relies
  on the cookie being non-Secure — report before changing test expectations.

## Maintenance notes

- The companion finding (plan 010) adds an Origin allowlist on the `/ws`
  upgrade and tightens wildcard CORS; together they harden the network-exposed
  surface. A reviewer should consider whether they ship together.
- If the server ever gains first-class TLS, revisit the warning condition so it
  does not fire spuriously.
- Do not log the cookie value or session token anywhere as part of this work.
