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
- Decision: Abandon the v1 fork lineage and re-fork from T3 Code `main` (`9afde1c6d`, #17848).
  Adopt the upstream V2 orchestrator as-is rather than porting GedCode's own orchestration
  domain. GedCode's contribution becomes the Ged workflow layer — durable project memory,
  role briefs, the lead playbook, and the land gate — built additively on top.
- Rationale: The v1 fork diverged 741/3775 commits across 4.5 months, and 450 of the 451
  upstream files it modified were also changed upstream, leaving no clean-merge surface.
  Upstream independently built a more capable delegation engine (durable child tasks,
  checkpoints, context handoffs, ten provider adapters). Maintaining a parallel orchestrator
  is not a good use of a solo maintainer.
- Constraint: Never modify an upstream file where a new file would do. Unmergeability is what
  killed v1.

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

## 2026-10-11 — Carried v1 memory and skills rewritten, not imported

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
