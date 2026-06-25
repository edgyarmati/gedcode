# SPEC — PM (pi) Provider Configuration + pi-only Model Picker

## Goal

The orchestrator PM brain runs on **pi** (fixed harness). Today pi's API key is resolved
**from environment variables only** (`getEnvApiKey`), there is **no UI to configure pi's
providers**, and the PM model picker wrongly reuses the **worker** provider-instance picker
(Codex/Claude/OpenCode harnesses). Result: "failed to start PM runtime", and no way to set pi up.

Build a first-class **pi provider configuration**: let users add/remove/configure **all**
pi-supported providers (API-key, OAuth, ambient), choose which are available in the picker, and
pick the PM's model from a **pi-only** model picker (no worker harness options). Resolve the PM's
credential from this config instead of env-only.

## Background (grounded — see investigations)

- PM authenticates via pi-agent-core `getApiKeyAndHeaders(model) => { apiKey, headers? }`.
- pi-ai providers split three ways:
  - **API-key (~30)**: openai, anthropic-via-key, groq, mistral, deepseek, xai, openrouter, … —
    one env var each (`getEnvApiKey`/`findEnvKeys`). Store a key string; return `{ apiKey }`.
  - **OAuth (3)**: `anthropic` (Pro/Max), `github-copilot`, `openai-codex`. pi-ai exposes
    callback-driven logins (`loginAnthropic`/`loginGitHubCopilot`/codex) returning
    `OAuthCredentials { refresh, access, expires }`; `getOAuthApiKey(provider, creds)`
    auto-refreshes. pi-ai does NOT read Claude/Codex CLI creds — the app drives login + persists.
  - **Ambient (2)**: `amazon-bedrock` (AWS chain), `google-vertex` (ADC). No stored secret;
    `getEnvApiKey` returns the `<authenticated>` sentinel when ambient creds exist.
- Secrets vault exists and is reused verbatim: `ServerSecretStore` (encrypted at rest, 0o600) +
  `redactServerSettingsForClient()` + the `valueRedacted` lifecycle (web preserves the flag so
  edits never clobber a stored secret; server skips the write when `valueRedacted` is set).
- `getModels(provider)` lists a provider's models (`{ id, name, contextWindow, … }`).
- `pmModelSelection` is currently `{ instanceId: ProviderInstanceId, model, options? }` (a worker
  instance) in both `OrchestratorGlobalDefaults` and `OrchestratorProjectConfig`.

## Decisions (settled with the user)

1. **Scope**: API-key + OAuth + ambient, ALL built together before shipping/smoke-test.
2. **Credentials are server-global** (`ServerSettings.piProviders`, secrets via `ServerSecretStore`).
   **Which model the PM uses** stays per-project with a global default (existing Change-A live-global path).
3. **"Available in the picker" is per-provider** (an enabled flag); enabling a provider exposes all its models.
4. **OAuth login = server-brokered copy/paste over WS**: settings shows the auth URL (and Copilot's
   device code); user authorizes in-browser and pastes the returned code; server completes via pi-ai
   and stores `{ refresh, access, expires }`. No localhost redirect listener. Tokens auto-refresh with
   concurrency safety.
5. **`pmModelSelection` clean-reshaped** to a pi `{ piProvider, model }`; the decoder **leniently
   drops** any legacy `{ instanceId, model }` value on replay (→ null = PM unconfigured, re-pick once).
   Append-only-safe (no event rewrites).
6. **Reuse `BackendModelPicker`** with pi-provider data; worker pickers (`RoleBackendPicker`/`RoleConfigRow`) untouched.

## Acceptance criteria

- In Settings → providers, a user can: add a pi provider; enter an API key (redaction-safe);
  complete an OAuth login via paste-code; see ambient providers' status; enable/disable each;
  and choose which are available in the picker.
- The PM model picker lists ONLY models from enabled pi providers (provider → models) — no worker harnesses.
- Setting a pi provider's credential + selecting a model + enabling orchestrator → **PM runtime starts**
  (credential resolved from config, not env). "failed to start PM runtime" resolved.
- OAuth tokens persist across restart and auto-refresh; concurrent refresh is safe (single-flight).
- Secrets never leave the server unredacted; editing without re-entering preserves the stored secret.
- Append-only replay safe: legacy `pmModelSelection` decodes to null; no event rewrites.
- All gates green: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`, `bun run build`.

## Non-goals (v1)

- Per-model (vs per-provider) picker filtering.
- Auto-importing Claude/Codex CLI OAuth creds (pi-ai can't read them).
- Localhost OAuth redirect listener (copy/paste only).
- Changing worker provider instances / worker pickers.
