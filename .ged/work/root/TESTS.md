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

### ORCH-WORK-02 — 2026-07-17

- Focused: decider, checkpoint reactor with real Git worktrees, provider-runtime ingestion, and PM
  settlement replay tests passed.
- Manual review: both tracked and untracked changes enter Change review; clean work settles normally;
  the dirty completion and review request share one atomic decision; duplicate/restarted review events
  produce one PM re-entry; verify startup rejects a pending review.
- Repository: `bun fmt`, `bun lint`, and `bun typecheck` passed. Lint retained only pre-existing
  warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages; server 181/181 files, 1,490 passed and 1 skipped.

### ORCH-WORK-03 — 2026-07-17

- Focused: task change-review Git integration, PM/MCP tools, decider, in-memory/SQL projection, and PM
  runtime suites passed (191 tests).
- Manual review: exact patch hunks commit without absorbing selected-out edits; selected tracked and
  untracked discard preserves unrelated files; foreign paths, unknown tasks, pre-staged indexes, and
  non-descriptive commits fail closed; partial mutation refreshes pending review at the new HEAD;
  return starts a fresh work stage and records the prior review as returned.
- Repository: `bun fmt`, `bun lint`, and `bun typecheck` passed. Lint retained only pre-existing
  warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages; server 182/182 files, 1,498 passed and 1 skipped.

### ORCH-WORK-04 — 2026-07-17

- Focused: decider, checkpoint/provider-runtime ingestion, PM tools, landing actuator, in-memory/SQL
  projection, and landing/pipeline integration suites passed.
- Manual review: clean verification completion atomically records the exact inspected HEAD and returns
  the task to review; dirty verification never records success; land-gate request, human approval,
  initial landing, and landing retry each reject a dirty or mismatched HEAD.
- Repository: `bun fmt`, `bun lint`, and `bun typecheck` passed. Lint retained only pre-existing
  warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages; server 182/182 files, 1,501 passed and 1 skipped.

### ORCH-WORK-05 — 2026-07-17

- Focused: no-change Git evidence, decider, PM/MCP tools, in-memory/SQL projections, worktree reactor,
  and real-Git landing integration suites passed (213 tests).
- Manual review: no-change completion requires a clean task branch whose HEAD equals its creation
  reflog; no-change and PR success archive atomically; startup repair archives legacy successes and
  converts only empty landed branches without a recorded PR failure; failed landing remains retryable.
- Repository: `bun fmt`, `bun lint`, and `bun typecheck` passed. Lint retained only pre-existing
  warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages; server 183/183 files, 1,504 passed and 1 skipped.

### ORCH-TIER-02 — 2026-07-18

- Focused: migration state and exact-decision validation (3 tests), web RPC/environment forwarding
  (20 tests), settings-bypass persistence, and ordinary post-migration Orchestrator websocket routes
  passed.
- Manual review: only live projects with legacy role selections are enumerated; duplicate, missing,
  and unknown project decisions fail closed; project overrides persist before the global completion
  marker; generic settings writes cannot install the marker; repeated inspection reads the persisted
  completed state; all non-migration `orchestrator.*` RPCs share the server gate.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages; server 185/185 files, 1,520 passed and 1 skipped.

### ORCH-TIER-03 — 2026-07-18

- Focused: preset-draft validation passed 2 tests; Chromium passed 2 required-wizard scenarios for
  deep-link blocking, explicit Cheap/Smart/Genius selection, completion, and remount persistence.
- Manual review: the shared `/_orch` boundary owns the gate, has no dismiss path, and derives the
  environment from deep links before the active/primary fallback. Every legacy project requires an
  explicit inherit/customize decision; customization requires a real override; completed migrations
  skip provider loading and restore all nested content.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 11m09s; web 114/114 files and 1,238 tests; server 185/185 files with
  1,520 passed and 1 skipped.

### ORCH-TIER-04 — 2026-07-18

- Focused: 17 settings serialization/equality tests passed; Chromium passed 2 settings scenarios for
  global Cheap/Smart/Genius cards, provider logos, inherited project presentation, override/reset,
  and thinking-option reconciliation.
