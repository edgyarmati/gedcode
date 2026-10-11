# Progress

Ongoing log of project progress.

## 2026-10-11 — Ged layer re-landed on the V2 orchestrator base

Rebuilt `.ged/` and the Ged skills on a fresh T3 Code checkout (`9afde1c6d`, #17848) after v0's
fork point proved unmergeable. **Zero upstream files modified**, which is the constraint the
re-land exists to satisfy.

Built and working (plain files, no build step):

- `roles/` — planner, implementer, verifier briefs plus model policy
- `ged-lead` skill — delegation playbook, including the depth and fan-out caps the orchestrator
  does not impose itself
- `verdicts/` — branch-keyed records with SHA provenance
- `bin/land-gate.sh` — tested against all six failure modes plus the passing case

Rewrote the carried v0 memory and realigned six skills that still drove the dropped
`.ged/work/root/STATE.md` phase machine.

Toolchain bootstrapped: Node 24.13.1 via nvm, Vite+ `vp` 1.1.0 installed globally. Note the repo
pins `vite-plus@1.0.0` locally while the global CLI is 1.1.0.

**Next:** the memory MCP toolkit (`apps/server/src/mcp/toolkits/`) and the `ProjectMemory` service.
Both are TypeScript and were blocked on the install until now. v0's `ProjectContextRunChanges.ts`
is deliberately not being ported — it is being rebuilt as a toolkit, which drops its supervised-write
review gate unless that is deliberately rebuilt too.

## 2026-10-11 — Memory toolkit, and the land gate hardened

The two TypeScript components are built and tested.

- `apps/server/src/ged/ProjectMemory.ts` — a `t3/ged/ProjectMemory` service confined to
  `<root>/.ged`. Document keys are _validated_, not sanitized: anything with `..`, an absolute
  path, a backslash, a NUL, or an extension other than `.md`/`.json` is refused rather than
  quietly rewritten. 256KB per document.
- `apps/server/src/mcp/toolkits/memory/` — `ged_memory_list`, `ged_memory_read`, `ged_role_brief`,
  `ged_verdict_write`, `ged_land_check`. The memory root is `thread.worktreePath ?? workspaceRoot`,
  so a lead editing briefs on its branch reads its own version.
- `ged_land_check` **runs** `bin/land-gate.sh` rather than reimplementing its rules. The tool and
  the pre-push hook therefore cannot drift apart. A test pins the verdict-slug rule on both sides.

The gate itself was rewritten after review. The fail-open worth naming: a non-string `driverKind`
in the record passed the independence check. It now has to be a string, normalized, and one of the
eight real `ProviderDriverKind` values. Also fixed: option injection through the ref, refs that
resolve to non-commits, symlinked records, zero-width characters standing in for evidence, and a
dirty-tree check that masked every other failure because the record itself is untracked. Thirty-three
cases run in a scratch repo, all behaving as specified.

**Correction to the entry above:** the re-land is no longer zero-modified-upstream-files.
`apps/server/src/mcp/McpHttpServer.ts` gains ten lines, because the layer merge there is the only
assembly point for MCP toolkits. The exception is bounded and recorded in `DECISIONS.md`.

**Next:** exercise the MCP tools against a running server — they are unit-tested but have not been
called over the wire.

## 2026-10-11 — Generation naming settled, and a PR template that fits

This tree is GedCode **v1**; the fork it replaces is **v0**. The docs had been calling the old
fork v1, which left no name for this one and invited its 0.4.x tags to be read as this tree's
history. Renamed throughout `.ged/`, leaving upstream's uppercase `V1`/`V2` alone — those are the
sqlite projections and the orchestrator, and GedCode v1 runs _on_ upstream's V2 orchestrator.

Replaced `.github/pull_request_template.md`. Upstream's is addressed to outside contributors
asking for review capacity — link a triaged issue, show maintainer approval of scope — none of
which applies to a fork whose only contributor is its maintainer. Ours asks what broke, what fixed
it, what it cost upstream, what was verified, and who verified it independently of whom.

That made two modified upstream files; `STANDARDS.md` now carries the full list, so adding a
third has to be argued for in a PR rather than noticed later.

Package versions stay on upstream's 0.0.45 train. The generation is a project fact, not a manifest
field, and renumbering would only break upstream's release automation.

## 2026-10-11 — Cut what was empty, and committed to Sparkle

Removed eleven near-empty files and four README-only directories from `.ged/`, and six of the ten
skills. The deletions were not housekeeping: every agent that reads project memory pays for a
heading with nothing under it, and `ged-planning` / `ged-execution` / `ged-verification` were each
a second copy of a role brief with nothing keeping the two equal. The briefs are the better copy —
`ged_role_brief` serves them to Codex and OpenCode, while a skill only exists inside Claude Code.

`domain-modeling` and `grill-with-docs` were broken on arrival: they drove a root `CONTEXT.md` and
a `docs/adr/` tree that do not exist here, and `domain-modeling` instructed against the
`CONTEXT-MAP.md` this project uses. `grill-me` duplicated `grilling`. Four skills remain:
`ged-lead`, `verify`, `grilling`, `sync-upstream`.

Planned, with the Sparkle macOS updater kept as a first-class v0 capability rather than quietly
lost: `.ged/plans/sparkle-updates/`. Upstream's `electron-updater` cannot update an ad-hoc-signed
macOS app, so without Sparkle there is no auto-update without an Apple Developer Program
membership. The seam is cheap — `ElectronUpdater` is an Effect service chosen by one line in
`main.ts:140`, so Sparkle drops in as a second layer and upstream's 1042-line `DesktopUpdates.ts`
stays untouched — but the packaging and release-pipeline edits are not, and the plan says so
rather than discovering it mid-implementation.

**Next:** exercise the MCP tools against a running server, still. Then slice 1 of the Sparkle plan,
which is a key-custody decision and not code.

## 2026-10-11 — Mobile out of the workspace

`apps/mobile` is no longer a workspace project. Two lines in `pnpm-workspace.yaml` instead of 1,197
deletions and six upstream files; the reasoning and the revival path are in
[DECISIONS.md](./DECISIONS.md), along with why keeping the app for personal use was looked at
seriously and declined.

The unobvious part was `knip.jsonc`. Thirty-two exports in `client-runtime`, `contracts`, and
`shared` existed only for the Expo app, so taking it out of the graph failed `knip:check` — a CI
step. The audit is now scoped off those specific files, which means a new mobile-only export
upstream fails loudly rather than disappearing into a package-wide rule. Two exports in our own
`ProjectMemory.ts` were genuinely unused and are no longer exported.

Modified upstream files go from two to five; `pnpm-lock.yaml` is generated and self-heals on
conflict. The table in [STANDARDS.md](./STANDARDS.md) is the list a PR has to justify adding to.

**Next:** exercise the MCP tools against a running server, still. Then slice 1 of the Sparkle plan,
which is a key-custody decision and not code.
