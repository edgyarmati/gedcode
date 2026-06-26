# State

> **NOTE (2026-06-24):** This file is now COMMITTED (not left uncommitted) because a Codex `--write`
> run's git op reverted the uncommitted `.ged/work/root/*` scratch during WP-A1. Keep it committed via
> `chore(ged)` commits (still kept out of _feature_ commits). The authoritative record is the git
> commits + `CHANGELOG.md` + `docs/upstream-decisions.md`.

- **Phase**: Orchestrator. Phase 4 (#59) + its post-review follow-up COMPLETE. Phase 5 in progress —
  **slice 1 (Real PR Landing) DONE**; remaining slices (isolation/sandbox, scale/perf, board UX) not
  started. Branch `feat/orchestrator-mode`, not merged to `main`. Recommended next: a MANUAL end-to-end
  smoke test (run the app, drive a task to an opened PR) — all validation so far is automated (incl.
  integration tests with a fake provider); no human has driven it against real models/repo yet.
- **Role model**: Claude = PM (decisions/spec/review/gates). Codex = implementation via the codex
  plugin (gpt-5.5 medium normal / high hard). See `[[pm-codex-handoff-workflow]]`.

## Phase 4 base implementation — DONE (12 WPs, full monorepo gate green)

S1.1 `3160f28d3` · S1.2 `f6136aae9` · S1.3 `41dcac1cf` · S1.4 `12e69ee3d` · S1.5 `ff559050b` ·
S2.1 `1e7a0262f` · S2.2 `48540e3e8` · S2.3 `81f00b7d3` · S3.1 `f11b33284` · S3.2 `83d226aed` ·
S4 `df4160e17` · S5 `d32d8ad61` · docs `af135bd26`.

## Post-review follow-up (Codex read-only review found no Critical; invariants solid)

- **#2 — compaction can't stall re-entry: DONE** `fba46d6c8` (5-min timeout + catchCause; non-fatal).
- **#3 — in-place PM model change: DONE** `85fd20905` (Change B — adapter.setModel; per-PM config
  watcher on project.meta-updated; same-provider compact-first switch via queue permit; different
  provider/key/invalid → recreate; `runtimeActive` guard). Low-pri nit: invalidate leaves an inert
  (guarded) watcher fiber — could also interrupt it.
- **#1 — LIVE global defaults (Change A): DONE.** A1 `3c8440cd5` (engine reads `orchestratorDefaults`
  per-command; decider resolves project-explicit-from-RAW-sparse ?? global ?? constant; `resolveStages`
  added, `resolveGatePolicy` takes globals; `land` pinned; backward-compat — no canonical-schema change).
  A2 `a147d25d7` (project editor writes SPARSE overrides — null=inherit per setting; S2.2 seed removed;
  shows inherited/effective). A3 `850a197f6` (live-global E2E proof through the real engine; no defect).

## Phase 4 + post-review follow-up COMPLETE (2026-06-24) — all committed, gate green

## Phase 5 STARTED — slice 1: Real PR Landing (grill 2026-06-24)

Audit: `task.land` is a STUB — decider validates the approved land gate + emits `task.landed`;
`TaskWorktreeReactor` only cleans up the worktree; NO PR opened. `SourceControlProvider.createChangeRequest`
(`GitHubSourceControlProvider.ts:186`) EXISTS but is uncalled. Decisions: open a **gated PR, human
merges (NO auto-merge)**; PR **ready by default** with a draft/ready setting (global default +
per-project override → live-global config, like Change A); target = project default branch; title =
task title, body = work summary + diff; push the task branch with the **server's** creds (human-gated
land path, not the worker); use the project's `SourceControlProvider`; **fail-loud + retryable** (no
remote / push / API failure never silently drops the task); surface the PR url on the task.

