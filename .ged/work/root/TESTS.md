# TESTS — Orchestrator Delegation and Project Context

Every ordinary implementation slice runs focused tests, `bun fmt`, `bun lint`, and the narrowest
relevant package typechecks. Full workspace test/typecheck suites are reserved for an explicit release
or major verification request. Never use `bun test`; use `bun run test` with focused paths. User-visible
changes must update `CHANGELOG.md` under `## Unreleased`.

## Verification Evidence

## Manifest-first Context Pivot

### PROJECT-MANIFEST-01

- Parse strict committed manifest metadata and reject unsupported/malformed data without mutation.
- Adopt `.ged/VERSION` once, delete it after successful migration, and treat unversioned artifacts as
  schema zero. A newer schema is never downgraded.
- Prove one version covers canonical context and task-work conventions while `.gedcode/` remains
  runtime-only.

#### Evidence — 2026-07-21

- Focused parser, filesystem-adoption, and context-schema tests passed 9/9.
- Manual review confirmed atomic manifest replacement precedes legacy removal, repeated adoption is
  idempotent, malformed data fails closed, and a newer schema cannot be rewritten.
- `bun fmt`, `bun lint`, and all 12 workspace typecheck packages passed. Existing unrelated lint
  warnings remain; no full test suite was run per the ordinary-work policy.

### PROJECT-MANIFEST-02/03

- First GED/Orchestrator use and the before-PM-turn backstop initialize/migrate exactly once and use
  Smart by default without empty stubs or a mandatory modal.
- PM user/automatic delivery stays held through mutation and audit; ordinary Chat stays usable.
- Clean additive changes settle uncommitted. Non-overlapping concurrent edits merge; ambiguous overlap,
  protected Git changes, and scope violations remain Needs attention with retry/PM recovery.
- Compact status, manual review, active-turn Wait/Interrupt, composer locking, restart, and queue ordering
  work without legacy dismissal or Commit/Revise/Discard UI.

### PROJECT-MANIFEST-04

- Prompt snapshots assign PM/planner/worker/verifier ownership and disclose worker sandbox limits.
- Planner/verifier mutations outside documentation fail; workers commit code/task progress; verifier
  records tests and canonical context separately. Code repair returns to worker and invalidates evidence.
- Landing rejects missing/stale verification or required context/manifest settlement.

### PROJECT-MANIFEST-05/06

- Worktrees start only from a refreshed clean primary branch. Dirty/diverged state and missing Git or
  GitHub remote produce explicit setup/decision states without a local-main fallback.
- Target movement updates the task branch and requires fresh verification. GitHub access failure keeps
  committed work Ready to land; success creates a documented draft PR by default.
- Legacy active context runs settle as cancelled-by-upgrade; removed APIs cannot create new legacy runs;
  replay/restart and artifact documentation reflect the manifest lifecycle.

### PROJECT-RECOVER-01 typed-conflict checkpoint — 2026-07-21

- Focused real-Git review and coordinator suites passed 12/12, including typed HEAD and owned-context
  drift evidence. Focused Chromium review-dialog coverage passed 2/2.
- Manual review: Commit and Revise are disabled for a typed conflict; Retry re-inspects current state;
  Discard remains available as the explicit terminal recovery action.

### PROJECT-LOCK-01 / PROJECT-LOCK-02 — 2026-07-21

- Focused server: context decider, PM runtime/queue, context reactor, SQL projection, and migration 063
  passed 105 tests. Coverage includes active-PM arbitration, restart reconciliation, baseline refresh,
  interrupt-before-start, held queue preservation, and durable start-state persistence.
- Focused web: Orchestrator route/composer logic passed 45 tests; Chromium composer coverage passed
  7 tests and confirms the PM surface remains visible while ordinary message input is disabled.
- Repository: `bun fmt` and `bun lint` passed with only existing unrelated warnings. Contracts, server,
  and web package typechecks passed. Per user direction, no full workspace suite was run.
- Manual review: pre-start cancel terminally releases the hold; failed/interrupted runs with residue
  remain pending review; PM access and structured input controls remain usable while ordinary message
  delivery is held; queued drain entries are not removed until policy permits delivery.

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

