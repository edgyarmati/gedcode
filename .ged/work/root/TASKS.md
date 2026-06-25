# TASKS — PM (pi) Provider Configuration

Dependency-ordered work packages, **each leaving the full monorepo gate green**. Claude = PM
(spec/review/gates/commit); Codex = implementation (gpt-5.5; **high** effort on PI3/PI5, medium
elsewhere). One WP at a time, in-main-tree, commit by pathspec.

> Why the reshape is one atomic WP (PI5): the user chose a **clean reshape** of `pmModelSelection`
> (not an additive field). Changing the field type breaks server + web consumers simultaneously, so
> the contract swap + resolver/runtime + picker + lenient decode must land together to stay green.
> Everything before PI5 is **additive** (new `piProviders`, new WS APIs, new settings UI) and green
> on its own.

## WP-PI1 — Contracts: additive pi-provider catalog + creds + selection TYPE (schema-only) [medium]

- `PiProviderId` (branded non-empty string; validity enforced server-side — no pi-ai import in contracts).
  `PiProviderConfig`: `{ enabled, apiKey?: { value, valueRedacted? }, oauth?: { connected, expiresAt? } }`.
  apiKey mirrors the `ProviderInstanceEnvironmentVariable` sensitive/redaction idiom; oauth carries
  only non-secret status (raw tokens stay in `ServerSecretStore`). No `kind` field — the provider's
  kind (apiKey/oauth/ambient) is derived server-side from pi-ai + surfaced via the PI2 catalog API.
- `ServerSettings.piProviders: Record<PiProviderId, PiProviderConfig>` (sparse) + `DEFAULT_SERVER_SETTINGS` ({}).
- Add the `PiModelSelection { piProvider, model }` schema/type. **Do NOT change `pmModelSelection`'s
  field type yet** (additive only → green).
- Schema-only (no runtime logic; obey `t3code/no-inline-schema-compile`). Verify: contracts typecheck;
  `piProviders` + `PiModelSelection` round-trip tests; `bun run test`/`fmt`/`lint`/`build` green.

## WP-PI2 — Server: pi credential store + redaction + catalog/models WS API [medium]

- Extend `serverSettings.ts` materialize/redact to cover `piProviders` (secrets in `ServerSecretStore`
  `pi-cred-<provider>-{apikey,oauth}`, redact on wire, skip-write on `valueRedacted`). Independent of `pmModelSelection`.
- WS method(s): list the pi provider catalog (`id`, displayName, `kind`, env-var hint, configured/enabled)
  - `getModels(provider)` per provider (`id`, name, contextWindow) for the settings UI + picker.
- Verify: redaction round-trip + restart persistence; catalog/models method round-trip. Full gate green.

## WP-PI3 — Server: OAuth login brokering over WS [HIGH]

- WS `start` (server invokes pi-ai `login*` with `OAuthLoginCallbacks` → surfaces auth URL / device
  code over WS) + `complete` (pasted code → server finishes → persists `{refresh,access,expires}` to
  `ServerSecretStore`). Cancel/timeout handled. No localhost listener.
- Verify: brokering unit test with stubbed pi-ai login (no network); persisted creds round-trip + redact. Green.

## WP-PI4 — Web: pi-provider settings section [medium]

- New "PM model providers (pi)" section in the Settings provider page: catalog list; per provider —
  enable toggle, API-key input (redaction-aware, reuse `ProviderInstanceCard` secret idiom), OAuth
  login → modal (auth URL / device code → paste code → complete), ambient status + hint. "Available in
  picker" = the enabled flag. Distinct from worker Connections; worker UI untouched.
- Verify: logic unit tests (redaction-preserving edit; enable/disable patch) + render test. Green.

## WP-PI5 — Reshape: pmModelSelection → pi + resolver/runtime + pi-only picker (ATOMIC) [HIGH]

- **Contracts**: swap `pmModelSelection` field type → `PiModelSelection` in `OrchestratorGlobalDefaults`
  - `OrchestratorProjectConfig`; **lenient legacy decode** (`{instanceId, model}` → null).
- **Server**: `PmModelResolver.ts` — `piProvider` is the pi provider id directly (drop worker-instance
  alias map); resolve credential from `piProviders` config (API key / OAuth access token w/ single-flight
  refresh via `getOAuthApiKey` + persist refreshed creds / ambient sentinel). `PmRuntime.ts` consumes it.
- **Web**: repoint `PmModelSection`/`BackendModelPicker` to enabled pi providers (catalog + models);
  selection `{piProvider, model}`; update `projectOrchestrationSettings.logic.ts` + global-defaults
  editor + the 3 test files. Worker pickers (`RoleBackendPicker`/`RoleConfigRow`) untouched.
- Verify: resolver unit tests (key/oauth-refresh/ambient/missing); lenient-decode test; web logic
  (seed/build/round-trip/dirty-check); picker shows only enabled pi providers. **Full gate green.**

## WP-PI6 — Integration: PM starts on a configured pi provider [medium]

- Extend the integration harness: configure a pi provider (stub key), set `pmModelSelection`, enable
  orchestrator → PM runtime starts with the credential resolved from config (mock the pi adapter /
  `getApiKeyAndHeaders`). Replay test: a legacy `pmModelSelection` event decodes to null without breaking replay.
- Verify: integration green; full gates.

## Gates (every WP)

`bun fmt` · `bun lint` · `bun typecheck` (re-run standalone once if tsgo flakes) · `bun run test`
(never `bun test`) · `bun run build`. CHANGELOG `## Unreleased` updated when user/operator-visible.
