# Upstream Feature Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove five forked-in upstream subsystems GedCode does not need (marketing site, PostHog telemetry, Cursor provider, Bitbucket+Azure DevOps source control, OTLP trace export) to lower technical debt, plus fix the entangled `@t3tools/scripts` typecheck failure.

**Architecture:** Each subsystem is removed as one self-contained commit on branch `cleanup/drop-upstream-features`. Removals are ordered lowest-risk first. The provider and source-control layers use pluggable registries, so dropping a provider/host is unregister + delete + prune references. Telemetry and OTLP are Effect layers merged into the runtime; removal must also delete the accessor call sites or the Effect context will fail at runtime.

**Tech Stack:** Bun workspace monorepo, Effect 4.0 beta, React 19 / Vite, TypeScript strict (tsgo), oxlint, oxfmt, Vitest. Verification gate: `bun fmt && bun lint && bun typecheck && bun run test` (NEVER `bun test`).

**Per-step rule:** A step is not done until the full gate is green. Commit only when green.

---

## Task 0: Clean baseline + branch

**Files:** none (git only)

- [ ] **Step 1: Confirm working tree is the expected verified WIP**

Run: `git status --short`
Expected: the composer/file-tag + timeline changes from the prior session (apps/web/src/components/chat/_, composer-logic_, etc.) plus `.ged/work/root/*`. No surprises.

- [ ] **Step 2: Verify the WIP is green before committing it**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: web/server/contracts green. (`@t3tools/scripts` typecheck failure is known and fixed in Task 6 — note it but do not block.)

- [ ] **Step 3: Commit the baseline WIP**

```bash
git add -A
git commit -m "feat: composer file tags and timeline polish"
```

- [ ] **Step 4: Create the cleanup branch**

```bash
git switch -c cleanup/drop-upstream-features
```

---

## Task 1: Remove marketing site

**Files:**

- Delete: `apps/marketing/` (entire directory)
- Modify: `package.json` (remove `dev:marketing`, `start:marketing`, `build:marketing` scripts)
- Modify: `scripts/release-smoke.ts` (remove `"apps/marketing/package.json"` from `workspaceFiles`)

- [ ] **Step 1: Delete the app**

```bash
git rm -r apps/marketing
```

- [ ] **Step 2: Remove the three marketing scripts from `package.json`**

Remove these lines from the `scripts` block:

```
"dev:marketing": "turbo run dev --filter=@t3tools/marketing",
"start:marketing": "turbo run preview --filter=@t3tools/marketing",
"build:marketing": "turbo run build --filter=@t3tools/marketing",
```

- [ ] **Step 3: Remove the marketing reference in `scripts/release-smoke.ts`**

Remove the `"apps/marketing/package.json",` entry from the `workspaceFiles` array.

- [ ] **Step 4: Grep for stragglers**

Run: `rg -n "marketing|@t3tools/marketing" --glob '!docs/**' --glob '!.ged/**' --glob '!CHANGELOG.md'`
Expected: no references in source/config (turbo.json had none; confirm). Fix any found.

- [ ] **Step 5: Gate + commit**

Run: `bun install` (workspace member removed) then `bun fmt && bun lint && bun typecheck && bun run test`
Expected: green.

```bash
git add -A
git commit -m "chore: remove marketing site"
```

---

## Task 2: Remove PostHog telemetry

**Files:**

