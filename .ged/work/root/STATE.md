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
  **DONE `7f0915227`** (run by user via Codex CLI; tests timed out in their env but pass here 25/25):
  `resolvePmHarnessConfig` resolves `project ?? settings.orchestratorDefaults.pmModelSelection ?? null`,
  settings read moved up, enabled guard unchanged. Gate green here.

**Design decision (2026-06-26):** PM stays on **pi**. Driver-based read-only PM (Codex/Claude + MCP
orchestration tools, enforced read-only) deferred as a V2 — captured in memory
`orchestrator-pm-harness-decision.md`; `PiAgentAdapterShape` is the swap seam. X4 (pi-only picker) is the last X-fix.

- **X4 (web) pi-only PM picker** — `PmModelSection` shoehorns pi providers into the worker
  `BackendModelPicker` (maps piProvider↔instanceId, shows ALL providers grayed-out). Build a dedicated
  pi picker: only enabled/connected pi providers + resolvable models.
  **DONE `82dad7941`** (run by user via Codex CLI): new `PiPmModelPicker.tsx` (enabled pi providers only,
  PiModelSelection direct, null=inherit, empty-state hint) wired into BOTH the project dialog + the global
  defaults panel; worker pickers untouched. Gate green here incl. test:browser 24/24. (STATE.md slipped
  into the X4 feature commit via `git add -u` — harmless; use explicit pathspecs.)

## 🔄 PIVOT (2026-06-29): DRIVER-BASED PM REWRITE — drop pi (phase: clarification → plan)

User decided to **throw out the pi PM + pi-provider config** and run the PM on the existing **Codex/Claude
drivers** (read-only). Trigger: cascading pi-PM friction (the provider-config/OAuth/picker saga; PM froze
SILENTLY when its model `openai-codex/gpt-5.4` ran out of quota — `PmEventProjection` surfaces tool
activity + assistant output but NOT turn failures, so quota/rate-limit/auth errors are invisible; the
PM-chat bottom model picker is the reused `ChatComposer` picker and is INERT — `onSend` posts only
`{projectId,message}`, PM uses config `pmModelSelection`). This is the driver-PM V2 from
`[[orchestrator-pm-harness-decision]]`. **Reframe: it's a PM-brain swap + pi removal, NOT a full
orchestrator rewrite** — the event-sourced core (decider, projector, tasks/stages/gates, real-PR landing)
+ worker execution STAY; the `PiAgentAdapterShape` seam is the swap point.

**Decisions (grill-me):** (1) read-only is **HARNESS-ENFORCED** (Codex read-only sandbox / Claude
permission-mode) + prompt, not prompt-only; (2) PM **reuses the worker provider-instance system** (a
Codex/Claude/OpenCode instance + model, per-project + global default — replaces pi pmModelSelection + the
pi picker; the bottom-of-chat worker picker becomes correct); (3) **persistent resumable driver session**
per project (resume on human message + worker settlement; mirrors pi continuity). Rewrite must also fix
the silent-failure (surface PM turn errors) + the inert composer.

**FEASIBILITY (done):** session start/resume + PM session persistence + model switching WORK; but the two
things the driver-PM needs are NOT wired: (GAP1) custom-tool injection — Claude SDK manages tools
internally / Codex ACP hardcodes `mcpServers:[]`; both CAN take MCP servers → must build orchestration-tool
injection as an in-process MCP server; (GAP2) enforced read-only — Claude runtimeMode→acceptEdits/bypass
only, Codex no permission model → must build a read-only mode per driver. pi was chosen BECAUSE it gives
these for free (DenyingExecutionEnv + in-process tools); the rewrite rebuilds them in the driver layer.
I surfaced this + recommended fixing pi instead; **user chose FULL REWRITE anyway (informed).**

