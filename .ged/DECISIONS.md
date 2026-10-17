# Decisions

> Durable decisions and rationale (ADR-style).

## Ged workflow role configuration parity

- Date: 2026-05-27
- Decision: Gedcode should present Ged workflow orchestration configuration as first-class UI, matching GedPi concepts: subagents enabled, intercom bridge, critique mode, and per-role provider/model/thinking settings.
- Scope note: Runtime invocation is currently implemented for `ged-explorer`; the configuration model should be extensible to planner, plan-reviewer, verifier, and worker without forcing all role runtimes to be implemented in one slice.

## Ged subagent ownership mode

- Date: 2026-05-27
- Decision: Ged workflow settings should support a mode that uses harness-native subagents instead of Gedcode-managed role child threads. In harness-native mode, per-role custom model settings are disabled/ignored and the workflow prompt instructs the selected harness/provider to create/use its native subagent mechanism.
- Rationale: Some users want provider-native subagent behavior rather than Gedcode-owned child threads and per-role model routing. The two models are mutually exclusive to avoid confusing model ownership semantics.

## GedCode app data directory

- Date: 2026-07-09
- Decision: Fresh GedCode installs use `~/.gedcode` as the default app data base directory. Desktop startup copies existing default `~/.t3` data into `~/.gedcode` when `~/.gedcode` is absent, preserving the old directory as a backup. If `~/.gedcode` already exists but the active state directory (`userdata` for stable, `dev` for dev builds) is absent, startup copies the matching legacy state directory from `~/.t3`. Explicit `T3CODE_HOME` / `--base-dir` values remain respected and are not migrated automatically.
- Rationale: The persisted data path should match the product name while keeping upgrade behavior safe and non-destructive.

## Orchestration always enabled

- Date: 2026-07-09
- Decision: Orchestration is available for every project; the project-level `enabled` setting is removed from runtime decisions and UI.
- Rationale: A per-project enable flag caused confusing PM startup failures and no longer expresses a useful product choice.

## Remove stage handoff limit

- Date: 2026-07-09
- Decision: The `maxStageHandoffs` Orchestrator resource limit is removed from contracts, settings logic, and decider enforcement.
- Rationale: The limit was confusing operational surface area and overlapped with clearer stage/task concurrency and retry controls.

## Rebase onto T3 Code V2 orchestrator