**Landing slice DONE (gate green):** L1 `aa017bd1c` (contracts: `openPrAsDraft` inheritable +
`task.pr.opened`/`task.pr-opened` + `OrchestrationTask.prUrl`) · L2 `415db5fba` (land reactor: push +
open gated PR via the project's SourceControlProvider, idempotent/fail-loud/retryable, `createChangeRequest`
gains `draft`, `prUrl` persisted via migration 042) · L3 `579d53ba1` (draft/ready setting in global +
project editors + "View PR" link) · L4 `31f39ab1c` (real-engine land→PR E2E + harness mock provider).
**Remaining Phase-5 slices (NOT started):** isolation/sandbox, scale/perf, board UX.

Low-pri carry-overs: Change-B inert-watcher-fiber cleanup on invalidate.

## ACTIVE (2026-06-25): PM (pi) provider configuration + pi-only model picker

Surfaced by the smoke test: "failed to start PM runtime" — pi's key is **env-only**
(`getEnvApiKey`), there's **no UI to configure pi providers**, and the PM picker wrongly reuses the
**worker** harness picker. New feature (SPEC.md/TASKS.md rewritten for it). Two read-only
investigations grounded it: (1) pi-ai provider/auth model — ~30 API-key, 3 OAuth (anthropic Pro/Max,
github-copilot, openai-codex; pi-ai has `login*` flows → `{refresh,access,expires}` + `getOAuthApiKey`
auto-refresh; app must drive login + persist), 2 ambient (Bedrock/Vertex); credential path is uniform
`getApiKeyAndHeaders → {apiKey,headers?}`. (2) repo grounding — `ServerSecretStore` + `redactServerSettingsForClient`

- `valueRedacted` lifecycle to reuse for pi secrets; `pmModelSelection` reshape touches
  `contracts/orchestrator/config.ts:165-167`, `PmRuntime.ts`, `PmModelResolver.ts`, web
  `projectOrchestrationSettings.logic.ts` + `ProjectOrchestrationSettingsDialog.tsx` (PmModelSection
  reusable) + 3 test files; worker pickers (`RoleBackendPicker`/`RoleConfigRow`) must stay untouched.

**Settled decisions**: both API-key+OAuth+ambient together before shipping; creds server-global
(`ServerSettings.piProviders` via `ServerSecretStore`), selection per-project + global default;
per-provider "available in picker"; OAuth = server-brokered copy/paste over WS (auth URL / device
code → paste code → server completes + persists; single-flight refresh); clean reshape
`pmModelSelection → {piProvider, model}` + lenient legacy decode (drop `{instanceId,model}` → null).

**WPs (TASKS.md, green per WP)**: PI1 contracts (additive: piProviders + PiModelSelection type) · PI2
server creds+redaction + catalog/models WS · PI3 OAuth brokering (HIGH) · PI4 web settings section ·
PI5 **atomic reshape** pmModelSelection→pi + resolver/runtime + pi-only picker + lenient decode (HIGH) ·
PI6 integration. PI5 is atomic because the clean field swap breaks all consumers at once; everything
before it is additive. Dev server still up from the smoke attempt (web :5740) but PM can't start until this lands.

