# State

> **NOTE (2026-06-24):** This file is now COMMITTED (not left uncommitted) because a Codex `--write`
> run's git op reverted the uncommitted `.ged/work/root/*` scratch during WP-A1. Keep it committed via
> `chore(ged)` commits (still kept out of *feature* commits). The authoritative record is the git
> commits + `CHANGELOG.md` + `docs/upstream-decisions.md`.

- **Phase**: Orchestrator Phase 4 (Playbooks, Autonomy & Taxonomy, epic #59) — base implementation
  COMPLETE; in the post-review follow-up (Change A in progress). Branch `feat/orchestrator-mode`,
  not merged to `main` (Phase 5 — scale/sandbox/real PR landing — still remains).
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
- **#1 — LIVE global defaults (Change A): IN PROGRESS.**
  - **A1 DONE** `3c8440cd5`: OrchestrationEngine reads `orchestratorDefaults` per-command (live) →
    decider resolves project-explicit (from RAW sparse `project.orchestratorConfig`) ?? global ??
    constant via the shared resolver (`resolveStages` added, `resolveGatePolicy` takes globals).
    `land` pinned. No canonical-schema change → fully-configured projects keep their values
    (backward-compat). Engine now depends on `ServerSettingsService` (test harnesses updated).
  - **A2 — PENDING (next):** rework the project editor to write SPARSE overrides ("use global" vs
    explicit per setting, reusing the "use default" pattern; show inherited/effective) and DROP the
    S2.2 client-side seed (so projects stay sparse and inherit global live). Spec: `A2-spec.md` (TBD).
  - **A3 — PENDING:** E2E proving a global change affects non-overriding projects live + explicit
    project overrides win. Spec: `A3-spec.md` (TBD).

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
- **Blockers**: none (Codex credits OK as of 2026-06-24).