- Date: 2026-10-11
- Decision: Abandon the v0.4 fork lineage and re-fork from T3 Code `main` (`9afde1c6d`, #17848).
  Adopt the upstream V2 orchestrator as-is rather than porting GedCode's own orchestration
  domain. GedCode's contribution becomes the Ged workflow layer — durable project memory,
  role briefs, the lead playbook, and the land gate — built additively on top.
- Rationale: The v0.4 fork diverged 741/3775 commits across 4.5 months, and 450 of the 451
  upstream files it modified were also changed upstream, leaving no clean-merge surface.
  Upstream independently built a more capable delegation engine (durable child tasks,
  checkpoints, context handoffs, ten provider adapters). Maintaining a parallel orchestrator
  is not a good use of a solo maintainer.
- Constraint: Never modify an upstream file where a new file would do. Unmergeability is what
  killed v0.

## Stage discipline as policy, verification as a land gate

- Date: 2026-10-11
- Decision: Remove the durable `plan → work → verify` stage machine. The stages become
  delegation choices made by a task lead, not server-enforced states. The guarantee moves to
  the land boundary: nothing merges without a structured verdict record from an independent
  verifier.
- Rationale: The stage machine enforced sequence; the thing we care about is outcome. It taxed
  trivial work with mandatory stages while adding no guarantee at the point that mattered. A
  pipeline can be satisfied by passing through a stage; a gate can only be satisfied by
  producing evidence.
- See: `.ged/ORCHESTRATION.md`

## Verifier independence

- Date: 2026-10-11
- Decision: Verification runs as a lead-spawned delegated task that receives the original
  acceptance criteria and the diff — never the implementer's summary — at
  `runtimeMode: "approval-required"`, on a different `driverKind` than the implementer, and
  returns a structured per-criterion verdict rather than prose.
- Rationale: V2 children receive no parent conversation history, so a verifier is structurally
  blind to the implementer's reasoning; passing the implementer's summary would reintroduce
  exactly the bias the topology removes. Cross-vendor routing removes shared training priors
  and self-consistency pressure. `approval-required` separates find from fix.
- See: `.ged/ORCHESTRATION.md`

## 2026-10-11 — Verdict records are branch-keyed with SHA provenance

**Decision:** A verdict record is one JSON file per branch at `.ged/verdicts/<branch>.json`,
carrying the `headSha` the verifier actually reviewed. The land gate compares that field against
the live head.

**Rationale:** Keying the filename by SHA is cleaner in principle but churns on every amend and
leaves orphaned records behind. The property that actually matters is staleness detection, and a
branch-keyed record with an inner SHA gives that while staying stable across rounds. Resolves the
open question recorded in ORCHESTRATION.md §9.

## 2026-10-11 — The land gate fails closed

**Decision:** `.ged/bin/land-gate.sh` exits non-zero for a missing, malformed, stale, failing,
evidence-free, or same-vendor verdict. There is no skip path and no override flag.

**Rationale:** A gate with an escape hatch is a suggestion. The entire reason the stage machine was
dropped in favour of an outcome gate is that the gate cannot be satisfied by passing through it —
only by producing evidence. An override would restore exactly the weakness being removed. Verified
against all six failure modes plus the passing case.

## 2026-10-11 — Carried v0.4 memory and skills rewritten, not imported

**Decision:** `.ged/STANDARDS.md` and `.ged/PROJECT.md` were rewritten from scratch for the new
base, and the `verify`, `ged-planning`, `ged-execution`, `ged-verification`, `grill-me`, and
`grill-with-docs` skills were realigned. `.ged/STANDARDS.md` is no longer a verbatim dump of the
harness instruction files.

**Rationale:** The carried copies described a Bun/Vitest workspace, modules upstream has deleted,
and a `.ged/work/root/STATE.md` phase machine that no longer exists. Stale memory is worse than
absent memory because it is followed confidently. Notably, the old `verify` skill mandated a
repo-wide typecheck and test run, which directly violates upstream's standing rule that CI owns the
full suite.

## 2026-10-11 — The memory MCP toolkit gets a bounded upstream exception

**Decision:** The memory toolkit lives in new files under
`apps/server/src/mcp/toolkits/memory/` (`tools.ts` + `handlers.ts`, matching the existing `project`
toolkit), builds its layer with the **exported** `McpHttpServer.toolkitRegistration` helper, and is
wired in by adding two imports and one entry to the `Layer.mergeAll` at
`apps/server/src/mcp/McpHttpServer.ts:869`. That three-line edit is the only upstream change
permitted for this component.

**Rationale:** Toolkit registration has no plugin seam — the final `layer` merge is the sole
assembly point, and nothing outside the module composes it (only tests import the individual
layers). So some upstream edit is unavoidable. Three lines in a merge list is close to the minimum
conflict surface available: it is additive within the file, so a rebase conflicts only if upstream
reorders that exact list.

Recorded explicitly because the standing rule is "never modify an upstream file where a new file
would do" — here no new file would do, and the exception needs to be visible rather than discovered
later in a rebase.

## Verdict records are untracked, and the gate is a local control

- Date: 2026-10-11
- Status: accepted

A tracked verdict record and HEAD chase each other. Committing a record changes HEAD, which makes
the `headSha` inside the record it just committed stale. There is no fixed point, so a tracked
record can never satisfy the gate's own freshness rule.

Records are therefore untracked — `.ged/verdicts/.gitignore` — and the gate skips that directory
when it checks for a dirty tree. The nested ignore keeps the root `.gitignore`, an upstream file,
untouched.

The consequence is stated rather than hidden: **the land gate is a local, pre-push control.** CI
cannot see these records. Giving CI the same guarantee needs a separate transport — a check-run
annotation, a PR comment, or an artifact — and that is not built. A reviewer who assumes CI
enforces this would be wrong.

## The land gate guards omission, not forgery

- Date: 2026-10-11
- Status: accepted

The verdict record is self-asserted and unsigned. Any agent that can write to `.ged/verdicts/` can
write a passing record, including the implementer's own agent naming a verifier that never ran.

This is accepted deliberately, because the failure the gate exists to stop is a _lazy_ lead, not a
_dishonest_ one: a lead that skipped verification, verified an older tree, or let a same-vendor
reviewer agree with itself. Against all three the gate works, and it works without the server-side
machinery an attestation would need.

Raising it to resist forgery means an attestation the agent cannot mint — a signature from the
orchestrator process, or the verdict recorded in the task record server-side rather than on disk.
Worth doing before this is relied on beyond a solo workflow. Recorded here so that it is a known
limit rather than an assumed guarantee.

## Project memory is served through MCP, not through prompts

- Date: 2026-10-11
- Status: accepted

The role briefs are useless if only one harness can read them. A Codex worker and a Claude worker
must be briefed identically or the cross-vendor verification in ORCHESTRATION.md §5 means nothing —
the two would be answering different questions.

So `.ged/` is served as an MCP toolkit (`ged_memory_list`, `ged_memory_read`, `ged_role_brief`,
`ged_verdict_write`, `ged_land_check`) backed by `apps/server/src/ged/ProjectMemory.ts`. Every
provider the orchestrator can drive reaches the same documents, from the branch it is working on
rather than from the project root, so a lead revising the briefs on its own branch gets its own
revision.

`ged_land_check` **runs** `.ged/bin/land-gate.sh` rather than reimplementing its rules in
TypeScript. Two implementations of a fail-closed rule is two chances to fail open, and the one that
drifts is the one nobody runs. The cost is spawning a repo-local script; that is not new exposure,
since an agent that could rewrite the script could equally defeat the git-hook path.

The service lives in `apps/server/src/ged/` rather than in a new workspace package. A package would
have to be added to `apps/server/package.json` — a second upstream file — to buy a reuse nobody
needs yet. `McpHttpServer.ts` (10 lines) stays the only upstream _code_ file we touch.

## 2026-10-11 — One version line: the 0.4.x fork continues as 0.5.x

- Status: accepted. Supersedes an earlier decision that called this tree v1.

The fork that ran from `e3accd6e95` to `c3a9813f39`, tagged up to v0.4.8, is **v0.4**. This tree is
**v0.5**. It was briefly called v1, on the reasoning that a re-fork abandoning the old lineage is a
generation boundary rather than a minor version. That reasoning was about the code. The version
number is not about the code.

There are real v0.4.8 installs updating from a live Sparkle appcast. Sparkle offers an update only
when the advertised version is higher, so the number has exactly one job: be greater than 0.4.8.
Continuing the line at 0.5.x does that and keeps every existing install on the update path. Starting
over at 1.0.0 would also have worked numerically but claims a stability this tree has not earned;
staying on upstream's 0.0.45 would have stranded every existing user silently, which is the same
class of failure Sparkle exists to prevent.

Package manifests are **not** renumbered. `apps/{web,desktop,server}` and `packages/contracts` stay
on upstream's 0.0.45 train, because they are wired into upstream's release automation and editing
them would add four hot upstream files to the modified list for nothing. The shipped version is a
build input — `--build-version`, or `T3CODE_DESKTOP_VERSION` — resolved in
`scripts/build-desktop-artifact.ts:1750`. The release train is a release-time fact, not a manifest
field.

This also retires the lowercase/uppercase convention. With no bare `v1` of our own, upstream's `V1`
and `V2` are unambiguous on their own.

## 2026-10-11 — Our own pull request template

- Status: accepted

Upstream's template is written for outside contributors to a repository with limited review
capacity: read CONTRIBUTING.md, link a triaged issue, show explicit maintainer approval of scope.
Every one of those is noise in a fork whose only contributor is its maintainer, and the prefill
made the first real PR read like a submission to someone else's project.

Ours asks the questions this repo actually has to answer: what broke, what fixed it, **what it
cost upstream** (which upstream files this PR edits, since each one conflicts on the next merge),
what was verified, and who verified it independently of whom.

This is the second upstream file we modify. It is a governance document rather than code, its
content does not apply to us, and a conflict in a 31-line template is cheap to resolve.

## 2026-10-11 — Upstream's AGENTS.md and CLAUDE.md are deferred to, not copied

- Status: accepted

v0.4 imported its own `AGENTS.md` and `CLAUDE.md` verbatim into `STANDARDS.md`. The copy went stale
within weeks and had to be rewritten, which is the predictable outcome: a duplicated document has
no mechanism that keeps it true.

So `STANDARDS.md` points at upstream's files in place and states only what is Ged-specific on top
of them. The cost is one indirection when reading. The benefit is that upstream's house rules
cannot silently diverge from what our agents are told, because there is only one copy.

Revisit only if a genuinely Ged-specific overlay is wanted — and then as an overlay that names what
it overrides, never as a second full copy.

**2026-10-11 addendum.** That overlay is now wanted and exists. An agent entering this repository
read upstream's `AGENTS.md` (via the one-line `CLAUDE.md`) and was never told `.ged/` existed — not
the standards, not the memory, not the land gate. Thirteen lines appended to the end of `AGENTS.md`
point at those three things and override nothing. Appended at the end deliberately: it is the
position least likely to conflict, and the overlay stays a pointer, so the no-second-copy rule above
still holds.

## 2026-10-11 — Memory holds what is written, not slots for what might be

- Status: accepted

`.ged/` carried eleven files and four directories from v0.4 that contained nothing but a heading or a
README: `ARCHITECTURE.md`, `PATTERNS.md`, `GLOSSARY.md`, `IDEAS.md`, three JSON state files for
tooling that no longer exists, and `specs/`, `tasks/`, `research/`, `project-skills/`. They were
removed.

An empty slot is not neutral. Every agent that reads project memory pays for it, it reads as
something that exists, and a heading with nothing under it invites filling with restatement rather
than with anything learned. The directories cost nothing to recreate the day something needs
storing.

The same reasoning cut six of ten skills. `ged-planning`, `ged-execution` and `ged-verification`
each restated the role brief it pointed at, which is two copies of the same rules with nothing
keeping them equal — and the brief is the better copy, because `ged_role_brief` serves it to Codex
and OpenCode while a skill only exists inside Claude Code. `grill-me` duplicated `grilling`;
`grill-with-docs` composed it with `domain-modeling`, which drove a root `CONTEXT.md` and a
`docs/adr/` tree this repo does not have and explicitly instructed against the `CONTEXT-MAP.md`
this repo does use. Both were broken on arrival.

What survives is `ged-lead`, `verify`, `grilling`, `sync-upstream`. The rule going forward: role
behaviour goes in a brief, and a skill has to justify why a brief would not do.

## 2026-10-11 — Sparkle stays; it is the one capability worth an expensive upstream edit

- Status: accepted (the capability). Implementation planned, not started.

Upstream ships `electron-updater`, which on macOS cannot install an update onto an ad-hoc-signed
app. Without an Apple Developer Program membership that means no auto-update on macOS, ever, and
users silently stranded on old builds. v0.4 solved this with Sparkle 2, which verifies updates with
its own EdDSA signature instead of the system code signature. That capability is kept.

It is the most expensive thing the additive-only constraint will be asked to absorb: it takes the
modified-upstream-file count from three to five, and two of the new entries
(`scripts/build-desktop-artifact.ts` at 4172 lines, `.github/workflows/release.yml` at 1398) are
among the most actively developed files upstream. Paying that is a deliberate choice, recorded
here so a future merge conflict is a known cost rather than a surprise.

What makes it affordable at all: `ElectronUpdater` is an Effect `Context.Service` selected by a
single line at `apps/desktop/src/main.ts:140`. Sparkle goes in as a second layer satisfying the
same interface on darwin, so upstream's 1042-line `DesktopUpdates.ts` and everything above it stay
untouched. If the interface turns out not to fit, that is a finding to report — widening it is a
different and much worse trade.

v0.4's diffs are a reference, not a patch set. Upstream's updater, build script, and release workflow
have all changed substantially since v0.4 forked.

Not deferred, not dropped: `.ged/plans/sparkle-updates/`.

## 2026-10-11 — The Expo app is dropped from the workspace, not deleted

- Status: accepted.

`apps/mobile` is out of scope: GedCode is a desktop and web workspace, and nothing in the Ged layer
reaches the phone. It is removed from the pnpm workspace rather than deleted from the tree.

Deleting it would cost six upstream files — `knip.jsonc`, root `package.json`, `.github/workflows/ci.yml`
(seventeen mentions across two jobs and the gate list), `third-party-licenses.config.json`, root
`vite.config.ts` (about fifteen globs), plus five mobile workflows — and 1,197 file deletions, every
one of them a permanent conflict against an app upstream develops actively. Two lines in
`pnpm-workspace.yaml` buy the same result: mobile is not installed, not built, and not released, and
upstream's changes to it keep merging without a word from us.

Three upstream files move as a result, and that is the real price:

- `pnpm-workspace.yaml` (8 lines) — the exclusion, plus `allowUnusedPatches: true`. Excluding the app
  orphans twelve React Native and Expo patches; they stay in `patches/` so reviving mobile needs no
  further upstream edit, and pnpm refuses to install with unreferenced patches unless told.
- `pnpm-lock.yaml` — regenerated without the mobile importers (482 insertions, 1,754 deletions). This
  conflict is self-healing: take upstream's lockfile wholesale and re-run install.
- `knip.jsonc` (36 lines) — the one that was not obvious. Thirty-two exports in `client-runtime`,
  `contracts`, and `shared` had the Expo app as their only consumer, so dropping it from the graph
  made them read as unused and failed `knip:check`. Deleting the app would have caused exactly the
  same failure, so this cost is not avoidable by choosing differently; it is scoped per file so a new
  mobile-only export upstream fails loudly and gets a line, rather than being swallowed by a
  package-wide rule.

Measured saving: `node_modules` 5.8G → 5.2G, 2014 → 1905 pnpm entries. Less than the full React
Native toolchain because `apps/web` legitimately depends on part of it (`@legendapp/list`,
`react-native-svg`).

**Reviving it** needs no upstream edit beyond reverting those two workspace lines — plus an Expo
account of our own, because `apps/mobile/app.config.ts` hardcodes `owner: "pingdotgg"` and an EAS
project id.

## 2026-10-11 — Keeping the mobile app "just for personal use" was assessed and declined

- Status: accepted.

The question was whether mobile could be kept cheaply against our own server. Architecturally, yes:
Clerk is confined to settings and auth screens rather than gating boot, and LAN pairing is
first-class — `apps/mobile/src/features/connection/` carries `LocalEnvironmentList.tsx`, a `pairing.ts`
that builds a host-plus-token QR URL, and an `environmentSections.ts` that already splits local
environments from relay-managed ones. Pointing the app at our own server over LAN needs no code.

Shipping it is the problem. Eight custom native modules (43 Swift and Kotlin files) rule out Expo Go,
so every install is a full native build; `ios/` and `android/` are not committed, so it is
`expo prebuild` plus Xcode or EAS every time; and `app.config.ts` hardcodes upstream's Expo owner and
EAS project id, so personal builds mean editing upstream files. On iOS a personal install needs
either an Apple Developer Program membership or seven-day free-provisioning re-signs — the same cost
Sparkle exists to avoid. Android sideload is the only version that is actually cheap, and an
Android-only app is not a product.

## 2026-10-11 — CI runs on GitHub-hosted runners in an additive workflow; upstream's are disabled

- Status: accepted.

Upstream runs 37 of its 48 jobs on `blacksmith-*` runners — a third-party hosted-runner service T3
subscribes to and this repository does not. Those jobs do not fail; they queue forever, which is
worse, because a never-starting check looks the same as a slow one. Watching run `38143401633` for
several minutes with every job still `queued` is what surfaced it. v0.4 never hit this: its
`ci.yml` was on `ubuntu-latest`.

Rewriting `runs-on:` would mean editing `.github/workflows/ci.yml` in 37 places plus eight other
workflow files, all of them hot upstream files, for a conflict on every sync. Instead:

- `.github/workflows/ged-ci.yml` is ours and new — format, lint, `knip:check`, repo-wide typecheck,
  and the Ged test suites, on `ubuntu-latest`. The repository is public, so GitHub-hosted minutes
  are free. Nothing upstream is modified, so nothing here can conflict.
- Upstream's workflows are disabled through **repository settings**, not file edits
  (`gh workflow disable`). Disabled: CI, Windows Tests, Deploy T3 Connect relay, both Desktop macOS
  Preview workflows, Web Preview, all four Mobile workflows, PR Size, PR Vouch, Thread Transfer
  Report, and Forward to Cursor hygiene. Still active: Issue Labels, Publish AUR package, Release
  desktop build, Release.

The ones beyond Blacksmith were disabled for a reason of their own: the relay deploy wants T3's
Cloudflare credentials, the previews want T3's hosting, the mobile workflows target an app that is
no longer in the workspace, and PR Vouch and the Cursor hygiene forwarder are T3's contribution
process, not ours.

A disabled workflow stays disabled across syncs and shows up plainly in `gh workflow list`, so
re-enabling one is a deliberate act. The cost of this choice is that an upstream change to CI
coverage is invisible to us — `ged-ci.yml` has to be kept honest by hand.

## 2026-10-11 — The Ged tools are absent from T3's MCP tool catalog, and stay absent

- Status: accepted.

`packages/shared/src/t3McpToolPresentation.ts` holds `T3_MCP_TOOLS`, the catalog that gives a tool
its display title and T3 branding in the client. The five `ged_*` tools are not in it, and upstream's
own test in `apps/server/src/mcp/toolkits/core.test.ts` enumerates a fixed toolkit list that does not
include `MemoryToolkit`, so they are not checked against it either.

The consequence was read out of `packages/provider-core/src/server/mcpToolPresentation.ts` rather
than assumed: the fallback is graceful. An unknown tool gets a title derived from its name — `ged
memory read` — and a generic `kind: "integration"` source instead of T3 branding. It renders; it is
just not branded.

Registering them means editing a large, hot upstream catalog for cosmetics. Under the additive-only
rule that is a bad trade, so the limit stands. `registration.test.ts` asserts the fallback rather
than the catalog, so if upstream ever changes the unknown-tool path from graceful to broken, we find
out from a failing test instead of from a user.

## 2026-10-11 — The fork's identity lives in four files, and upstream's docs tree is left alone

- Status: accepted.

A fork that reads as its upstream is a bug: upstream's `README.md` offers T3 Code's installers
(`t3.codes`, winget, scoop, brew, AUR) and T3's release page, none of which install this. So four
root files are ours — `README.md` (rewritten), `LICENSE` (our copyright added beside T3 Tools'),
`CONTRIBUTING.md` (fork preamble plus repo links; upstream's standards kept, because staying
mergeable is the point), and a new `THIRD_PARTY_NOTICES.md` for the `grilling` skill, which is
adapted from `mattpocock/skills` under MIT and is not covered by the generated in-app license
manifests.

Everything under `docs/` stays upstream's and unedited. It documents the same harness, it is a hot
tree, and rebranding it would buy nothing and cost a conflict per sync. GedCode's own user
documentation is additive, at `docs/ged/`, and is linked from our `README.md` rather than from
upstream's `docs/README.md` index.

`docs/ged/workflow.md` is written against the v0.5 model — PM thread, task lead, role children,
verdict records, land gate — and is not a port of v0.4's `docs/ged-workflow.md`, whose phases and
checkpoints describe a state machine that no longer exists. It states the two known limits
(unsigned records, no CI transport) rather than implying a guarantee the gate does not provide.

Upstream's release workflows are disabled alongside the rest; see STANDARDS.md.

## 2026-10-11 — GedCode's identity is set in source; its product name at build time

- Status: accepted.

v0.5 must update v0.4 installs in place through Sparkle, so it has to be the same app: bundle
identifier `com.gedcode.app` (0.4 shipped `com.t3tools.gedcode`), product name `GedCode`, Electron userData `gedcode` /
`gedcode-dev`, home `~/.gedcode`, URL schemes `gedcode` / `gedcode-dev`. Those are constants in
about twenty upstream files (desktop identity and paths, server home and origins, the auth return
schemes) and are edited there: a one-line constant edit per file is a cheap conflict, and an
identity that differs between source and build is how data ends up in the wrong profile.

The user-visible name is not edited in source. About 180 upstream files say "T3 Code", and
rewriting them would make every sync a conflict storm. `scripts/ged/identity.ts` rewrites
"T3 Code", "T3 Connect" and plain "T3" before a word ("a T3 thread") in the staged bundles and the electron-builder config instead, so a
packaged build says GedCode everywhere. The cost: `vp run dev` still shows upstream's strings,
because dev serves unstaged sources.

T3's services are cut rather than rebranded. Telemetry has no key and is off; the model manifest,
CLI release index and release notes point at this repository; pairing links are direct server links
because there is no hosted web app; the T3 mobile beta prompt is hidden; the desktop never imports
a T3 Code profile, so a machine with both apps keeps them apart. The remote tunnel (Clerk +
Cloudflare relay), the `t3.json` schema URL and the `t3` CLI command name are left as upstream has
them and dormant — each needs a service of ours before it can be renamed meaningfully.

## 2026-10-12 — The CLI, project file and branches are named gedcode; the rest of "t3" stays internal

- Status: accepted.

Users type and read these, so they are renamed in source: the CLI command and the desktop launcher
(`~/.gedcode/bin/gedcode`), the project file (`gedcode.json`, schema generated by
`scripts/ged/project-file-schema.ts` into `docs/ged/gedcode.schema.json` and served from raw
GitHub), and branch prefixes (`gedcode/<hash>`, `gedcode/pr-N/...`; the worktree-branch pattern
still recognises the old `t3/` and `t3code/` shapes so existing worktrees are not orphaned).

Remaining prose ("T3" before a word, `t3 <command>` in help text, `npx t3`, `t3.json` in labels) is
rewritten at stage time by ordered rules in `scripts/ged/identity.ts`, checked against a packaged
bundle so that no rule touches code. Identifiers nobody reads stay upstream's: the `@t3tools`
scope, `T3CODE_*` variables, MCP tool names, `refs/t3` checkpoints, storage keys and CSS. So do
the npm `t3` package names and their hints: the `gedcode` npm name is not ours, so nothing
advertises it.

A repository's existing `t3.json` is no longer read. Reading it as a fallback was not added
without the owner's say-so.

## 2026-10-12 — Upgrading from 0.4 keeps threads, drops PM history, and says so

- Status: accepted.

0.4 numbered its own migrations 31–80 in the ledger upstream also numbers from 31, so the V2
migrator took upstream's 31+ as applied and the server crashed on the first start after an
update. `apps/server/src/persistence/gedV04Import.ts` recognises a 0.4 ledger by its exact
migration names and rewrites the import _snapshot_ back to the shared schema at migration 30:
the PM tables and 0.4-only columns go, so upstream's migrations apply and threads import as
ordinary threads. The original `state.sqlite` is never written, so PM history is not deleted,
only not shown; reinstalling 0.4.8 still reads it. Any other database passes through unchanged.

The user is told twice, because 0.4's updater installs in the background without showing notes:
`docs/ged/releases/<version>.md`, when present, goes into the GitHub release and is embedded in
the Sparkle appcast (Markdown, which 0.4.8's Sparkle 2.9.6 renders on a manual check), and
`apps/desktop/src/ged/GedUpgradeNotice.ts` shows a one-time dialog on the first launch over a
0.4 database (`state.sqlite` present, `statev2.sqlite` not yet created).

The bundle id is `com.gedcode.app`, not 0.4's `com.t3tools.gedcode`, so nothing user-visible names
T3. Sparkle still updates 0.4 in place: it finds the new app by file name (`GedCode.app`) and trusts
it by the EdDSA key, never by bundle id (Sparkle 2.9.6 `SUInstaller.m`, `SUUpdateValidator.m`).
What does not carry over is keyed to the bundle id: macOS notification permission and Sparkle's
own defaults, which the app does not use. Data lives under `~/.gedcode` and the userData directory,
both keyed by name. A 0.4 install renamed away from `GedCode.app` cannot be matched and needs a
manual download.

## 2026-10-17 — Ged setup has a client RPC, so the UI entry points touch upstream

- Status: accepted.

The user chose Project settings and the command palette as entry points for setting up Ged, next
to the `ged_init` agent tool. A client can only reach the server's `GedSetup` through the
WebSocket RPC group, and upstream requires every RPC to declare a scope and an instrumentation
category, so the RPCs cost a few lines each in `rpc.ts`, `RpcAuthorization.ts`,
`RpcInstrumentation.ts` and `ws.ts`. Everything else is Ged-owned: the contract in
`packages/contracts/src/ged.ts`, the handlers in `apps/server/src/ged/GedRpcHandlers.ts`, the
dialog in `apps/web/src/components/ged/`. Preview needs `filesystem:read`, apply needs
`filesystem:write`, matching `projects.writeFile`. The client commands live in `apps/web` rather
than `client-runtime` because this fork does not build mobile, which spares an export in
`client-runtime/package.json`.