- Delete: `apps/server/src/telemetry/` (entire directory: `Services/AnalyticsService.ts`, `Layers/AnalyticsService.ts`, `Layers/AnalyticsService.test.ts`, `Identify.ts`)
- Modify: `apps/server/src/server.ts` (remove `AnalyticsServiceLayerLive` import + `provideMerge`)
- Modify: `apps/server/src/serverRuntimeStartup.ts` (remove `AnalyticsService` import, `recordStartupHeartbeat`, `launchStartupHeartbeat` + its call)
- Modify: `apps/server/src/provider/Layers/ProviderService.ts` (remove `AnalyticsService` import, accessor, 11 `analytics.record`/`analytics.flush` call sites)
- Modify: `apps/server/src/config.ts` (remove `anonymousIdPath` field + its mkdir)
- Modify test fixtures using `AnalyticsService.layerTest`: `serverRuntimeStartup.test.ts`, `provider/Layers/ProviderService.test.ts`, `integration/providerService.integration.test.ts`, `integration/OrchestrationEngineHarness.integration.ts`

- [ ] **Step 1: Find every telemetry reference (authoritative list)**

Run: `rg -n "AnalyticsService|telemetry/|recordStartupHeartbeat|launchStartupHeartbeat|anonymousIdPath|analytics\.(record|flush)" apps/server`
This is the worklist. Every hit must be removed or (in tests) replaced.

- [ ] **Step 2: Delete the telemetry directory**

```bash
git rm -r apps/server/src/telemetry
```

- [ ] **Step 3: Remove the layer from `server.ts`**

Remove the `AnalyticsServiceLayerLive` import line and the `Layer.provideMerge(AnalyticsServiceLayerLive),` line in the `RuntimeDependenciesLive` composition.

- [ ] **Step 4: Remove the heartbeat from `serverRuntimeStartup.ts`**

Remove the `AnalyticsService` import, the `recordStartupHeartbeat` function, the `launchStartupHeartbeat` function, and the call that forks `launchStartupHeartbeat`. If the startup effect referenced its result, delete that line too.

- [ ] **Step 5: Remove call sites from `ProviderService.ts`**

