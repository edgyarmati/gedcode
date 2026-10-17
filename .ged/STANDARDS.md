# Standards

Working standards for this repository. Supersedes the standards imported from the v0.4 GedCode
harness files — those described a Bun/Vitest workspace and modules that no longer exist on this
base. See [DECISIONS.md](./DECISIONS.md) for why the base changed.

Upstream ships its own `AGENTS.md` and `CLAUDE.md`. Where this file and upstream's overlap,
**upstream wins on toolchain and process**; this file adds only what is Ged-specific. The one
rule worth stating twice is upstream's, below.

## Toolchain

| Concern         | Tool                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Package manager | `pnpm@11.10.0` (`vp i`). **Never `bun install`.**                                              |
| Runner / tests  | Vite+ (`vp`), a **global** binary — not a devDependency                                        |
| Test framework  | `vp test run`. Vitest is dropped via override; `@effect/vitest` is patched to `vite-plus/test` |
| TypeScript      | `7.0.2` pinned, patched in place by `effect-tsgo@0.46.1`                                       |
| Node            | `^24.13.1`                                                                                     |

`vp` installs via `curl -fsSL https://vite.plus | bash` (docs: <https://viteplus.dev/guide/>).
CI uses `voidzero-dev/setup-vp@v1`.

The `prepare` script runs `effect-tsgo patch && vp config --no-agent` — the patch mutates the
installed TypeScript, so package versions alone do not prove it is active.

### Commands

```sh
vp fmt [--check]                      # format
vp lint --report-unused-disable-directives
vp run --filter <pkg> typecheck       # narrowest affected package only
vp test run <files>                   # focused tests
vp run knip:check                     # dead-code check
```

`patches/` and `pnpm-workspace.yaml` (~30 `patchedDependencies`, plus `overrides`,
`packageExtensions`, `allowBuilds`) are load-bearing. Do not regenerate them casually.

## Scope discipline (upstream rule — restated because it reverses v0.4 habits)

> **Do not run repo-wide checks.** No `vp check`, no `vp run -r test`, no `vp run -r typecheck`
> unless the maintainer asks. CI owns the full suite.

This is the same _policy_ v0.4 had — focused tests, narrowest package typecheck — with different
commands. The v0.4 instinct to reach for a full gate before declaring done is now explicitly wrong.

If an unrelated pre-existing failure blocks the narrow check, document it and stop; do not expand
scope without approval.

## Additive-only constraint

> Never modify an upstream file where a new file would do.

Unmergeability is what killed v0.4: 450 of 451 files it had modified were also touched upstream,
leaving no clean-merge surface against roughly 800 upstream commits a month. Ged functionality
lands as new files, new packages, and new MCP toolkits. When an upstream file genuinely must
change, keep the diff minimal and record it in [DECISIONS.md](./DECISIONS.md).

The whole modified surface, which a PR must justify adding to:

| File                                                  | Lines   | Why                                                              |
| ----------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `apps/server/src/mcp/McpHttpServer.ts`                | 10      | The only assembly point for MCP toolkits                         |
| `.github/pull_request_template.md`                    | +16/−24 | Upstream's is written for outside contributors                   |
| `pnpm-workspace.yaml`                                 | 10      | Drops `apps/mobile`; `allowBuilds` for the Sparkle package       |
| `knip.jsonc`                                          | 36      | Scopes the export audit off mobile-only upstream exports         |
| `pnpm-lock.yaml`                                      | gen     | Generated; regenerate on conflict, never merge by hand           |
| `README.md`                                           | all     | Upstream's is T3 Code branding and T3 Code installers            |
| `CONTRIBUTING.md`                                     | +14/−4  | Fork preamble; upstream repo links; triage is manual here        |
| `LICENSE`                                             | 1       | Adds our copyright line; upstream's is retained                  |
| `AGENTS.md`                                           | 13      | Appended overlay pointing at `.ged/`; overrides nothing          |
| `apps/desktop/src/main.ts`                            | 4       | Sparkle updater layer on macOS; the 0.4 upgrade notice           |
| `apps/server/src/persistence/initializeV2Database.ts` | 3       | Rewrites a 0.4 snapshot before the V2 import (`gedV04Import.ts`) |
| `apps/desktop/src/updates/updatesTestHarness.ts`      | +20/−9  | Lets tests inject the Sparkle updater layer                      |
| `apps/desktop/package.json`                           | 1       | `electron-sparkle-updater` dependency                            |
| `scripts/package.json`                                | 1       | Same dependency, for the after-pack hook                         |
| `scripts/lib/desktop-external-packages.ts`            | 1       | Ships the Sparkle package in the staged app                      |
| `scripts/build-desktop-artifact.ts`                   | 17      | Applies Sparkle config, stages the framework (additions)         |
| `packages/shared/package.json`                        | 4       | `./sparkleUpdate` subpath export                                 |

The rebrand (see [DECISIONS.md](./DECISIONS.md), "GedCode's identity is set in source") adds
one-to-few-line edits wherever upstream hard-codes its product identity. Each is a string or
constant swap; none changes behavior beyond the name, origin, or path it carries:

| Area             | Files                                                                                                                                                                                                                                                                             | Why                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Desktop identity | `apps/desktop/src/app/{DesktopEnvironment,DesktopAppIdentity,DesktopEarlyElectronStartup,DesktopUserData,DesktopLegacyLocalStorage,DesktopStatePaths}.ts`, `apps/desktop/src/{compileCache.ts,electron/ElectronProtocol.ts}`                                                      | App name, bundle id, URL scheme, userData and home directories            |
| Server identity  | `apps/server/src/{os-jank.ts,http.ts,cli/browser.ts,cli/triagePrompt.ts,cloud/bootService.ts,project/AgentSessionScanner.ts,project/ManagedProjectFolders.ts,provider/ModelManifest.ts,telemetry/AnalyticsService.ts}`, `apps/server/scripts/{migrate-dev-db,t3-sqlite-state}.ts` | Home dir, origins, repo links; T3's analytics key removed (telemetry off) |
| Shared identity  | `packages/shared/src/{cliRelease,codexAuthHandoff,providerAuthReturnUrl}.ts`, `packages/contracts/src/t3ProjectFile.ts`, `packages/source-control-github/src/server/githubStackRebase.ts`                                                                                         | Release repo, app scheme, schema text, rebase committer                   |
| Web identity     | `apps/web/index.html`, `apps/web/src/{branding.ts,legalLinks.ts,components/T3Wordmark.tsx,components/NightlyMobileBeta.tsx,components/desktopUpdate.logic.ts,components/settings/pairingUrls.ts,components/sidebar/SidebarChrome.tsx}`                                            | Name, mark, links; no T3 hosted app or mobile beta                        |
| Build            | `scripts/build-desktop-artifact.ts` (+14), `scripts/dev-runner.ts`, `.env.example`                                                                                                                                                                                                | Product name rewritten at stage time; no T3 cloud identifiers             |
| Art              | `assets/{prod,nightly,dev}/**`, `apps/web/public/*` icons, `apps/desktop/resources/dmg/*.svg`                                                                                                                                                                                     | GedCode icons and DMG text, replaced wholesale                            |
| CLI and names    | `apps/server/src/{binCli.ts,cli/invocation.ts,git/GitManager.ts}`, `apps/desktop/src/app/{DesktopCliShim,DesktopCliCommand}.ts`, `packages/shared/src/git.ts`, `packages/contracts/src/settings.ts`, `packages/source-control-bitbucket/src/server/BitbucketApi.ts`               | `gedcode` command and launcher, `gedcode.json`, `gedcode/` branch prefix  |
| Tests and triage | Tests that assert the identity, wherever they live (`git diff --name-only upstream/main...HEAD -- '*.test.ts' '*.test.tsx'`), `.github/triage/PLAYBOOK.md`                                                                                                                        | Restate upstream's assertions for the new identity                        |

The same rule shapes CI. Upstream's workflows are **not** edited: the ones that cannot run here —
Blacksmith runners, T3's Cloudflare and hosting credentials, the dropped mobile app, T3's
contribution process — are disabled in repository settings, and our gate is a new file,
`.github/workflows/ged-ci.yml`. Keep it that way; a `runs-on:` edit is 37 conflicts a sync. Upstream's
release workflows (`Release`, `Release desktop build`, `Publish AUR package`) are disabled for the
same reason: they publish the npm `t3` and `@t3code/*` packages, which are not ours to publish. Our
release path is `.github/workflows/ged-release.yml`: the macOS arm64 build on GitHub Releases, with
a signed Sparkle feed — see [docs/ged/sparkle-updates.md](../docs/ged/sparkle-updates.md).

## Code conventions

- **Effect** is used pervasively — follow its patterns for errors, Layers, and runtimes.
- **TypeScript strict**, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Immutability preferred** — return new objects rather than mutating.
- **No duplicate logic.** Extract shared code rather than adding a local copy. Duplication across
  files is a code smell, not a shortcut.
- Contracts packages stay **schema-only** — no runtime logic.

## Priorities

1. Performance.
2. Reliability.
3. Predictable behavior under load and during failure — session restarts, reconnects, partial
   streams.

Where these trade against convenience, choose correctness and robustness.

## Standing rules

- **No unapproved fallbacks.** If a requested approach is blocked, ask. Do not implement a
  degraded or alternate path on your own initiative. This also governs model selection — see the
  `model_unavailable` rule in [ORCHESTRATION.md](./ORCHESTRATION.md#6-model-policy).
- **Changelog.** This repository has no root `CHANGELOG.md` — that file belongs to upstream, and
  adding one is a merge conflict waiting to happen. Record Ged-visible changes in
  [PROGRESS.md](./PROGRESS.md) instead, as part of the task.
- **Secrets.** `T3CODE_DEV_AUTH_TOKEN` is a secret: generate with `openssl rand -hex 32`, keep it
  in a gitignored `.env`, never commit it. `.env.example` holds public identifiers only. Never set
  `VITE_HTTP_URL` / `VITE_WS_URL` in dev.
- **`.repos/`** is a large vendored read-only reference tree. Do not lint, test, or import from it.