**PLAN (SPEC.md + TASKS.md rewritten, phase=implement):** de-risk-ordered WPs — **W1** Claude MCP
tool-injection + enforced read-only (FOUNDATION/risk — prove it before building on top) · W2 DriverPmAdapter
(PiAgentAdapterShape) on the Claude session, wired into PmRuntime · W3 PM model = worker ModelSelection
(picker/resolver) · W4 surface PM turn errors (G) + composer cleanup (F) · W5 Codex parity · W6 remove pi.
Reuse: pmTools/PmEventProjection/PmReEntryQueue/orchestration core/worker provider system. Implement via
user's Codex CLI. (Pre-pivot: pi PM works but is being replaced; needs a worker provider
instance in Connections — providerInstances was empty.)

**W1 DONE `6ebba93c6` (LINCHPIN PROVEN):** Claude Agent SDK 0.3.159 takes in-process MCP per session
(`createSdkMcpServer`+`tool()`, zod schemas) via query `mcpServers`; enforced read-only =
`permissionMode:"plan"` + allowedTools(Read/Grep/Glob + mcp__t3_orchestrator__*) + disallowedTools
(Write/Edit/MultiEdit/Bash/…) + strictMcpConfig + canUseTool denial (defense-in-depth). Added
`readOnly`/`enableOrchestrationTools` session flags (contracts), extracted `makePmToolExecutors` (pmTools,
shared by pi AgentTools + MCP), `orchestration/claude/pmMcpServer.ts`, ClaudeAdapter `buildClaudeReadOnlyToolPolicy`,
proof test (orchestration MCP tool invocable + Write/Bash denied). NOT wired to PM runtime yet. Gate green
here. **W2 DONE `fd19b82c6`** (additive): `orchestration/claude/DriverPmAdapter.ts` implements
PiAgentAdapterShape over ClaudeAdapter — starts the PM thread as a read-only Claude session + orchestration
MCP (W1), bridges Claude driver events → AgentHarnessEvent (validated against the REAL PmEventProjection in
the test), persistent/resumable per project via ProviderSessionDirectory. compact()=no-op, setResources/
setModel=future-turns, images unsupported. NOT wired to PmRuntime; pmModelSelection unchanged. Gate green
(tsgo flake hit effect-codex-app-server — passes standalone; gedcode standalone clean). **WATCH (live):**
the read-only/plan Claude session executing its orchestration MCP tools is test-validated only with a
MOCKED session — confirm against the real Claude API in/after W3.

**W3 next — ATOMIC SWAP (PM runs on Claude):** pmModelSelection `PiModelSelection`→worker `ModelSelection`
{instanceId,model} (contracts, lenient-decode legacy pi→null); resolver returns the PM provider instance+model
(project ?? global); PmRuntime builds DriverPmAdapter (W2) from the resolved CLAUDE instance + its ClaudeAdapter
(replacing PiAgentAdapter/PmModelResolver pi-credential path); web PM picker → worker BackendModelPicker
(replace PiPmModelPicker). PM model must be a CLAUDE instance for now (Codex parity = W5); non-Claude → clear error.

**W3 DONE `ef05191c4` — PM RUNS ON CLAUDE (driver), not pi.** pmModelSelection→worker ModelSelection (lenient
pi→null); PmRuntime resolves the PM instance, looks up via `ProviderAdapterRegistry`, Claude-only guard
(`claudeAgent` driver, PmRuntime.ts:333), builds DriverPmAdapter from the resolved ClaudeAdapter +
ProviderSessionDirectory; seam=`makeDriverPmAdapterOverride`; web PM picker→worker BackendModelPicker;
PiPmModelPicker deleted. Standalone pi modules remain (W6). Gate green here (tsgo flake hit @t3tools/web —
passes standalone; test:browser pickers 22/22). **LIVE-TESTABLE NOW** (config a Claude provider instance in
Connections as the PM model). Remaining: **W4** surface PM turn errors (G) + composer cleanup (F) · **W5**
Codex PM parity · **W6** delete pi. WATCH: confirm the read-only/plan Claude PM actually executes its
orchestration MCP tools against the REAL API (test was mocked) — the live test confirms it.

