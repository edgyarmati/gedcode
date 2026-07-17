# TESTS — Orchestrator Delegation and Project Context

Every slice must run focused tests first, then `bun fmt`, `bun lint`, `bun typecheck`, and
`bun run test`. Never use `bun test`. User-visible changes must update `CHANGELOG.md` under
`## Unreleased`.

## Verification Evidence

### ORCH-WORK-01 — 2026-07-17

- Focused: `decider.task`, in-memory projector, SQL projection replay, and migration 056 — 122 tests
  passed.
- Repository: `bun fmt`, `bun lint`, and `bun typecheck` passed. Lint retained only pre-existing
  warnings outside this slice.
- Full: `bun run test` passed outside the sandbox; the sandboxed attempt failed only because existing
  loopback tests cannot bind local sockets there.
- Manual review: legacy events decode with null defaults; replay preserves resolved Change review,
  verified HEAD, and No changes needed records; terminal worktree ownership recognizes no-change.

## Commit and Landing Lifecycle

### State and replay

- Decode and replay Change review, No changes needed, verified HEAD, and auto-archive events.
- Rebuild projections from the append-only event log and compare them with live projections.
- Restart during dirty detection, PM review, commit, discard, verification, no-change settlement, and
  archival without duplicate transitions.
- Reject stale/foreign command IDs and invalid terminal transitions.

### Dirty work resolution

- Work settlement with committed clean changes proceeds to verification eligibility.
- Tracked changes, untracked files, deletions, renames, and mixed state enter Change review.
- PM receives exactly one bounded status/diff notification and cannot start verification beforehand.
- Inspect/commit/discard operations are limited to the named task worktree and selected paths/hunks.
- Returning work reuses/steers the appropriate attempt; subsequent changes invalidate old verification.
- Commit messages are descriptive and task-scoped; commits exclude unrelated selected-out changes.

### Exact verification and landing

- Verification stores the exact task HEAD and cannot succeed while the worktree is dirty.
- A later commit, amend, discard that changes HEAD, or renewed work makes verification stale.
- Landing requires current verified HEAD, a clean worktree, approval, and existing landing guards.
- Failed/interrupted verification never qualifies; unrelated non-mutating activity does not invalidate it.

### No-change and archive

- Accepted zero-diff work becomes No changes needed without land approval, PR, or landing reactor.
- Successful landed and no-change tasks leave the active board and appear in archived history.
- Legacy landed-without-PR tasks migrate only when no durable PR-opening failure exists.
- Genuine PR failures remain retryable; tasks with a PR remain landed history.
- Reconciliation is append-only, idempotent, and safe when the worktree is already absent.

## PM Direct Work

- Codex PM startup/resume/turn parameters use workspace-write plus auto-review.
- Denied/unresolved Codex escalation reaches the user; Claude/OpenCode preserve native full access.
- PM policy selects direct work only for bounded low-risk edits and explains why.
- Direct work may overlap dirty files, but the PM reviews the combined diff and commits only intended
  hunks after proportional checks.
- Direct commits appear in the PM transcript with command/check evidence and create no task/worktree/PR.
- Migrations, public contracts, security-sensitive changes, broad edits, or uncertain work become tasks.

## Capability Presets

### Resolution

- Global Cheap/Smart/Genius selections require harness, model, and valid provider options.
- Project overrides inherit/reset independently; settings changes do not alter past attempts.
- Stage attempts persist semantic role, chosen tier, and complete resolved selection.
- Role prompt prefixes remain Plan/Work/Verify-specific.

### Blocking migration

- Legacy role selections are enumerated without guessing their tier.
- Partial, invalid, or dismissed mappings do not complete migration.
- Orchestrator list, project, task, PM, helper, and deep-link routes all show the same non-skippable
  wizard until global and project mappings are valid.
- Completion survives restart and removes obsolete model-by-role settings from current projections
  without rewriting historical events.

### PM routing

- Simple planning stays in PM context and work receives its concrete plan.
- Delegated planning defaults Genius; work and verify resolve Cheap or Smart based on PM judgment.
- Explicit overrides win and are visible in the ledger.
- Inadequate results can be retried one tier higher by the PM.
- Quota, permission, environment, launcher, and network failures never auto-escalate.

## Helper Runs

- Helpers persist under a PM thread or task with stable identity and bounded results.
- PM helpers use project root; task helpers use the task worktree; both are read-only.
- Cheap is default, while Smart/Genius overrides resolve through project presets.
- Results enter only the requesting PM/subsequent stage context and remain size/secret bounded.
- Helpers support interruption, quota blocking, restart recovery, and terminal retention.
- No helper creates a task, stage, worktree, gate, commit, PR, landing state, or board card.

## Project Context and Skills

### Skill behavior

- Integrated grilling asks one decision at a time, recommends an answer, and discovers facts from the
  environment instead of asking the user.
- Resolved domain terms update root `CONTEXT.md` without implementation details.
- ADRs are offered only for hard-to-reverse, surprising, trade-off decisions and use sparse numbering.
- GED state moves clarify → plan → implement using the vendored skill workflow.

### Context scanning and prompts

- Classify missing files, empty bytes, whitespace, headings/comments-only templates, and substantive
  files across `AGENTS.md`, `.ged/PROJECT.md`, `.ged/ARCHITECTURE.md`, and `CONTEXT.md`.
- Ignore `.gedcode/`, `.ged/work/root/*`, generated output, and secrets.
- New/stub context prompts Populate; substantive context prompts Review.
- Dismissal/completion deduplicates across Chat and Orchestrator.
- Material file changes and schema-version upgrades re-prompt; ordinary project navigation does not.

### Context runs and review

- Preset cards show harness logo, preset name, model, and thinking; first use is Smart.
- Selecting Cheap/Smart/Genius becomes the global future default without copying a concrete model outside
  preset configuration.
- Runs use the primary checkout and may create only canonical context files or warranted ADRs.
- Resulting changes remain uncommitted until Commit; Revise runs another turn; Discard restores only
  context-run changes.
- Completion records new fingerprints and creates no task, stage, gate, worktree, or PR.

## Launch Actions and Branches

- PM editor action receives project root; every worker action receives its owned task worktree.
- File-manager, terminal, configured editor, and alternate-editor operations validate canonical paths.
- Arbitrary paths, stale/deleted worktrees, and foreign task IDs fail closed.
- Remote/unsupported environments render a clear disabled reason rather than launching locally.
- Branches normalize task type/title into `ged/<type>/<slug>`, respect Git ref/length rules, and resolve
  collisions as `-2`, `-3`, etc. Concurrent creation cannot select the same branch.
- Existing task branches remain unchanged.

## End-to-End Scenarios

1. Cheap work leaves uncommitted files → PM reviews and commits → Smart verification records current
   HEAD → approval → land → PR → task auto-archives.
2. Work leaves bad files → PM discards them → no commit relative to base → No changes needed → archive.
3. Cheap work is inadequate → PM diagnoses → Smart retry in same task → review → fresh verification.
4. PM receives a one-line low-risk request in a dirty checkout → edits overlapping file → reviews hunks
   → focused check → direct commit with no task.
5. Upgrade with legacy role models → deep-link to task → mandatory mapping wizard → configure global and
   project presets → Orchestrator unlocks.
6. New project with stub guidance → prompt in Chat → choose Smart → context run → Revise → Commit → PM
   surface observes completion without a duplicate prompt.
7. Worker header opens configured editor and terminal in its task worktree; PM header opens project root.
