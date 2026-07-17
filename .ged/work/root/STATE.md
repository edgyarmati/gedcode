# STATE

- **Phase**: implement
- **Active task**: `ORCH-WORK-02`
- **Roadmap**: Orchestrator delegation and project context, clarified 2026-07-17
- **Prior milestone**: v0.3.0 released; completed roadmap history remains in Git and `CHANGELOG.md`

## Locked Decisions

- Work-agent completion is server-enforced. Dirty tracked/untracked changes pause in Change review.
- The PM inspects remaining changes and may commit, return/steer, or discard them. Verification runs
  only afterward and must bind to exact current task HEAD.
- Empty accepted work becomes No changes needed. Successful landed/no-change tasks auto-archive.
- Inert legacy landed-without-PR tasks become no-change only when they have no genuine landing failure.
- PMs handle bounded low-risk changes directly in the primary checkout, including overlapping dirty
  files; they review intended hunks, run proportional checks, commit, and report the result.
- Codex PM uses workspace-write/auto-review with unresolved access forwarded to the user. Claude and
  OpenCode retain native full access.
- Stage roles remain Plan/Work/Verify. Backend configuration becomes global Cheap/Smart/Genius presets
  with project overrides; each stores harness, model, and thinking/options.
- Upgrade requires a non-skippable full-Orchestrator migration wizard. Users manually map legacy
  selections; no semantic auto-mapping or temporary fallback is allowed.
- PM owns tier selection and escalation. Simple planning remains PM-owned; delegated planning defaults
  Genius; work and verification use Cheap or Smart based on scope. Failures do not auto-escalate.
- Exploration is a persisted read-only helper run attached to a PM thread or task, not a stage/task/PR.
- Project context uses `AGENTS.md`, `.ged/PROJECT.md`, `.ged/ARCHITECTURE.md`, root `CONTEXT.md`, and
  sparse `docs/adr/*`; `.ged/DECISIONS.md` is omitted and `.gedcode/` is never agent-authored context.
- Replace `grill-me` with integrated upstream `grill-with-docs`, `grilling`, and `domain-modeling` while
  preserving GED state transitions.
- Project-context prompting is state/fingerprint-aware across Chat and Orchestrator. Context runs choose
  a preset card with harness logo/model/thinking, default Smart, and persist the chosen tier globally.
- Context changes require Commit/Revise/Discard review and never create a task or PR.
- PM/project headers open project root; worker headers open task worktree. Primary configured-editor
  button has a menu for file manager, terminal, and alternate editors.
- New branches use `ged/<task-type>/<title-slug>` with deterministic numeric collisions. Existing
  branches are unchanged.
- Canonical pipeline-order enforcement remains deferred except exact-HEAD verification before landing.

## Execution Notes

- `ORCH-WORK-01` completed 2026-07-17. Added append-only Change review, exact-HEAD
  verification, and No changes needed commands/events, strict task schemas, migration 056, durable
  SQL projections, client projection support, terminal worktree ownership, and replay coverage.
- Verification evidence for `ORCH-WORK-01`: focused server suite 122/122 passed; `bun fmt`, `bun lint`,
  and `bun typecheck` passed; full `bun run test` passed outside the filesystem sandbox because the
  existing network tests require loopback socket binding.

- Implement one `NEXT` slice at a time in `.ged/work/root/TASKS.md`.
- Preserve the append-only orchestration event store; compatibility repair must use migrations at
  projection boundaries or new lifecycle events, never direct event mutation.
- Do not introduce fallback behavior for the mandatory preset migration.
- Update `CHANGELOG.md` for each user/operator-visible slice.
- Before committing non-trivial work run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`.