**W4 DONE `9b9662126` — PM turn failures surface (no more silent freeze) + focused composer.** (G)
`onTurnError` (PmRuntime.ts) now ALWAYS appends a `pm.turn.failed` error activity onto the PM thread via
`PmEventProjection.dispatchActivity` (renamed from dispatchToolActivity; now exported), classified
rate_limit/auth/aborted/provider_error (`classifyPmTurnFailure` reuses `classifyRuntimeErrorClass` +
auth/abort regex); message is `scrubSecrets`'d + truncated (no credential leak); activity id is
content-hashed → idempotent (repeated identical failures de-dupe); rate_limit STILL keeps the existing
quota-pause (`markBlocked`); dispatch is best-effort (self-catches). (F) PM chat composer is now a
focused `PmChatComposer.tsx` (textarea + send, read-only "PM model: <label>" + Running indicator),
replacing the full ChatComposer whose model/runtime/workflow controls were inert for the config-driven PM.
Gate green here: fmt ✓ · lint ✓ (pre-existing warnings) · typecheck 13/13 ✓ (no flake this run) · build ✓ ·
server PmRuntime 29/29 · web OrchestratorRoutes 4/4 · test:browser orchestrator 3/3. Remaining: **W5**
Codex PM parity · **W6** delete pi. **LIVE TEST READY** — config a Claude provider instance in Connections
as the PM model; failures will now show in-chat (confirms the WATCH item too).

**W4a DONE `29172bb40` — PM↔orchestration-MCP wiring fix (live-test blocker).** First live test of the
driver-PM failed EVERY turn: `Claude orchestration MCP tools require makeOrchestrationMcpServer`
(ClaudeAdapter.ts:3098) — and W4's surfacing WORKED (user saw "PM turn failed" in-chat, no silent freeze).
Root cause: the PM resolves the WORKER-registry Claude adapter, which `ClaudeDriver` builds WITHOUT the MCP
factory; ClaudeDriver can't build it (needs the orchestration ENGINE, but providers are constructed before
the engine) and it can't ride the schema-only `ProviderSessionStartInput` contract (`provider.ts:65-66`).
Fix: dependency-free late-bound holder `OrchestrationMcpServerProvider` (Ref-backed; register + build;
build-before-register keeps the exact prior error), provided as a ROOT singleton (`server.ts:427`
`Layer.provideMerge`) so the provider layer + orchestration layer share ONE instance. PmRuntime builds the
orchestration MCP config ONCE (it has the engine, `makePmRuntime` ~ln 499) + registers it; `ClaudeDriver`
(:145) sets `makeOrchestrationMcpServer` to a thunk that reads the holder LAZILY at session-start via
`runPromiseWith(capturedContext)` (inert for worker sessions — they never set enableOrchestrationTools).
Gate green here: typecheck 13/13 (no flake) · affected server tests 71/71 (holder + ClaudeDriver + PmRuntime
+ e2e + 2 registry) · fmt · lint(0) · build 3/3. **LIVE TEST UNBLOCKED.**

**W4b DONE `6df51f465` — read-only PM runs in `default` permission mode, not `plan`.** 2nd live test: PM
"just responded in the chat", the workflow never started, and turns showed "(empty response)". Root cause:
`buildClaudeReadOnlyToolPolicy` used `permissionMode:"plan"` — plan mode makes Claude RESEARCH-AND-PROPOSE
(it calls `ExitPlanMode`, which the ClaudeAdapter canUseTool handler at :2910 captures as a proposed-plan +
DENIES with "wait for the user's feedback", ending the turn) instead of ACTING, so it never invoked its
orchestration MCP tools; plan turns carry no bridged assistant text → MessagesTimeline.tsx:540 renders
"(empty response)". Fix: `permissionMode:"default"`. Read-only is UNCHANGED — enforced by allowedTools
(Read/Grep/Glob + orchestration MCP) + disallowedTools (Write/Edit/MultiEdit/Bash/…) + `canUseTool`'s
`readOnly` branch (:2933) which denies any non-read/non-orchestration tool. Updated the 3 read-only policy
asserts (plan→default); worker interaction-mode "plan" path untouched. Gate green: typecheck 13/13 · affected
tests 62/62 · fmt · lint(0) · build 3/3.

