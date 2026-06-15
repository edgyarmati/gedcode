# Plan 010: The /ws upgrade validates Origin and CORS is scoped to known origins

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report. Update this plan's row in
> `plans/README.md` when done unless a reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/server/src/httpCors.ts apps/server/src/ws.ts apps/server/src/auth/Layers/ServerAuth.ts apps/server/src/cli/config.ts apps/server/src/server.ts`
> If any changed, re-confirm the excerpts below; on a mismatch treat as a STOP.

> **Note**: This plan is intentionally NOT published as a public GitHub issue —
> it describes a security-hardening change on a public repository. Keep it local.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: MED
- **Depends on**: none (pairs naturally with plan 008)
- **Category**: security
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: _(intentionally unpublished — security)_

## Why this matters

The `/ws` WebSocket upgrade authenticates via cookie-or-`wsToken` but performs
**no Origin/Host validation** on the handshake, and the HTTP CORS policy is
`access-control-allow-origin: *` while allowing the `authorization` header. With
no Origin check on the WS handshake, a malicious web page a victim visits could
attempt a cross-site WebSocket to a reachable GedCode server; `SameSite=lax` on
the session cookie is then the _only_ control preventing cookie-backed cross-
site WebSocket hijack of the full RPC surface (terminal I/O, git/PR actions,
filesystem browse). Defense should not rest on a single control. This plan adds
an Origin allowlist on the upgrade and scopes CORS to known origins, keeping the
`wsToken` bearer path as the explicit cross-origin escape hatch.

## Current state

- `apps/server/src/httpCors.ts` — wildcard CORS with `authorization` allowed:
  ```ts
  export const browserApiCorsAllowedHeaders = [
    "authorization",
    "b3",
    "traceparent",
    "content-type",
  ] as const;
  export const browserApiCorsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": browserApiCorsAllowedMethods.join(", "),
    "access-control-allow-headers": browserApiCorsAllowedHeaders.join(", "),
  } as const;
  ```
  `browserApiCorsHeaders` is applied to auth/API JSON responses (e.g.
  `apps/server/src/auth/http.ts` uses it on bootstrap responses).
- `apps/server/src/ws.ts` — the `/ws` upgrade route (lines 1268–1278) calls
  `serverAuth.authenticateWebSocketUpgrade(request)` and immediately wires the
  RPC websocket; no Origin/Host check:
  ```ts
  HttpRouter.add("GET", "/ws", Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* ServerAuth;
    const sessions = yield* SessionCredentialService;
    const session = yield* serverAuth.authenticateWebSocketUpgrade(request);
    // ... RpcServer.toHttpEffectWebsocket(...) ...
  ```
- `apps/server/src/auth/Layers/ServerAuth.ts` — `authenticateWebSocketUpgrade`
  (line 347) reads the `wsToken` query param and verifies it, else falls back to
  cookie/bearer; it **never inspects the `Origin` header**:
  ```ts
  const authenticateWebSocketUpgrade = (request) => Effect.gen(function* () {
    const requestUrl = HttpServerRequest.toURL(request);
    if (Option.isSome(requestUrl)) {
      const websocketToken = requestUrl.value.searchParams.get(WEBSOCKET_TOKEN_QUERY_PARAM);
      if (websocketToken && websocketToken.trim().length > 0) {
        return yield* sessions.verifyWebSocketToken(websocketToken)...;
      }
    }
    // ... falls back to cookie/bearer below ...
  ```
- The set of legitimate origins is derivable from the bind host (`config.host`,
  `cli/config.ts:37`) plus the configured serve origins (Tailscale Serve
  hostname, `VITE_HOSTED_APP_URL`/`HOSTED_WEB_*` from `turbo.json` globalEnv,
  any `--host`/port). Read `server.ts`/the config module to find where these are
  known so the allowlist can be assembled.

## Commands you will need

| Purpose       | Command                                                         | Expected on success         |
| ------------- | --------------------------------------------------------------- | --------------------------- |
| Typecheck     | `bun typecheck`                                                 | exit 0                      |
| Test (scoped) | `cd apps/server && bunx vitest run src/auth src/server.test.ts` | all pass                    |
| Test (gate)   | `bun run test`                                                  | all pass (never `bun test`) |
| Lint/format   | `bun lint` ; `bun fmt`                                          | exit 0                      |

## Scope

**In scope**:

- `apps/server/src/auth/Layers/ServerAuth.ts` — add Origin validation in
  `authenticateWebSocketUpgrade` (or a dedicated guard the `/ws` route calls)
- `apps/server/src/ws.ts` — call/enforce the Origin check on the upgrade
- `apps/server/src/httpCors.ts` — scope `access-control-allow-origin` to the
  allowlist (reflect a matching Origin) instead of `*`
- The config/startup module only insofar as needed to assemble the allowlist
- The auth + server WS tests

**Out of scope**:

- The `wsToken` bearer path — it must remain the cross-origin escape hatch
  (token in query, not cookie); do not require an Origin match when a valid
  `wsToken` is presented.
- Changing the RPC surface or any handler logic.
- Loopback/desktop dev: requests with no Origin header (native clients) must
  still work — see Step 2.

## Git workflow

- Branch: `advisor/010-ws-origin-allowlist`
- One commit: `fix(auth): validate Origin on the WebSocket upgrade and scope CORS`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Assemble the allowed-origins set

Find where the server knows its reachable/serve origins (bind host + port,
Tailscale Serve hostname, `VITE_HOSTED_APP_URL`/`HOSTED_WEB_*`). Build a function
that returns the set of allowed origins. Include loopback origins for the dev
flow. Read `REMOTE.md` and the config module to enumerate the legitimate cases
(LAN HTTP, Tailscale HTTPS, hosted web origin).

**Verify**: you can list, in your report, every legitimate origin the allowlist
must include, with the config source of each.

### Step 2: Enforce Origin on the cookie-backed upgrade path; exempt valid wsToken

In `authenticateWebSocketUpgrade` (or a guard the `/ws` route runs before
wiring the socket):

- If a valid `wsToken` is presented → allow (bearer escape hatch; no Origin
  requirement).
- Else (cookie/bearer-header fallback) → read the `Origin` header. If present
  and not in the allowlist → reject with the existing `AuthError`
  (`status: 401`/`403`). If `Origin` is **absent** (native/non-browser client)
  → allow, since browsers always send Origin on cross-origin WS but native
  clients do not; the threat model is specifically the browser cross-site case.
  Keep the existing token/cookie verification intact.

**Verify**: `bun typecheck` → exit 0.

### Step 3: Scope CORS to the allowlist

In `httpCors.ts`, replace the static `"access-control-allow-origin": "*"` with a
helper that reflects the request's `Origin` only when it is in the allowlist
(and sets no allow-origin, or a safe default, otherwise). Because `authorization`
is an allowed header and credentials may be involved, `*` is the weakest choice;
reflect a vetted origin instead. Update the call sites that spread
`browserApiCorsHeaders` (e.g. `auth/http.ts`) to pass the request origin if the
helper now needs it.

**Verify**: `bun typecheck` → exit 0; `git grep -n '"access-control-allow-origin": "\*"' apps/server/src` returns nothing.

### Step 4: Tests

Add/extend tests in the auth layer and/or `server.test.ts`:

- WS upgrade with a cookie and a disallowed `Origin` → rejected (401/403);
- WS upgrade with a cookie and an allowed `Origin` → accepted;
- WS upgrade with a valid `wsToken` and any/absent `Origin` → accepted;
- WS upgrade with no `Origin` (native client) + valid cookie → accepted;
- CORS helper reflects an allowed origin and does not emit `*`.
  `server.test.ts` already drives a real `RpcClient` over a real WebSocket against
  the WS routes — model the upgrade-origin tests after its existing
  auth/subscribe tests. Auth-layer tests use `@effect/vitest`.

**Verify**: `cd apps/server && bunx vitest run src/auth src/server.test.ts` → all pass, including new tests. Revert Step 2, confirm the disallowed-Origin test fails, re-apply.

### Step 5: Full gate

**Verify**: `bun run test` → all pass; `bun typecheck`, `bun lint`,
`bun run fmt:check` → exit 0.

## Test plan

- New tests as in Step 4 (auth layer + `server.test.ts`).
- Structural pattern: existing WS auth/subscribe tests in `server.test.ts` and
  `AuthControlPlane.test.ts`.
- Verification: `bun run test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] No `access-control-allow-origin: *` remains in `apps/server/src` (`git grep` is empty)
- [ ] The `/ws` upgrade rejects a cookie-backed request with a disallowed Origin (test proves it)
- [ ] A valid `wsToken` upgrade is accepted regardless of Origin (test proves it)
- [ ] A native client with no Origin + valid cookie is accepted (dev flow not broken; test proves it)
- [ ] `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- You cannot reliably enumerate the legitimate origins from config (the
  allowlist would be a guess) — report; an over-strict allowlist breaks real
  clients (Tailscale hostname, hosted web).
- The hosted web app (`VITE_HOSTED_APP_URL`) is expected to connect cross-origin
  via cookie (not wsToken) — that would conflict with Origin enforcement;
  report and confirm the intended auth path for hosted pairing before locking it
  down.
- The upgrade route or `authenticateWebSocketUpgrade` no longer matches the
  "Current state" excerpt.

## Maintenance notes

- Pairs with plan 008 (cookie Secure). Together they harden the network-exposed
  surface; consider shipping them in one review.
- When a new serve transport/origin is added (e.g. a managed tunnel), its origin
  must be added to the allowlist or it will be rejected. A reviewer should
  ensure the allowlist is derived from config, not hard-coded.
- Do not log Origin values containing tokens; the `wsToken` is a query param —
  ensure request logging redacts it (cross-check with the existing redaction
  helper).
