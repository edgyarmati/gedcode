# Progress

Ongoing log of project progress.

## 2026-10-11 — Ged layer re-landed on the V2 orchestrator base

Rebuilt `.ged/` and the Ged skills on a fresh T3 Code checkout (`9afde1c6d`, #17848) after v0.4's
fork point proved unmergeable. **Zero upstream files modified**, which is the constraint the
re-land exists to satisfy.

Built and working (plain files, no build step):

- `roles/` — planner, implementer, verifier briefs plus model policy
- `ged-lead` skill — delegation playbook, including the depth and fan-out caps the orchestrator
  does not impose itself
- `verdicts/` — branch-keyed records with SHA provenance
- `bin/land-gate.sh` — tested against all six failure modes plus the passing case

Rewrote the carried v0.4 memory and realigned six skills that still drove the dropped
`.ged/work/root/STATE.md` phase machine.

Toolchain bootstrapped: Node 24.13.1 via nvm, Vite+ `vp` 1.1.0 installed globally. Note the repo
pins `vite-plus@1.0.0` locally while the global CLI is 1.1.0.

**Next:** the memory MCP toolkit (`apps/server/src/mcp/toolkits/`) and the `ProjectMemory` service.
Both are TypeScript and were blocked on the install until now. v0.4's `ProjectContextRunChanges.ts`
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

This tree is GedCode **v0.5**; the fork it replaces is **v0.4**. The docs had been naming the old
fork as if it were the current one, which left no name for this tree and invited its 0.4.x tags to
be read as this tree's history. Renamed throughout `.ged/`, leaving upstream's uppercase `V1`/`V2`
alone — those are the sqlite projections and the orchestrator.

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

Planned, with the Sparkle macOS updater kept as a first-class v0.4 capability rather than quietly
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

**No GitHub Actions run had ever happened on `next`** — diagnosed, then fixed, see the next entry.
PR #92 targeted v0.4's `main`, the two branches diverged at `e3accd6e9`, and v0.4 modified 451 files
upstream also changed, so the PR was `CONFLICTING`, `refs/pull/92/merge` did not exist, and Actions
never creates a check suite for a `pull_request` it cannot merge. Only third-party apps, which work
off `refs/pull/92/head`, reported. The `push` trigger would not have covered it either; it is
filtered to `main`.

**Next:** exercise the MCP tools against a running server, still. Then slice 1 of the Sparkle plan,
which is a key-custody decision and not code.

## 2026-10-11 — v0.5, not v1

Checked the live Sparkle feed before answering "what version is this tree?" and the answer changed.
`sparkle-feed` on `edgyarmati/gedcode` is a real prerelease advertising `0.4.8` to real installs,
and `SPARKLE_ED_PRIVATE_KEY` is still on the repo. Sparkle offers an update only when the advertised
version is higher, so staying on upstream's `0.0.45` would have left every existing user silently
stranded — the exact failure Sparkle was kept for.

So this tree is **v0.5** and the old fork is **v0.4**: one product on one version line, renamed
throughout `.ged/`. The "generation boundary deserves a 1.0" reasoning was about the code; the
version number is not about the code.

No manifest moves. `apps/{web,desktop,server}` and `packages/contracts` stay on upstream's 0.0.45,
because the shipped version is a build input — `--build-version` / `T3CODE_DESKTOP_VERSION`,
resolved at `scripts/build-desktop-artifact.ts:1750` — so the 0.5.x train costs zero upstream file
edits. That also settles slice 1 of the Sparkle plan: reuse the existing key pair and `sparkle-feed`
release, because the whole point is to reach the installs already trusting that key.

## 2026-10-11 — This tree is `main` now, and v0.4's history is still under it

`main` was fast-forwarded onto this tree. No force-push, nothing rewritten: a `git merge -s ours`
of `origin/main` into `next` records v0.4's tip as the second parent while taking this tree's
content wholesale, which makes `next` a strict descendant of `main` and the push an ordinary
fast-forward. Anyone with a clone pulls cleanly. `v0.4-final` tags `c3a9813f39`, and v0.4's release
tags are untouched.

PR #92 closed as merged the moment its commits reached `main`, and runs were created on the same
push. The diagnosis in the previous entry held exactly: the conflict was the whole cause. Those runs
never actually started, for a second reason found afterwards — see the entry below.

The branch `next` still exists and is identical to `main`; it has no further purpose. Work continues
on `main`, which is what [sync-upstream](../.agents/skills/sync-upstream/SKILL.md) already assumed.

## 2026-10-11 — The MCP registration layer is covered, and CI actually runs

`apps/server/src/mcp/toolkits/memory/registration.test.ts` drives the five `ged_*` tools through
`McpServer.callTool` — the layer above the direct toolkit dispatch `handlers.test.ts` already
covers. It asserts what only the server does: that the five names publish with `$ref`-free
object-root schemas, that a real call round-trips JSON argument decoding into `structuredContent`,
and that a path refusal comes back as `isError` with readable text rather than a failed effect.
`McpHttpServer.layerMemoryToolkitRegistration` had to be exported to be testable — one word, in a
file already on the modified list, matching a style upstream uses for its other registration layers.

The fourth case pins the tool-presentation gap in place: the Ged tools are not in T3's
`T3_MCP_TOOLS` catalog, the fallback renders them as `ged memory read` with a generic source, and
the test asserts the fallback stays graceful. See [DECISIONS](./DECISIONS.md).

The previous entry's claim that CI started on the push to `main` was wrong. The runs were created
and then sat `queued` indefinitely: upstream moved CI onto `blacksmith-*` runners, which this
repository has no subscription to, so the jobs had nowhere to go. A never-starting check is
indistinguishable from a slow one, which is why this took a watch to notice. `.github/workflows/ged-ci.yml`
is now the gate that actually runs — ours, additive, on GitHub-hosted runners — and the upstream
workflows that cannot work here are disabled in repository settings rather than edited.

## 2026-10-11 — The first CI run that actually ran found three defects local checks had passed

`ged-ci.yml`'s first run came back with Format/lint/knip and Test green and Typecheck red, on our
own files:

- `handlers.test.ts` imported `node:child_process` without the `nodeBuiltinImport:off` suppression
  upstream uses for exactly this case — a synchronous fixture built before any Effect runtime
  exists. Now suppressed, with the reason on the line.
- `handlers.test.ts` put `NodeServices.layer` inside the same `Layer.mergeAll` as
  `ProjectMemory.layer`, which needs its `FileSystem`, `Path`, and process spawner. `mergeAll`
  builds members in parallel and does not satisfy them for one another; the diagnostic said so as a
  **warning**, and `tsc` exits non-zero on it. Now `Layer.provideMerge(NodeServices.layer)`.
- `registration.test.ts`'s scoped helper did not widen the error channel, so `PlatformError`
  escaped its signature.

The reason these were reported locally as passing is worth keeping: the package typecheck was being
read by grepping its output for `error TS`, and the layer defect was a `warning`. Exit codes are the
check; output is commentary. The whole repo now typechecks at exit zero, 31 packages, and that is
what `ged-ci.yml` runs.

## 2026-10-11 — Fork identity restored: README, license, notices, Ged user docs

The re-fork had carried none of this over, so the tree read as T3 Code to anyone who landed on it.
Now: `README.md` is GedCode's and leads with what the Ged layer actually guarantees rather than with
its ancestry; `LICENSE` carries both copyrights; `THIRD_PARTY_NOTICES.md` covers the `grilling`
skill's MIT attribution, which the generated in-app manifests do not reach because it is not an npm
package; `CONTRIBUTING.md` says plainly that it is a fork, that the triage automation it describes is
upstream's and disabled here, and points at our issues.

`docs/ged/workflow.md` is new, not a port. The v0.4 document described clarify/plan/implement/verify
phases with checkpoints — a state machine this version deliberately dropped. The new one explains why
a verdict can be trusted by naming the mechanism under each claim (lead-spawned verifier, no
implementer summary, cross-vendor, `approval-required` pin, fresh thread per round) and ends with the
two things it does not claim.

Also disabled upstream's `Release`, `Release desktop build` and `Publish AUR package` workflows. They
publish the npm `t3` and `@t3code/*` packages; those are not ours to publish, and leaving them armed
on a tag push was the kind of thing that is only noticed afterwards.