Remove the `AnalyticsService` import, the `const analytics = yield* Effect.service(AnalyticsService)` accessor, and all 11 `analytics.record(...)`/`analytics.flush` statements. Where a `record` was the only statement in a `tap`/finalizer closure, remove the now-empty closure cleanly (don't leave `Effect.tap(() => Effect.void)` unless needed for structure).

- [ ] **Step 6: Remove `anonymousIdPath` from `config.ts`**

Remove the `anonymousIdPath` field from `ServerConfig` and the directory-creation line that referenced it.

- [ ] **Step 7: Replace telemetry stubs in test fixtures**

In each test file from Step 1's worklist, remove `AnalyticsService.layerTest` from the provided layers. If it was merged into a layer tuple, drop it (the remaining layers stand alone). Do not replace with `Layer.empty` unless a tuple becomes empty.

- [ ] **Step 8: Gate + commit**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: green. The Effect typecheck is the key signal — if `AnalyticsService` is still required anywhere, it fails here.

```bash
git add -A
git commit -m "chore: remove posthog telemetry"
```

---

## Task 3: Remove Cursor agent provider

**Keep:** the Cursor _IDE editor_ entry in `packages/contracts/src/editor.ts` (`{ id: "cursor", label: "Cursor", commands: ["cursor"], launchStyle: "goto" }`). That is "open in Cursor", not the agent provider.

**Files — delete (Cursor-specific):**

- `apps/server/src/provider/Drivers/CursorDriver.ts`
- `apps/server/src/provider/Layers/CursorAdapter.ts` + `.test.ts`
- `apps/server/src/provider/Layers/CursorProvider.ts` + `.test.ts`
- `apps/server/src/provider/Services/CursorAdapter.ts`
- `apps/server/src/provider/acp/CursorAcpExtension.ts` + `.test.ts`
- `apps/server/src/provider/acp/CursorAcpSupport.ts` + `.test.ts`
- `apps/server/src/provider/acp/CursorAcpCliProbe.test.ts`
- `apps/server/src/textGeneration/CursorTextGeneration.ts` + `.test.ts`
- `apps/server/scripts/cursor-acp-model-mismatch-probe.ts`

**Files — modify (shared):**

- `apps/server/src/provider/builtInDrivers.ts` (drop import, union member, array entry)
- `packages/contracts/src/settings.ts` (drop `CursorSettings`, its provider-map + patch entries)
- `packages/contracts/src/model.ts` (drop `CURSOR_DRIVER_KIND` + its 4 map entries)
- `packages/contracts/src/provider.test.ts` (drop "accepts cursor provider" case)
- `apps/server/src/provider/Layers/ProviderAdapterRegistry.test.ts` (drop `fakeCursorAdapter`, `CURSOR_DRIVER`)
- `apps/web/src/components/Icons.tsx` (delete `CursorIcon`)
- `apps/web/src/components/settings/providerDriverMeta.ts` (drop Cursor def + import)
- `apps/web/src/components/settings/ProviderModelsSection.tsx` (drop placeholder entry)
- `apps/web/src/components/settings/SettingsPanels.tsx` (simplify the cursor visibility filter)
- `apps/web/src/components/chat/providerIconUtils.ts` (drop import + map entry)
- `apps/web/src/components/chat/OpenInPicker.tsx` (drop CursorIcon import/usage **only if** it's the provider icon, not the IDE "open in" — verify)
- `apps/web/src/session-logic.ts` (drop Cursor `PROVIDER_OPTIONS` entry)
- web tests: `session-logic.test.ts`, `composerDraftStore.test.ts`

- [ ] **Step 1: Build the authoritative worklist**

Run: `rg -ni "cursor" apps/server/src packages/contracts/src apps/web/src --glob '!**/*.snap'`
Distinguish: agent-provider Cursor (remove) vs. Cursor IDE editor / text-cursor/caret UI (keep). Mark each hit.

- [ ] **Step 2: Delete Cursor-specific server files**

```bash
git rm apps/server/src/provider/Drivers/CursorDriver.ts \
  apps/server/src/provider/Layers/CursorAdapter.ts apps/server/src/provider/Layers/CursorAdapter.test.ts \
  apps/server/src/provider/Layers/CursorProvider.ts apps/server/src/provider/Layers/CursorProvider.test.ts \
  apps/server/src/provider/Services/CursorAdapter.ts \
  apps/server/src/provider/acp/CursorAcpExtension.ts apps/server/src/provider/acp/CursorAcpExtension.test.ts \
  apps/server/src/provider/acp/CursorAcpSupport.ts apps/server/src/provider/acp/CursorAcpSupport.test.ts \
  apps/server/src/provider/acp/CursorAcpCliProbe.test.ts \
  apps/server/src/textGeneration/CursorTextGeneration.ts apps/server/src/textGeneration/CursorTextGeneration.test.ts \
  apps/server/scripts/cursor-acp-model-mismatch-probe.ts
```

(Adjust paths if Step 1 shows different/additional files.)

- [ ] **Step 3: Unregister from the driver registry**

In `apps/server/src/provider/builtInDrivers.ts`: remove the `CursorDriver` import, the `CursorDriverEnv` union member from `BuiltInDriversEnv`, and `CursorDriver` from the `BUILT_IN_DRIVERS` array.

- [ ] **Step 4: Prune contracts**

`settings.ts`: delete `CursorSettings` schema + type, its entry in the provider settings map, `CursorSettingsPatch`, and its entry in the patch schema.
`model.ts`: delete `CURSOR_DRIVER_KIND` and its entries in `DEFAULT_MODEL_BY_PROVIDER`, `DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER`, `MODEL_SLUG_ALIASES_BY_PROVIDER`, `PROVIDER_DISPLAY_NAMES`.
`provider.test.ts`: delete the "accepts cursor provider" test case.

- [ ] **Step 5: Prune web UI**

Apply the edits listed under Files — modify (web). For `OpenInPicker.tsx`, verify whether the CursorIcon there is the agent provider or the IDE "open in" target — keep the IDE one.

- [ ] **Step 6: Update server + web tests**

Remove `fakeCursorAdapter`/`CURSOR_DRIVER` from `ProviderAdapterRegistry.test.ts`; remove Cursor entries from `session-logic.test.ts` and `composerDraftStore.test.ts`.

- [ ] **Step 7: Gate + commit**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: green.

```bash
git add -A
git commit -m "chore: remove cursor provider"
```

---

## Task 4: Remove Bitbucket + Azure DevOps source control

**Files — delete:**

- `apps/server/src/sourceControl/BitbucketApi.ts` + `.test.ts`
- `apps/server/src/sourceControl/BitbucketSourceControlProvider.ts` + `.test.ts`
- `apps/server/src/sourceControl/bitbucketPullRequests.ts`
- `apps/server/src/sourceControl/AzureDevOpsCli.ts` + `.test.ts`
- `apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts` + `.test.ts`
- `apps/server/src/sourceControl/azureDevOpsPullRequests.ts`

**Files — modify:**

- `apps/server/src/sourceControl/SourceControlProviderRegistry.ts` (drop both `.make()` + registration entries)
- `apps/server/src/server.ts`, `apps/server/src/ws.ts` (drop the provider layer imports/merges)
- `packages/contracts/src/sourceControl.ts` (`SourceControlProviderKind` → `["github","gitlab","unknown"]`)
- `packages/shared/src/sourceControl.ts` (drop presentations, host detectors, detection branches)
- `packages/shared/src/sourceControl.test.ts` (drop bitbucket/azure cases)
- `apps/web/src/components/settings/SourceControlSettings.tsx` (icon map)
- `apps/web/src/components/CommandPalette.tsx` (union, source arrays, switch cases)
- `apps/web/src/components/GitActionsControl.tsx` (publish union + options)
- `apps/web/src/components/ChatView.browser.tsx` (mock data)
- `apps/web/src/sourceControlPresentation.ts` (switch + icon imports)
- `apps/web/src/pullRequestReference.ts` (azure URL pattern + parser)
- `apps/web/src/components/Icons.tsx` (delete `AzureDevOpsIcon`, `BitbucketIcon`)
- `apps/server/src/sourceControl/SourceControlProviderRegistry.test.ts`, `SourceControlDiscovery.test.ts` (mock refs)

- [ ] **Step 1: Build the authoritative worklist**

Run: `rg -ni "bitbucket|azure[- ]?devops|azureDevOps" apps packages --glob '!**/*.snap'`
Every hit gets removed/updated. Note that `SourceControlProviderKind` is a contract union consumed by web, so strict-mode exhaustive switches will flag remaining sites at typecheck.

- [ ] **Step 2: Delete provider files**

```bash
git rm apps/server/src/sourceControl/BitbucketApi.ts apps/server/src/sourceControl/BitbucketApi.test.ts \
  apps/server/src/sourceControl/BitbucketSourceControlProvider.ts apps/server/src/sourceControl/BitbucketSourceControlProvider.test.ts \
  apps/server/src/sourceControl/bitbucketPullRequests.ts \
  apps/server/src/sourceControl/AzureDevOpsCli.ts apps/server/src/sourceControl/AzureDevOpsCli.test.ts \
  apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.ts apps/server/src/sourceControl/AzureDevOpsSourceControlProvider.test.ts \
  apps/server/src/sourceControl/azureDevOpsPullRequests.ts
```

- [ ] **Step 3: Unregister + drop server layer wiring**

`SourceControlProviderRegistry.ts`: remove the bitbucket/azure `.make()`/`makeDiscovery()` calls and their `makeWithProviders` entries.
`server.ts` / `ws.ts`: remove the corresponding layer imports + merges.

- [ ] **Step 4: Narrow the contract union**

`packages/contracts/src/sourceControl.ts`: `SourceControlProviderKind = Schema.Literals(["github", "gitlab", "unknown"])`.

- [ ] **Step 5: Prune shared detection/presentation**

`packages/shared/src/sourceControl.ts`: delete the bitbucket + azure presentation constants, `isBitbucketHost`/`isAzureDevOpsHost`, and their branches in `detectSourceControlProviderFromRemoteUrl` and `resolveChangeRequestPresentation`. Update `sourceControl.test.ts` to drop those cases.

- [ ] **Step 6: Prune web UI (typecheck-driven)**

Apply edits to SourceControlSettings, CommandPalette, GitActionsControl, ChatView.browser, sourceControlPresentation, pullRequestReference, and delete `AzureDevOpsIcon`/`BitbucketIcon` from Icons.tsx. Let `bun typecheck` enumerate any missed exhaustive switch — fix until clean.

- [ ] **Step 7: Gate + commit**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: green.

```bash
git add -A
git commit -m "chore: remove bitbucket and azure devops source control"
```

---

## Task 5: Remove OTLP trace export

**Resolve first:** Read `apps/server/src/observability/Layers/Observability.ts` and `apps/server/src/diagnostics/TraceDiagnostics.ts`. Determine whether `TraceDiagnostics` (and its Diagnostics-tab sections) has any data source once the tracer/RPC instrumentation is gone. If not, remove `TraceDiagnostics` + its tab sections as part of this task; keep `ProcessDiagnostics` + `ProcessResourceMonitor` + their tab sections regardless.

**Files — delete (confirm against the resolve step):**

- `apps/server/src/observability/` (Layers/Observability.ts, RpcInstrumentation.ts, Metrics.ts, Attributes.ts, Services/BrowserTraceCollector.ts)
- `apps/web/src/observability/clientTracing.ts`
- (conditional) `apps/server/src/diagnostics/TraceDiagnostics.ts` + its test, `apps/web/src/lib/traceDiagnosticsState.ts`

**Files — modify:**

- `apps/server/src/ws.ts` (unwrap `observeRpcEffect`/`observeRpcStream`/`observeRpcStreamEffect` across ~50 methods; drop imports)
- `apps/server/src/http.ts` (remove `POST /api/observability/v1/traces` route + `BrowserTraceCollector` dep)
- `apps/server/src/server.ts` (remove `ObservabilityLive` provide)
- `apps/server/src/config.ts` (remove `otlpTracesUrl`/`otlpMetricsUrl`/observability config fields)
- `apps/web/src/components/settings/DiagnosticsSettings.tsx` (drop trace/span sections + `useServerObservability` trace bits; keep process/resource sections)
- `apps/web/src/components/settings/SettingsPanels.tsx` (drop `useServerObservability` logs-dir usage if tied only to tracing)
- `apps/web/src/rpc/serverState.ts` (drop `useServerObservability` if now unused)

- [ ] **Step 1: Build the authoritative worklist**

Run: `rg -n "observeRpc|Observability|BrowserTraceCollector|clientTracing|otlp|Otlp|OTLP|traceDiagnostics|TraceDiagnostics|useServerObservability" apps packages`
Mark each: OTLP/tracing (remove) vs. ProcessDiagnostics/ResourceMonitor (keep).

- [ ] **Step 2: Resolve the TraceDiagnostics question** (see "Resolve first" above). Decide keep/remove for `TraceDiagnostics` and record the decision in the commit message.

- [ ] **Step 3: Unwrap RPC instrumentation in `ws.ts`**

For each handler, replace `observeRpcEffect("name", <effect>)` / `observeRpcStream(...)` / `observeRpcStreamEffect(...)` with the inner effect/stream directly. Remove the three imports. This is mechanical — work top to bottom; typecheck confirms none missed.

- [ ] **Step 4: Remove the HTTP traces proxy**

In `http.ts`, delete the `/api/observability/v1/traces` route and the `BrowserTraceCollector` usage/import.

- [ ] **Step 5: Drop the layer + config**

`server.ts`: remove the `ObservabilityLive` provide/import. `config.ts`: remove the OTLP/observability config fields. Keep `ProcessDiagnostics.layer` / `ProcessResourceMonitor.layer` merges.

- [ ] **Step 6: Delete observability source + web client tracing**

```bash
git rm -r apps/server/src/observability apps/web/src/observability/clientTracing.ts
```

(Plus `TraceDiagnostics.ts`/`traceDiagnosticsState.ts` if Step 2 said remove.)

- [ ] **Step 7: Prune the Diagnostics settings tab**

In `DiagnosticsSettings.tsx`, remove the Trace Diagnostics / Latest Failures / Common Failures / Slowest Spans / Span Logs / Top Span Names sections. Keep Live Processes + Resource History. Remove now-unused hooks/imports.

- [ ] **Step 8: Gate + commit**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: green.

```bash
git add -A
git commit -m "chore: remove otlp trace export"
```

---

## Task 6: Fix `@t3tools/scripts` typecheck

**Files:**

- `scripts/mock-update-server.ts`, `scripts/mock-update-server.test.ts` (the `@effect/platform-node/NodeHttpServer` import)
- possibly `scripts/package.json` / catalog (ensure `@effect/platform-node` is a dependency)

- [ ] **Step 1: Reproduce**

Run: `bun typecheck` (or `turbo run typecheck --filter=@t3tools/scripts`)
Expected: failure citing missing `@effect/platform-node/NodeHttpServer`.

- [ ] **Step 2: Identify the correct import path for beta.73**

Run: `rg -n "NodeHttpServer|@effect/platform-node" apps/server packages` to see how the rest of the repo imports node platform modules in beta.73. Match that pattern (the module path or export changed in the Effect bump).

- [ ] **Step 3: Fix the import in the scripts files**

Update `mock-update-server.ts` (+ test) to the working import path/symbol. If `@effect/platform-node` is missing from `scripts/package.json`, add it from the catalog (`"@effect/platform-node": "catalog:"`) and `bun install`.

- [ ] **Step 4: Gate + commit**

Run: `bun fmt && bun lint && bun typecheck && bun run test`
Expected: green across ALL workspaces including `@t3tools/scripts`.

```bash
git add -A
git commit -m "fix: repair scripts typecheck for mock update server"
```

---

## Task 7: Documentation

**Files:**

- `CHANGELOG.md` (`## Unreleased`)
- `docs/upstream-decisions.md` (new "Removed forked-in features" section)

- [ ] **Step 1: Update CHANGELOG `## Unreleased`**

Add entries:

```
- Removed the marketing site (apps/marketing).
- Removed PostHog telemetry.
- Removed the Cursor agent provider (Codex, Claude, OpenCode remain).
- Removed Bitbucket and Azure DevOps source control (GitHub and GitLab remain).
- Removed OTLP trace export; local process/resource diagnostics are retained.
```

- [ ] **Step 2: Record removals in `docs/upstream-decisions.md`**

Add a "Removed forked-in features" section listing each removed subsystem with date 2026-06-13 and a one-line rationale, so future upstream syncs do not re-pull them. Note Cursor dynamic model probing and the multi-provider SCM edge-case fixes (previously logged as completed) are superseded by removal.

- [ ] **Step 3: Commit**

Run: `bun fmt` (markdown) — lint/typecheck/test not strictly needed for docs but run the full gate once for safety.

```bash
git add -A
git commit -m "docs: record upstream feature removals"
```

---

## Final verification

- [ ] Run the original dev-build smoke that motivated the prior session, to confirm nothing core broke:
      `bun run dist:desktop:artifact -- --platform mac --target dmg --arch arm64 --build-version 0.1.3-dev.1`
      Expected: produces the DMG.
- [ ] `git log --oneline main..HEAD` shows one clean commit per task.
- [ ] Summarize the diff size reduction (files/LOC removed) for the maintainer.