- Manual review: global presets remain a complete atomic map; project presets serialize only explicit
  overrides; inherited cards display the effective global provider; the retired role backend controls
  are absent while Plan/Work/Verify prompt prefixes remain independently editable.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 10m53s; web 114/114 files and 1,238 tests; server 185/185 files with
  1,520 passed and 1 skipped.

### ORCH-TIER-05 — 2026-07-18

- Focused: contracts passed 64 tests; server decider, PM/MCP, projection, migration, quota retry, and
  routing suites passed 285 tests; restart/pipeline integrations passed 4 tests; Chromium passed the
  task-tier settings scenario.
- Manual review: task overrides contain only semantic Plan/Work/Verify tiers; every PM handoff requires
  an explicit tier; attempt history exposes the immutable tier and resolved backend; quota and rework
  resume without escalation; prompts reserve higher-tier retries for diagnosed result-quality or
  capability shortfalls.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 10m55s; web 114/114 files and 1,238 tests; server 188/188 files with
  1,524 passed and 1 skipped.

### ORCH-HELPER-01 — 2026-07-18

- Focused: helper contracts passed 3 tests; server decider, migration, SQL projection, replay,
  retention, PM-thread attachment lookup, and terminal-task rejection passed 5 tests.
- Manual review: helper runs form their own aggregate and projection, attach only to an owned PM
  thread or active task, stamp the resolved capability backend at request time, retain provider-thread
  identity across replay, and expose no task lifecycle, worktree, gate, commit, PR, or landing fields.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 10m55s; web 114/114 files and 1,238 tests; server 191/191 files with
  1,529 passed and 1 skipped.

### ORCH-HELPER-02 — 2026-07-18

- Focused: helper reactor, context injection, Codex/OpenCode/Claude adapter policies, helper lifecycle,
  orchestration startup, and stage resolution passed 142 tests across 11 files.
- Manual review: PM helpers use only the project root; task helpers require an existing owned
  worktree and never provision one. Provider sessions receive read-only policy, orchestration tools
  are disabled, output is bounded and secret-scrubbed, completed task results enter subsequent stage
  context, quota recovery resumes pending runs without polling, and restart reuses the stable helper
  identity without another lifecycle start.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 11m33s; web 114/114 files and 1,238 tests; server 194/194 files with
  1,537 passed and 1 skipped.

### ORCH-HELPER-03 — 2026-07-18

- Focused: PM/MCP tools, PM settlement recovery, live WebSocket filtering, web projection/selectors,
  timeline logic, and Chromium passed. Server coverage passed 170 tests across 4 files; web coverage
  passed 81 unit tests and 20 Chromium scenarios.
- Manual review: helper identity remains stable across exact retries while changed prompts or tiers
  reach conflict validation; blank task attachment normalizes to the PM. Terminal helpers re-enter the
  PM exactly once, including after quota recovery. Project and task snapshots plus live streams retain
  their scoped helpers, while helpers create no task-board, gate, worktree, commit, PR, or landing row.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 11m32s; server 194/194 files with 1,541 passed and 1 skipped.

### GED-SKILL-01 — 2026-07-18

- Focused: the vendored skill contract passed 2 tests; GED prompt and provider-delivery coverage
  passed 47 tests. The contract compares Codex/Claude mirrors and pins one-question interviewing,
  recommended answers, environment lookup, inline root glossary capture, root-only context paths,
  all three sparse-ADR conditions, GED state handoff, and the upstream license/source commit.
- Manual review: `grill-with-docs` composes the upstream `grilling` and `domain-modeling` disciplines;
  only the GED clarify-to-plan flow and canonical root `CONTEXT.md`/`docs/adr/` constraint are adapted.
  The retired live `grill-me` skill and prompt references are removed without reviving the deleted
  runtime checkpoint subsystem or adding compatibility fallback behavior.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 11m14s; server 194/194 files with 1,542 passed and 1 skipped.

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