**Progress**: PI1 DONE `55332e7cc` (contracts: `piProvider.ts` — PiProviderId branded, PiProviderConfig
{enabled, apiKey?:{value,valueRedacted?}, oauth?:{connected,expiresAt?}}, PiProviderConfigMap,
PiModelSelection; `ServerSettings.piProviders` defaulted {}; full monorepo gate green — Codex's
`bun run test` EPERM was sandbox-only, passes here 1292 ✓). PI2 DONE `67ba22933` (server: extended the
SHARED settings secret path — `redactPiProviderConfig`/materialize/persist — to cover
`piProviders[*].apiKey` via `ServerSecretStore` `pi-cred-<provider>-apikey`, skip-write on valueRedacted,
stale-secret cleanup; `PiProviderCatalog.ts` + WS `server.listPiProviderCatalog`/`server.listPiProviderModels`;
kind = oauth(getOAuthProviders)/ambient(bedrock,vertex)/apiKey; `findEnvKeys` returns env var NAMES not
values — no leak. Low-pri: `listPiProviderModels` has no typed error/uses Effect.sync — defect on a bad
provider id, but picker only sends real ids. Gate green here). PI3 DONE `62162f6d3` (OAuth brokering:
`PiOAuthLoginBroker` bounded pending sessions [Deferred-collected pasted code bridged to pi-ai login
callbacks; 5-min timeout/abort/fiber-interrupt], `PiOAuthCredentialStore` tokens only in
`ServerSecretStore` `pi-cred-<provider>-oauth` [settings carry {connected,expiresAt}], getAccessToken
refresh-on-expiry+persist+single-flight per provider+clear-on-fail; `PiOAuthProviders` injectable
wrapper; WS start/complete/cancel; gate green here). **Findings**: (a) pi-ai's anthropic/codex browser
login starts an INTERNAL localhost callback server we can't prevent — copy/paste still works via
onManualCodeInput, transient+harmless+auto-completes when browser is local. (b) low-pri: complete-with-
bad-code session lingers until 5-min timeout. (c) WATCH: getAccessToken assumes pi-ai `expires` is ms
epoch — verify in the OAuth smoke test (not on the API-key path). PI4 DONE `03ac773ad` (web:
`PiProviderSettings.tsx` "PM model providers (pi)" section in Connections — catalog list, per-kind
controls [API-key input, OAuth Connect/Disconnect modal via the WS broker, ambient status], enable
toggle = available-in-picker; `PiProviderSettings.logic.ts` whole-map patch builders preserve untouched
redacted secrets/oauth; worker UI/picker/pmModelSelection untouched. Low-pri: no explicit remove-key
affordance, replace-or-disable only. tsgo flake on first typecheck — re-ran 13/13 green). PI5 next
(ATOMIC reshape, HIGH; spec ready `/Users/edgy/.claude/jobs/6da7233d/tmp/PI5-spec.md`). PI5 DONE
`1d2328823` (atomic reshape: `pmModelSelection` → nullable `PiModelSelection` in project+global config
with lenient legacy decode [`NullablePiModelSelection` transformOrFail: worker-shaped {instanceId,model}
→ null, never throws → append-only replay safe]; `PmModelResolver.resolvePiCredential` config-first then
env per kind [apiKey/oauth via getAccessToken/ambient `<authenticated>`], missing → typed
`PiCredentialResolutionError`, kind via shared `getPiProviderKind`; PmRuntime builds getApiKeyAndHeaders

- wires PiOAuthCredentialStore; web project+global PM pickers list only enabled pi providers, worker
  pickers untouched; gate green first pass). **5/6 done.** PI6 next (integration): PmRuntime has a
  `makePiAgentAdapterOverride` seam (line ~1109) → can start the real PM with a FAKE pi adapter (no live
  pi-ai); the big harness stubs PmRuntime wholesale (Layer.succeed ~580) so a focused PmRuntime-layer test
  is cleaner. Prove: (1) PM starts + resolves credential from configured `piProviders` not env; (2)
  lenient-decode replay of a legacy pmModelSelection. Then MANUAL smoke test (configure a pi key in UI →
  pick model → drive a task to a PR).

**PI6 DONE `6f7bd652b`** (integration via `makePiAgentAdapterOverride` seam, no live pi-ai: real PM
runtime starts on a configured pi provider + resolves credential from config not env [config key beats
OPENAI_API_KEY env in the test]; null selection → PmRuntimeError, no adapter; replay test: legacy
worker-shaped pmModelSelection projects to null. **Surfaced + fixed a real defect**: the projector
stored `orchestratorConfig` raw, bypassing the lenient decode — fixed with a NARROW
`normalizeOrchestratorConfigForEvent` that coerces ONLY pmModelSelection [legacy→null] and leaves every
other field raw-sparse, so Change-A live-global inheritance is preserved. First fix attempt over-decoded
the whole config + broke 2 live-globals tests; narrowed + re-verified: orchestratorLiveGlobals 3/3,
projector 15/15, PmRuntime 22/22, full `bun run test` 13/13; typecheck flake [desktop/shared] re-verified
all-pass standalone). Low-pri carry-over: 2 non-fatal Effect-LSP suggestions (TS377074 runFork-in-Effect)
in `PiOAuthLoginBroker.ts:230,233` — benign (publishInitialInfo uses only Deferred); + PI3 watch-item
(OAuth `expires` ms-epoch assumption) + PI2 low-pri (`listPiProviderModels` Effect.sync on bad id).