### PROJECT-CTX-01 — 2026-07-18

- Focused: 180 tests passed across the pure scanner, filesystem security, contracts, decider,
  projector, replay pipeline, migration, repositories, snapshot queries, engine shell routing, and
  WebSocket project isolation.
- Manual review: scanning is a bounded allowlist over the four canonical files and non-recursive root
  ADR Markdown, with explicit missing/empty/whitespace/template/substantive states. Semantic hashes
  normalize comment and formatting noise; `.gedcode/`, task memory, unrelated/generated files, nested
  ADRs, escaping symlinks, invalid UTF-8, oversized content, and non-regular files cannot enter the
  snapshot. Mixed real context recommends Review; all-stub context recommends Populate.
- Persistence review: Dismissed and Completed resolutions are append-only project events keyed to the
  exact scanner schema and fingerprint. The latest resolution survives replay, SQL restart, snapshots,
  and shell/project streams; legacy NULL means onboarding is required rather than silently completed.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings outside this slice.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 11m06s; server 197/197 files with 1,560 passed and 1 skipped.

### PROJECT-CTX-02 — 2026-07-20

- Focused: contracts passed 70 tests; project-context scanner, exact workspace/Git metadata audit,
  decider, coordinator, reactor, SQL migration/projection, replay, and snapshots passed 84 tests; live
  WebSocket request routing and mandatory-preset-migration gating passed 2 tests.
- Manual review: the public request accepts only project ID and optional capability tier; the server
  captures and atomically binds the baseline to the current primary checkout. Runs stamp the resolved
  backend, use provider-native writable policy with orchestration tools disabled, and create no task,
  worktree, stage, gate, commit, PR, or landing state. Git-visible checkout changes plus HEAD, index,
  refs, local config, hooks, and Git info metadata are audited without staging or repair. Ignored files
  and paths outside the checkout remain the explicit trusted-provider boundary selected for this flow.
- Recovery review: project deletion and workspace relocation are rejected while a run is active;
  interleaved request races fail closed. Known quota resets schedule one scoped wake-up without
  polling. Restart preserves a provably active session, while an orphaned writable run is audited into
  pending review or interrupted without replaying its prompt.
- Repository: `bun fmt`, `bun lint`, and all 12 `bun typecheck` packages passed. Lint retained only
  existing warnings.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages in 11m30s; web 115/115 files and 1,242 tests; server 203/203 files with
  1,601 passed and 1 skipped.

### PROJECT-CTX-03 — 2026-07-20

- Focused: contracts settings/RPC schemas passed 105 tests; server onboarding coordinator,
  project-context run coordinator, migration guard, and WebSocket routing passed 84 tests; web route
  logic passed 3 tests; Chromium passed 4 scenarios for Populate/Review copy, file classifications,
  dismissal, fingerprint re-prompt, Chat/Orchestrator query reuse, sticky tier selection, and effective
  harness logo/model/thinking presentation.
- Manual review: the shared root coordinator derives project identity from Orchestrator, normal-chat
  thread, and draft routes and retains one React Query identity across surface switches. Browser-facing
  scans contain only path/classification metadata, never raw context. The dialog cannot close through
  Escape, backdrop, or a close button; only explicit Dismiss or Start settles it. Dismissal rescans and
  rejects stale schema/fingerprint state, while matching pending/running/pending-review runs suppress
  duplicate prompts. Orchestrator preset migration still guards dismissal and run startup; only the
  read-only scan is inspectable before migration.
- Preset review: project overrides resolve over global Cheap/Smart/Genius presets for display. Smart
  is the schema and UI factory default. Explicit run selection persists the global default server-side
  before dispatch, and omitted tiers resolve that durable value while every run still stamps its exact
  selected backend.
- Repository: `bun fmt` and `bun lint` passed with only existing warnings. All 12 `bun typecheck`
  packages passed with `TURBO_CONCURRENCY=1 GOMAXPROCS=1`; an earlier desktop-package attempt hit a
  native `tsgo` SIGSEGV without a TypeScript diagnostic and passed immediately when rerun alone and in
  the full root gate at conservative concurrency.