**W4c DONE `122be543b` — PM system prompt forces delegation.** 3rd live test: PM still answered directly
("I have no shell, can't run bun outdated, enable a Bash tool for me") instead of orchestrating. Rewrote
`PM_SYSTEM_PROMPT`: PM DELEGATES/never executes; read-only by design (never apologize/work around it);
workers have FULL access (shell/network/edits, `bun outdated`, tests); any execution/inspection/change MUST
become a task handed to a worker; never answer from read-only view or ask the human to run commands. Updated
buildPmSystemPrompt test. Gate green. **BUT still didn't work → W4d.**

**W4d DONE `39c94a209` — the PM system prompt was never actually SENT to the Claude session (THE fix).**
Diagnostic (temp `DIAG claude.init` log, since reverted) proved the read-only PM had ALL 7 orchestration MCP
tools connected (`t3_orchestrator` "connected"; tools list included `mcp__t3_orchestrator__{classifyRequest,
createTask,getTaskLedger,handoffWorker,inspectStage,requestApproval,setTaskBackend}`) — so tools were never
the problem. Root cause: `buildPmSystemPrompt` was built + handed to DriverPmAdapter but ONLY emitted to the
projection (cosmetic); it was NEVER sent to the Claude session. `ClaudeAdapter` hardcoded
`systemPrompt:{type:"preset",preset:"claude_code"}`, so the PM ran as generic read-only Claude Code (hence
"enable Bash for me"). Fix: added serializable `systemPromptAppend` to `ProviderSessionStartInput` (contract);
ClaudeAdapter appends it to the preset (`{type:"preset",preset:"claude_code",append}`); DriverPmAdapter passes
`options.systemPrompt` through at startSession. Tests assert it reaches startSession + becomes the preset
append. Gate green: typecheck 13/13 · affected tests 63/63 · fmt · lint(0) · build 3/3. **RE-TESTING (4th).**
Open secondary bugs (deferred, not blocking orchestration): (#2) human message surfacing is INTERMITTENT
(DIAG confirmed server-side `dispatchUserMessage` fires; web sometimes doesn't render — projection/web race);
(#3) trailing "(empty response)" turn. Remaining WPs: **W5** Codex PM parity · **W6** delete pi.

**MILESTONE (2026-07-01): the driver-PM on Claude ORCHESTRATES live** — after W4d it classified a request,
checked the ledger, inspected a stage, reasoned about maxParallelTasks, and offered to create/hand off a
worker. The W-series rewrite is validated end-to-end.

**W4e DONE `405c809e8` — PM chat live-render fixes (impl by Codex, reviewed+gated by me).** Live testing found
3 render bugs, all where a REFRESH showed correct state (read-model right; live push/apply diverged): (A)
tool-only PM turns completed a text-less assistant message → "(empty response)" — PmEventProjection now skips
completing a textless turn; (B) human messages intermittently didn't surface — events committed between the
snapshot read and live-subscription attach were lost + stale snapshots overwrote newer live state → ws.ts
prepends a snapshot-sequence REPLAY stream before the live stream (thread/project/task subs) + the web client
dedups by eventId & per-aggregate applied/snapshot sequence and SKIPS stale snapshots; (C) stuck "worker"
indicator = stale snapshot replacing a live tool.completed activity → same skip fix. Also gates the pmQuotaBlock
snapshot write behind skipPmThread (review Finding-2, folded in). Reviewed via code-reviewer subagent (0 crit;
confirmed eventId dedup prevents replay/live double-apply incl. streaming deltas; Finding-2 fixed). Gate green:
typecheck 13/13, full suite 1347 pass, web 41, server 35, fmt/lint/build, test:browser orch 3/3. **Codex process
note:** the narrow Finding-2 follow-up only applied after running it in a FRESH Codex thread — resuming the W4e
thread made Codex replay the whole W4e diff+summary (byte-identical) instead of the one-line guard.

**Deferred (non-blocking):** client `appliedOrchestrationEventIdsByEnvironment` Set grows for the connection
lifetime (~50KB/session, cleared on disconnect) — bounded-eviction follow-up only if PM turn volume grows.

**REAL GAP found in live test → next WP candidate: task cancel/abort.** There is NO task cancel/abort/close
command anywhere (decider/contracts). A task stuck in `planning` (leftover 2026-06-29 smoke task) permanently
occupies the single `maxParallelTasks` worktree slot; neither the PM nor the human can clear it. Immediate
unblock = raise maxParallelTasks in project Orchestration settings; proper fix = a cancel command (+ PM tool).

**WP-CANCEL DONE `434c68c1e` — task cancel exposed (human RPC + PM tool), impl by Codex, reviewed+gated by me.**
Decision: REUSE the existing `task.abandon` terminal transition (already frees the maxParallelTasks slot via
isTerminalTaskStatus + cleans the worktree via TaskWorktreeReactor) rather than build a parallel cancel
command/event/status — it was just UNEXPOSED. Added: human WS RPC `orchestrator.cancelTask({taskId})` (ws.ts,
wired through ipc/rpc/wsRpcClient/environmentApi) + PM MCP tool `cancelTask` (pmTools + pmMcpServer, auto-
allowlisted) — BOTH dispatch `task.abandon`; a destructive "Cancel task" header action for non-terminal tasks
(OrchestratorRoutes); projector `task.abandoned` now also drops that task's pendingGates (no ghost gate; other
tasks' gates untouched). Cancelled tasks display as "abandoned" (accepted tradeoff). Out of scope: interrupting
an in-flight worker session. Gate green: typecheck 13/13, full suite 1349 pass, server 91, web 26, fmt/lint/
build, new cancel browser test 2/2. (The lone browser failure — ChatView "plan mode Shift+Tab" — is the KNOWN
PRE-EXISTING failure, unrelated; WP-CANCEL only added a mock line to that file.)

## Y-SERIES (2026-06-29): orchestrator worker/nav/PM-chat fixes (from 2nd smoke test)

Smoke test found 5 more issues (PM created a task "Audit outdated dependencies", handed off a plan
worker on built-in `codex`/gpt-5.4, approval-required). Investigated (2 read-only agents) + decisions taken.
Run via the user's Codex CLI (background companion stalls; interactive Codex works), one at a time, review+gate+commit each:
- **Y1 (server) worker full-access**: stage-start HARDCODES `runtimeMode:"approval-required"`
  (`decider.ts:1222,1265`); `allowFullAccessWorkers` (resourceLimits, UI checkbox at
  ProjectOrchestrationSettingsDialog ~505-516, resolved in `ProviderCommandReactor.ts:336-373` +
  `workerSafety.ts:29-37 clampWorkerRuntimeMode`) only CLAMPS DOWN → toggling it does nothing. Fix:
  orchestrator worker stage-start runtimeMode = full-access when allowFullAccessWorkers (project ?? global)
  true, else approval-required; keep thread stored mode + reactor-applied mode consistent. **Decision B: full-access.**
  **DONE `828ff62e9`** (user ran via Codex CLI; background companion stalled 5/5 — done): decider resolves
  `resolveAllowFullAccessWorkers(project ?? global)` → `resolveWorkerStageRuntimeMode` → writes mode into
  thread.created + turn-start; reactor uses same shared resolver (consistent stored/applied); extracted shared
  `orchestratorConfigResolution.ts` + `@t3tools/shared resolveAllowFullAccessWorkers`; **also added `.ged/` to
  `.oxfmtrc.json` ignore (fmt no longer mutates planning scratch)**. Gate green here. **Going forward: skip the
  background companion (5/5 stalled today) — user runs prompts in their Codex CLI; I review+gate+commit.**
- **Y2 (web) orch-only sidebar + PM thread filter + nav**: `/_orch` sets mode true (`routes/_orch.tsx:10`),
  `/_chat` never sets false → clicking a chat strands you; sidebar always lists chats. PM thread (`pm:` prefix,
  `pmThreadIdForProject`) shows in sidebar — filter at `store.ts selectSidebarThreadsForProjectRef ~2914-2926`
  (`!id.startsWith("pm:")`). **Decision C: orch mode shows ONLY orchestrator content (hide regular chats); reset mode on /_chat.** D folded in.
  **DONE `83a964490`** (user via Codex CLI): Sidebar hides regular chat panels when orchestratorMode/`/orch`;
  `/_chat` resets orchestratorMode(false) on mount; `store.ts selectSidebarThreadsForProjectRef` filters
  `!id.startsWith("pm:")`; logic extracted to Sidebar.logic.ts + tests. Gate green here (tsgo flake hit
  tailscale/effect-acp — both pass standalone, @t3tools/web clean).
- **Y3 (server+web) global worker-backend default + surface resolved default**: resolution is task role →
  project roleModelSelections → project defaultModelSelection → error (`stageModelSelection.ts:8-18`,
  `decider.ts:1173-1177`); NO global worker default. RoleBackendPicker shows "Use default" without saying
  what. **Decision A: ADD a global worker-backend default (orchestratorDefaults) + show the resolved default in the picker.**
  **DONE `ba528ba38`** (user via Codex CLI): additive nullable `orchestratorDefaults.defaultWorkerModelSelection`;
  precedence task role → project role → global worker default → project default → error
  (`stageModelSelection.ts`); Settings→Orchestrator worker BackendModelPicker; per-stage "Use default" shows
  the resolved instance+model. Gate green here (tsgo flake hit @t3tools/web in the full run — passes standalone; test:browser 24/24).
- **Y4 (server+web) clear PM chat**: new `pm.clear` command → clear PM thread messages + invalidate runtime
  (reuse `invalidateRuntime()` PmRuntime.ts:1215-1227) + wipe pi session storage (pm_sessions/pm_session_entries
  SqliteSessionStorage) + UI button in PM chat header (OrchestratorRoutes PmConversation). **Decision E: full reset.**
  **DONE `fb329bf5a`** (user via Codex CLI): append-only `thread.clear` command + `thread.cleared` event
  (contracts/decider/projector/ProjectionPipeline/web store — projector resets messages/activities/plans/
  checkpoints/turn/session, replay-safe); `clearSqliteSessionStorage`; factory per-project
  waitForIdle/clearSessionStorage/invalidateRuntime; `orchestrator.clearPmChat` RPC orders
  waitForIdle→thread.cleared→clear session→invalidate; confirming Clear button in PM chat header.
  Gate green here (typecheck 13/13, test 13/13, build, fmt).

## ✅ Y-SERIES COMPLETE (2026-06-29): Y1 `828ff62e9` · Y2 `83a964490` · Y3 `ba528ba38` · Y4 `fb329bf5a`

All gate-green, on `feat/orchestrator-mode` (NOT merged to main). Dev server restarted clean for re-test.
**Finding (separate, pre-existing — NOT Y-series):** running the FULL `test:browser` suite (never in the
standard gate) surfaced 2 consistently-failing browser tests UNRELATED to this work — confirmed by
stashing Y4 + re-running on the prior commit (still fail): `ChatView.browser.tsx` "toggles plan mode with
Shift+Tab only while the composer is focused" + `chat/MessagesTimeline.browser.tsx` "uses the file path
without line suffix for markdown file tag icons". Flag to user as a separate cleanup (chat-UI area, not
orchestrator). Remaining Phase-5 (not started): worker isolation/sandbox, scale/perf, board UX.

## ✅ X-SERIES COMPLETE (2026-06-29): PM-UX hardening done — X1 `598e8524a` · X2 `690687d41` · X3 `7f0915227` · X4 `82dad7941`

All four gate-green. Full pi-provider feature (PI1-PI6 + OAUTHUX) + the PM-UX fixes are in on
`feat/orchestrator-mode` (NOT merged to main). Dev server restarted clean (devserver3). **Next: user
re-tests the full flow** — PM acts on its project (no id-asking), human messages show, pi-only picker,
PM model inherits global. To drive a task to a worker stage, user still needs a **provider instance
(Codex/Claude) in Connections** (providerInstances was empty). Remaining Phase-5 (not started):
worker isolation/sandbox, scale/perf, board UX. Driver-PM is a deferred V2 ([[orchestrator-pm-harness-decision]]).

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
