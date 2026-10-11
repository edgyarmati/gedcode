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
- Decision: Abandon the v0 fork lineage and re-fork from T3 Code `main` (`9afde1c6d`, #17848).
  Adopt the upstream V2 orchestrator as-is rather than porting GedCode's own orchestration
  domain. GedCode's contribution becomes the Ged workflow layer — durable project memory,
  role briefs, the lead playbook, and the land gate — built additively on top.
- Rationale: The v0 fork diverged 741/3775 commits across 4.5 months, and 450 of the 451
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

## 2026-10-11 — Carried v0 memory and skills rewritten, not imported

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

## 2026-10-11 — This tree is GedCode v1; the old fork is v0

- Status: accepted

The fork that ran from `e3accd6e95` to `c3a9813f39`, tagged up to v0.4.8, is **v0**. This tree is
**v1**. A re-fork that abandons the old lineage, drops the orchestration domain, and rebuilds the
discipline on a different engine is a generation boundary, not a minor version, and calling it
anything else invites someone to read v0's tags as this tree's history. They are not.

Case carries meaning here, because two numbering schemes meet: lowercase `v0`/`v1` is a GedCode
generation, uppercase `V1`/`V2` is upstream's own (the V2 orchestrator, the V1 sqlite projections).
GedCode v1 runs on upstream's V2 orchestrator; both numbers are right and they count different
things.

Package versions are **not** being set to 1.0.0. They track upstream's release train (0.0.45) and
are wired into upstream's release automation; renumbering them buys nothing and breaks that. The
generation is a project fact recorded here, not a field in a manifest.

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

v0 imported its own `AGENTS.md` and `CLAUDE.md` verbatim into `STANDARDS.md`. The copy went stale
within weeks and had to be rewritten, which is the predictable outcome: a duplicated document has
no mechanism that keeps it true.

So `STANDARDS.md` points at upstream's files in place and states only what is Ged-specific on top
of them. The cost is one indirection when reading. The benefit is that upstream's house rules
cannot silently diverge from what our agents are told, because there is only one copy.

Revisit only if a genuinely Ged-specific overlay is wanted — and then as an overlay that names what
it overrides, never as a second full copy.

## 2026-10-11 — Memory holds what is written, not slots for what might be

- Status: accepted

`.ged/` carried eleven files and four directories from v0 that contained nothing but a heading or a
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
users silently stranded on old builds. v0 solved this with Sparkle 2, which verifies updates with
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

v0's diffs are a reference, not a patch set. Upstream's updater, build script, and release workflow
have all changed substantially since v0 forked.

Not deferred, not dropped: `.ged/plans/sparkle-updates/`.