- Full: `bun run test` passed outside the sandbox because existing loopback tests require socket
  binding: 12/12 packages; server 204/204 files. The focused Chromium suite is separate from the
  default unit-test workspace gate and passed independently.

### PROJECT-CTX-04 — 2026-07-20

- Focused: contract schemas passed 71 tests; server lifecycle, projection, coordinator, persistence,
  and WebSocket coverage passed 76 tests; the real-Git review suite passed 5 tests; web state and route
  logic passed 189 tests; Chromium passed 6 review/onboarding scenarios.
- Review lifecycle: pending review is durable and shared by normal Chat and Orchestrator. The mandatory
  dialog presents the persisted summary, exact changed paths and diff, scope violations, and proposed
  commit message. Revise records feedback and reruns the same context aggregate from its original
  baseline; Commit and confirmed Discard are the only terminal choices.
- Git safety: commit uses a fresh compare-and-swap preflight, refuses staged state, stale files, Git
  metadata drift, scope violations, and overlapping provider/user edits, then commits only the exact
  provider delta with a context-run trailer. Same-file pre-existing user hunks remain unstaged. Discard
  restores exact baseline bytes without path-wide cleanup and preserves unrelated work.
- Resolution: commit/discard atomically settle the run and project onboarding fingerprint. No context
  review action creates a task, stage, gate, worktree, pull request, or landing record; live streamed
  projection updates close the dialog without polling or a refetch race.
- Repository: `bun fmt`, `bun lint`, and all 12 typecheck packages passed; lint retained only existing
  warnings. Full `bun run test` passed all 12 packages in 12m11s, including web 116/116 files and
  1,245 tests. Focused Chromium passed independently.

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

### ORCH-OPEN-01 — 2026-07-20

- Focused: contract launch schemas and orchestration schemas passed 73 tests; strict external launcher
  and ownership coordinator suites passed 25 tests; typed WebSocket capability/ownership routing
  passed 2 loopback tests; web transport routing passed 2 tests.
- Security review: requests contain only a logical project root or project-qualified task ID and an
  operation—never a filesystem path. The server derives the registered project root or exact
  deterministic task worktree, rejects foreign project/task pairs, terminal tasks without ownership,
  forged worktree locations, deleted/non-directory targets, and projection failures before launch.
- Capability review: each environment reports installed editor IDs plus file-manager and terminal
  availability. Unsupported capabilities fail distinctly from detached-process spawn failures. The
  general Chat `shell.openInEditor` RPC remains unchanged because its in-project file targets are a
  separate compatibility boundary.
- Repository: `bun fmt`, `bun lint`, and all 12 typecheck packages passed; lint retained only existing
  warnings. Full `bun run test` passed all 12 packages in 12m05s.

### ORCH-OPEN-02 — 2026-07-20

- Focused: shared branded editor-option logic and existing Orchestrator route logic passed 7 tests.
  Chromium passed 23 scenarios across the new launch picker and existing route suite.
- Project/worker targeting: project chrome dispatches only `{ kind: "project-root", projectId }`;
  worker chrome dispatches only the project-qualified task-worktree target. Primary buttons use the
  preferred installed editor; alternate selection persists as the new preference. Menus cover every
  available branded editor, file-manager reveal, and terminal launch.
- Availability/layout: capabilities come from the selected environment rather than the local shell.
  Unsupported/older environments, empty capability sets, and tasks without worktrees keep both
  controls disabled with an explicit reason. Project and task header action groups wrap under compact
  widths. Launch failures surface as an error toast.
- Repository: `bun fmt`, `bun lint`, and all 12 typecheck packages passed; lint retained only existing
  warnings. Full `bun run test` passed all 12 packages in 12m08s (server 207/207 files, 1,619 passed
  and 1 skipped). Focused Chromium passed independently.

### ORCH-BRANCH-01 — 2026-07-20

- Naming: 16 shared Git utility cases cover task-type/title normalization, diacritics, punctuation,
  empty/non-ASCII fallbacks, total length bounds, and collision suffixes beginning at `-2`.
