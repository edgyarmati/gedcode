# Upstream Feature Cleanup — Design

Date: 2026-06-13
Status: Approved (design), pending implementation plan

## Goal

GedCode is a fork of `pingdotgg/t3code`. Its purpose is to run the custom
ged-mono workflow out of the box through the Codex and Claude harnesses. The
fork carries a number of subsystems inherited from upstream that this product
direction does not need. This cleanup removes those subsystems to lower
technical debt and shrink the maintenance/verification surface.

This is a **removal** effort. Renaming (`@t3tools/*` → `gedcode`) and other
rebranding is explicitly a **separate** task and out of scope here.

## Decisions

Each decision below was confirmed with the maintainer and validated against the
codebase via coupling analysis.

### Remove

1. **Marketing site** (`apps/marketing`, Astro). Verdict: clean. No code outside
   the app imports it; only infra references (root `package.json` scripts,
   `scripts/release-smoke.ts`).
2. **PostHog telemetry** (`apps/server/src/telemetry`). ping.gg anonymous
   analytics, hardcoded to their PostHog project. Verdict: clean. The layer is
   merged (`provideMerge`), not a required dependency, so removal leaves no
   dangling Effect requirements. 11 call sites across `serverRuntimeStartup.ts`
   and `provider/Layers/ProviderService.ts`; ~30 test fixtures use
   `AnalyticsService.layerTest` and become `Layer.empty`.
3. **Cursor agent provider** (keep Codex, Claude, OpenCode). Verdict: clean
   delete — the provider driver registry is an open-ended branded slug, not a
   closed union. ~13 Cursor-specific files plus ~15 single-line edits across
   contracts (`settings.ts`, `model.ts`) and web UI. **Keep** the Cursor _IDE
   editor_ entry in `packages/contracts/src/editor.ts` — that is "open in
   Cursor", not the agent provider.
4. **Bitbucket + Azure DevOps source-control providers** (keep GitHub + GitLab).
   Verdict: surgical. Delete 10 provider files; narrow the
   `SourceControlProviderKind` contract union to
   `["github", "gitlab", "unknown"]`; update shared detection/presentation and
   web switch statements (Icons, CommandPalette, GitActionsControl,
   SourceControlSettings, sourceControlPresentation, pullRequestReference) to
   stay exhaustive. This is the only cross-package breaking contract edit.
5. **OTLP trace export** (the "ship traces to a collector" telemetry). Remove the
   OTLP delegate, `Metrics`, `BrowserTraceCollector`, the
   `/api/observability/v1/traces` HTTP proxy, web `clientTracing.ts`, and the
   `observeRpc*` instrumentation wrappers across ~50 RPC methods in `ws.ts`.
   Verdict: surgical — mechanical wrapper removal, no business logic depends on
   it.

### Keep (explicitly)

- **Remote access**: pairing, remote environments, SSH (`packages/ssh`),
  Tailscale (`packages/tailscale`), `REMOTE.md`. Untouched.
- **Auto-update**: desktop update system, update pill, update-track settings.
- **GitHub + GitLab** source control.
- **OpenCode** provider.
- **Local process diagnostics**: `ProcessDiagnostics` and
  `ProcessResourceMonitor` (live process tree, resource history, killing stuck
  agent subprocesses) and their Diagnostics settings-tab sections. These are
  decoupled from OTLP and aid reliability.

### Open detail to resolve during implementation

- `TraceDiagnostics` reads local trace files produced by the tracer. If removing
  the OTLP/tracer surface leaves it dataless, it is removed as part of the
  tracing surface (it is not process monitoring). Confirm the tracer ↔
  TraceDiagnostics coupling by reading the actual files before deciding.

### Bonus fix

- The pre-existing `@t3tools/scripts` typecheck failure
  (`scripts/mock-update-server.ts` — missing
  `@effect/platform-node/NodeHttpServer`) is entangled with the auto-update
  system being kept, so it is fixed as part of this work.

## Sequencing

All work on branch `cleanup/drop-upstream-features` off `main`. Each step is one
commit; the full gate (`bun fmt`, `bun lint`, `bun typecheck`, `bun run test` —
never `bun test`) must pass before the next step.

- **Step 0** — Commit the existing verified working-tree work (composer/file-tag
  - timeline) so the cleanup diff is isolated; create the branch.
- **Step 1** — Marketing site.
- **Step 2** — Telemetry.
- **Step 3** — Cursor provider.
- **Step 4** — Bitbucket + Azure DevOps.
- **Step 5** — OTLP trace export (most invasive; RPC unwrap).
- **Step 6** — Fix `@t3tools/scripts` typecheck.
- **Step 7** — Docs: update `CHANGELOG.md` `## Unreleased`; record each removed
  subsystem in a "Removed forked-in features" section of
  `docs/upstream-decisions.md` so future upstream syncs do not re-pull them.

## Verification & risk

- Per-step gate as above. Steps are independently revertable (one commit each).
- Highest risk is Step 5 (the ~50-site RPC unwrap). Mitigation: purely
  mechanical; typecheck + RPC tests catch regressions. Fallback is leaving
  `observeRpc*` as no-op identity wrappers, but full removal is attempted first.
- The Step 4 contract-union narrowing is the only cross-package breaking change;
  strict-mode exhaustive-switch typecheck flags every web site needing an edit.
