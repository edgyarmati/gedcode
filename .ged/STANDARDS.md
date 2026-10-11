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

| File                                   | Lines | Why                                                      |
| -------------------------------------- | ----- | -------------------------------------------------------- |
| `apps/server/src/mcp/McpHttpServer.ts` | 10    | The only assembly point for MCP toolkits                 |
| `.github/pull_request_template.md`     | 31    | Upstream's is written for outside contributors           |
| `pnpm-workspace.yaml`                  | 8     | Drops `apps/mobile` from the workspace                   |
| `knip.jsonc`                           | 36    | Scopes the export audit off mobile-only upstream exports |
| `pnpm-lock.yaml`                       | gen   | Generated; regenerate on conflict, never merge by hand   |

The same rule shapes CI. Upstream's workflows are **not** edited: the ones that cannot run here —
Blacksmith runners, T3's Cloudflare and hosting credentials, the dropped mobile app, T3's
contribution process — are disabled in repository settings, and our gate is a new file,
`.github/workflows/ged-ci.yml`. Keep it that way; a `runs-on:` edit is 37 conflicts a sync.

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