- Reservation: 3 real-Git cases prove collisions produce `-2`/`-3`, four concurrent requests never
  reuse a ref, and compensation deletes only the exact unchanged reservation. The PM reuses durable
  or in-flight task identities and compensates reservations when task/split dispatch fails.
- Provisioning/compatibility: focused PM, MCP, Claude adapter, decider, provider reactor, and mocked
  end-to-end suites prove newly persisted `ged/*` refs are attached without `git worktree add -b`.
  Existing `orchestrator/*` task branches retain their previous creation path and are not migrated.
- Repository: `bun fmt`, `bun lint`, and all 12 typecheck packages passed; lint retained only existing
  warnings. Final `bun run test` passed all 12 packages in 12m09s; server passed 208/208 files with
  1,623 tests passing and 1 skipped. Earlier load-sensitive GitManager and server-router flakes also
  passed as complete isolated files before the clean full-suite result.

### PROJECT-CTX-05 — 2026-07-21

- Regression: the dismissal RPC succeeds while every immediate onboarding refetch intentionally keeps
  returning the old `shouldPrompt: true` fingerprint; the exact prompt must nevertheless close.
- Scope: a different fingerprint remains eligible and prompts after remount, so acknowledgement cannot
  suppress later material context changes.
- Focused result: `ProjectContextOnboardingCoordinator.browser.tsx` passed 4/4 Chromium scenarios. Per
  request, no broad test suite was run.

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

## Legacy landed-task repair

### ORCH-WORK-07 — 2026-07-21

- Decider accepts the evidence-backed no-change transition for a landed-without-PR task even when its
  last landing attempt is marked failed, while retaining the exact clean-HEAD/baseline invariant.
- PM `completeTaskWithoutChanges` can explicitly repair the same legacy terminal state.
- Startup reconciliation archives unchanged legacy landings with a stale failure marker and landings
  whose worktree has already been removed.
- A failed landing whose task branch advanced beyond its creation baseline remains untouched: no PR
  retry, archive, or worktree cleanup occurs.
- Focused result: 155/155 tests passed across `decider.task.test.ts`, `pmTools.test.ts`, and
  `TaskWorktreeReactor.test.ts`; server package typecheck passed. Full `bun run test` passed all 12
  packages (server 208/208 files, 1,626 passed and 1 skipped).

## Project-context review ref churn

### PROJECT-CTX-06 — 2026-07-21

- A new unrelated branch created after the context run no longer blocks Commit.
- Advancing the checked-out branch after the run still rejects mutation as `.git/HEAD` drift.
- Existing real-Git cases continue to protect staged work, stale context files, overlapping user
  changes, selective commits, and exact discard restoration.
- Focused result: `projectContextRunReview.test.ts` passed 7/7; formatting and lint passed. Server
  typecheck remains blocked by the existing Effect beta `Reactivity` module-resolution error. Per
  request, no full suite was run.

## Context settlement and recovery verification plan

### PROJECT-LOCK-01

- Persist a hold before PM arbitration and restore it after process restart.
- Wait lets exactly the active PM turn finish; Interrupt invokes the existing actuator; both start the
  context run before preserved user/automatic re-entry messages.
- Cancel-before-start and clean terminal failure release the hold. Pending review or unsafe residue do
  not. Duplicate events and reconnects do not double-start or double-deliver.

### PROJECT-LOCK-02

- PM route stays mounted while held, composer cannot send through keyboard/button/API, and status plus
  Wait/Interrupt/Cancel actions survive refetch/reconnect.
- Existing queued messages remain editable/deletable but do not dispatch until settlement.

### PROJECT-RECOVER-01/02

- Typed inspection distinguishes retry-only protected Git drift, reconcilable HEAD/workspace/context
  drift, provider scope violations, and ambiguous content overlap.
- Retry is read-only. Reconcile reuses pinned model configuration, records attempts append-only, merges
  clean independent hunks, and never chooses overlapping hunks automatically.

### PROJECT-RECOVER-03

- Hand to PM bypasses only the context hold, cannot create/delegate tasks, exposes bounded question
  cards, and returns to review only after a clean re-audit.
- Ordinary PM input and automatic re-entry remain held throughout remediation and resume once, in
  order, after final settlement.