## ✅ FEATURE CODE-COMPLETE (2026-06-25): all 6 WPs committed, full monorepo gate green

PI1 `55332e7cc` · PI2 `67ba22933` · PI3 `62162f6d3` · PI4 `03ac773ad` · PI5 `1d2328823` · PI6 `6f7bd652b`.
**Next: MANUAL end-to-end smoke test** — `bun dev`, Settings → "PM model providers (pi)" → add an
OpenAI/Anthropic API key + enable it → open a project's Orchestration settings → PM model picker now
lists only pi models → pick one → enable orchestrator → confirm the PM runtime STARTS (the original
"failed to start PM runtime") → drive a task classify→…→land → confirm a real gated PR opens. NOT merged
to `main` until the smoke test passes.

**Smoke-test finding (2026-06-25) → follow-up WP-PI-OAUTHUX (web-only, in progress):** user tried the
OAuth Connect for `openai-codex`; login SUCCEEDED (tokens saved to `pi-cred-…-oauth.bin`,
`oauth.connected:true`, `expiresAt` confirmed ms-epoch → resolves the PI3 watch-item) but the modal sat
waiting for a code that never appeared — pi-ai's localhost listener caught the redirect + auto-completed
(no code to paste). The provider ROW already reflects connected (live `useSettings`, PiProviderRow ~:311);
only `PiOAuthLoginDialog` doesn't notice. Fix (spec `/Users/edgy/.claude/jobs/6da7233d/tmp/PI-oauth-ux-spec.md`):
the modal watches the live `oauth.connected` flip → success/auto-close, keeping the manual paste path for
device-code. No server change (save→settings-broadcast already reactive).

**WP-PI-OAUTHUX DONE `888deb4c1`**: `PiOAuthLoginDialog` watches the live `oauth.connected` flip
(useSettings) + `connectedNotifiedRef` guard → success without a paste; manual device-code path kept;
copy updated. Codex STALLED ~50m in the verify phase (looping on web test-harness discovery) → I
cancelled + finished: fixed an `expiresAt: undefined` exactOptionalPropertyTypes error (conditional
spread) and **greened the `test:browser` suite** (which had NEVER run — sandbox blocks the browser, and
it's separate from `bun run test`): disambiguated selectors (exact OpenRouter vs the OPENROUTER_API_KEY
hint; footer Close via `getByText` vs the dialog's aria-label X) + mocked `getPrimaryKnownEnvironment`
so the enable-toggle dispatches `updateSettings` via `ensureLocalApi` (this also fixed a PRE-EXISTING
broken PI4 render test that mocked the wrong dispatch path). 20/20 browser tests pass; full standard
gate green. **PI3 watch-item RESOLVED**: live `openai-codex` token `expiresAt` is a ms epoch → the
getAccessToken refresh comparison is correct. Note: these mechanical/test fixes were done by me (PM),
not Codex — Codex's sandbox cannot run `test:browser`, so only I can verify browser tests.

## SMOKE TEST (2026-06-26): PM runs on pi end-to-end ✅ — found PM-UX/behavior gaps to harden

Drove the live app. Diagnosed via a temp `ws.ts` `Effect.onError` log (reverted): the original "Failed
to start PM runtime" was **"Orchestrator mode is not enabled for project"** (PmRuntime.ts:259 guard) —
all projects had empty `orchestrator_config_json={}`; user had set only the GLOBAL `orchestratorDefaults.pmModelSelection`
(`{openai-codex, gpt-5.4}`), not the per-project config. After enabling orchestrator on the project +
setting the PM model there, **codex worked — the PM responded** (credential/model/adapter all fine;
codex `expiresAt` confirmed ms-epoch). So the pi-provider feature is proven E2E.

**Gaps found (fix queue, specs in `/Users/edgy/.claude/jobs/6da7233d/tmp/`):**

- **X1 (server) PM project context** — `PM_SYSTEM_PROMPT` (PmRuntime.ts:129-133) is static, no project
  identity; `pmTools.ts` tools take `projectId`/`taskId` as inputs → PM asked the human for a "project/repo
  id". Fix: `buildPmSystemPrompt(project)` + scope tools to the injected project. Spec `X1-pm-context-spec.md`.
  **DONE `598e8524a`** — system-prompt-only (dropped the tool-schema rework that stalled Codex);
  `buildPmSystemPrompt(project)` prepends project id/title/workspaceRoot + "operate on THIS project,
  never ask for ids, use this project id". **Implemented by me (PM), not Codex** — Codex (gpt-5.5)
  STALLED 3× today (OAUTHUX verify; X1-original 35m no edits; X1-simplified 25m no edits — spinning in
  rg/sed explore loops, working tree clean). X1 is a 1-function change → did it directly + gate-green.
- **X2 (server) human input surfacing** — sent PM messages don't render; only PM output does.
  `before_agent_start`→`dispatchUserMessage(event.prompt)` (PmEventProjection.ts:185) uses the drained
  CONCATENATED payload per agent-turn (not per message / not on follow-ups). Fix: surface each human
  message deterministically at send (`ws.ts` orchestrator.sendMessage ~:1020 / PmReEntryQueue), exactly once.
  **DONE `690687d41`** (run by the user via Codex CLI — interactive Codex works; the background companion
  was stalling 4×). Added `runtime.surfaceUserMessage` → projection `dispatchUserMessage`; ws.ts calls it
  before enqueue; `before_agent_start` no longer dispatches a user message. Gate green here (typecheck flake re-verified).
- **X3 (server) PM model inheritance** — `resolvePmHarnessConfig` (PmRuntime.ts:256) reads project-only
  `pmModelSelection`; must fall back to global `orchestratorDefaults.pmModelSelection` (user decided
  inherit-global). `enabled` stays per-project (correct).
- **X4 (web) pi-only PM picker** — `PmModelSection` shoehorns pi providers into the worker
  `BackendModelPicker` (maps piProvider↔instanceId, shows ALL providers grayed-out). Build a dedicated
  pi picker: only enabled/connected pi providers + resolvable models.

Also: worker stages (planner/work/…) need a **provider instance** (Codex/Claude) in Connections — user
has NONE (`providerInstances={}`); that's config, not code. Dev server (devserver2) restarts on each
server edit (node --watch) during Codex runs — restart it clean after the fixes land.

## Codex handoff mechanics (for resume)

- Hand off via the `codex:codex-rescue` subagent (Agent tool): it runs
  `node "/Users/edgy/.claude/plugins/cache/openai-codex/codex/1.0.4/scripts/codex-companion.mjs" task
--background --write --fresh --cwd /Users/edgy/personal/gedcode --model gpt-5.5 --effort high
--prompt-file <spec>` (omit `--write` for read-only reviews). It returns a `task-...` handle;
  poll with the same companion `status <handle>` until non-`running`, then `result <handle>`.
- Specs live in `/Users/edgy/.claude/jobs/6da7233d/tmp/`. Per WP: review the diff, run the full gate
  (`bash /Users/edgy/.claude/jobs/6da7233d/tmp/gates.sh`), commit by pathspec (Codex never commits),
  watch the tsgo concurrency flake (re-run `bun typecheck` standalone). Codex out-of-credits fails in
  ~5s; ask user to refill.
- **Blockers**: none. (2026-06-25 history: a transient Codex session-limit reset at 15:10 Berlin; an
  auth "token could not be refreshed" on the first PI4 dispatch [user re-authed]; out-of-credits on the
  PI6-fix [user refilled]. All resolved; PI6 committed `6f7bd652b`.)
