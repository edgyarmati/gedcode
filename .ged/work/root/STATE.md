# State

- **Phase**: implement (post-July-13 roadmap resumed; PM startup reliability is first).
- **Active task**: `ORCH-TASK-04` — add explicit supersession relationships for intentional task
  replacement.
- **Roadmap source**: `.ged/work/root/SPEC.md`, `TASKS.md`, and `TESTS.md`.
- **Execution rule**: one bounded slice at a time; do not batch the roadmap.
- **Deferred by user**: `ORCH-ORDER-01` server-enforced canonical pipeline ordering.
- **Worker policy**: GPT-5.6 Terra/high for medium work; GPT-5.6 Sol/high for difficult or
  cross-cutting work. Current `setTaskBackend` can enforce the model but not reasoning effort;
  `ORCH-BACKEND-01` tracks that gap.

## Current Progress

- `ORCH-PMBOOT-01` is complete. Live diagnostics of the `loc-speach` PM proved its first Claude turn
  opened two `command_execution_approval` requests for read-only Bash exploration and stalled because
  the PM surface cannot resolve approvals. Claude PM sessions now opt into the adapter's explicit
  read-only policy, which auto-allows built-in read/search and orchestration MCP tools while denying
  shell/write tools immediately. The PM prompt accurately describes the constrained surface.
- Final `ORCH-PMBOOT-01` verification passed on 2026-07-14: 107 focused provider/runtime tests,
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, and `bun run test` across all 12
  packages. The first sandboxed full run failed only where tests could not bind loopback ports; the
  required unsandboxed rerun passed.
- Planning artifacts refreshed for the Orchestrator completion roadmap on 2026-07-10.
- All prior orchestration tasks are terminal/abandoned, but remain in the ledger because task deletion is
  not implemented.
- `ORCH-LC-01` and `ORCH-LC-02` are complete on `main` in commits `7ef9c07c2`, `24827fed6`, and
  `c1bdaca7d`.
- Cancellation now reserves the task durably, serializes against worker startup, checkpoints provider
  interrupt/session stop/thread close, records retryable failures, and abandons only after shutdown.
- Direct abandonment of a live task is internal-only. Projection snapshots, SQL persistence, live event
  subscriptions, and the web store all carry the cancellation state.
- `ORCH-LC-03` is complete: startup reconciliation resumes durable cancellation reservations before
  provider/task reactors start, skips checkpointed phases, does not resurrect missing provider sessions,
  and retries transient failures with bounded backoff.
- Final `ORCH-LC-03` verification passed: `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and the clean root `bun run test` rerun (server 1,360 passed/1
  skipped; web 1,214 passed). One unrelated server-router bootstrap test flaked on the first root run and
  then passed 71/71 in isolation before the clean root rerun.
- `ORCH-LC-04` is complete. Restart reconciliation now durably interrupts orphaned current stages,
  settles the PM exactly once, clears the active-stage pointer, and permits a fresh same-role handoff.
  Reconciliation is serialized with worker lifecycle changes and rechecks provider liveness under the
  task lock so it cannot interrupt a worker that became live during startup.
- Final `ORCH-LC-04` verification passed on 2026-07-11: `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,373 passed/1 skipped; web 1,215 passed).
- `ORCH-LAND-01` is complete. The PM and both Claude/Codex MCP transports now expose one shared,
  lifecycle-locked `landTask` executor. Landing is idempotent, rejects an active worker stage, and only
  accepts the latest content-matched approved land gate, preventing stale approvals from authorizing a
  newer task state.
- Final `ORCH-LAND-01` verification passed on 2026-07-11: `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,381 passed/1 skipped; web 1,215 passed).
- `ORCH-LAND-02` is complete. A typed client RPC now delegates to the same guarded landing executor as
  PM/MCP. Task detail offers landing only for the exact server-valid gate state and distinguishes request
  pending/error, PR opening/failure, and final PR-link states without contradictory terminal labels.
- Final `ORCH-LAND-02` verification passed on 2026-07-11: focused server/integration/web/browser tests,
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test`
  (server 1,382 passed/1 skipped; web 1,218 passed).
- `ORCH-LAND-03` and `ORCH-LAND-04` record follow-up reliability work discovered during LAND-02: the
  current aggregate still infers PR-opening/failure outside a first-class task substate, and exhausted PR
  creation has no explicit retry actuator.
- `ORCH-WT-01` is complete. TaskWorktreeReactor now buffers its hot domain-event subscription before
  capturing one startup snapshot, processes that snapshot, durably replays later events, and deduplicates
  replay/live overlap by sequence before the serial terminal-task worker.
- Final `ORCH-WT-01` verification passed on 2026-07-11: focused reactor and persistence-backed landing
  race tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and
  `bun run test` (server 1,384 passed/1 skipped; web 1,218 passed).
- `ORCH-LAND-03` is complete in commit `5e52b8859`. Task landing now records durable `opening-pr`,
  `failed`, and `completed` outcomes across contracts, replay, SQL projections, snapshots, live events,
  and the web store. Exhausted failures retain actionable detail, branch-push state, and the worktree;
  startup leaves them stable for the explicit retry actuator instead of retrying implicitly.
- Final `ORCH-LAND-03` verification passed on 2026-07-12: focused contract/decider/projector/SQL/reactor,
  real-engine integration, and web tests; `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`,
  `bun run build`, and two clean `bun run test` runs. The final run had server 1,390 passed/1 skipped and
  web 1,219 passed.
- `ORCH-LAND-04` is complete in commit `9a30ebdcd`. The shared `landTask` actuator now converts an
  exhausted durable failure into an explicit retry event, coalesces concurrent/in-progress calls, reuses
  an existing pull request when present, gives each retry attempt independent failure identity, and
  exposes the same guarded behavior through PM, MCP, RPC, and task detail.
- Final `ORCH-LAND-04` verification passed on 2026-07-12: focused contract/decider/projector/reactor/PM,
  real-engine integration, and browser tests; `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,397 passed/1 skipped; web 1,219 passed).
- `ORCH-WT-02` is complete in commit `4c6210452`. Live tasks now publish atomic ownership leases outside their worktree,
  renew them before every orphan scan, and establish them both from startup state and post-snapshot task
  creation. Foreign runtimes fail safe on active, malformed, or unreadable leases and require lease
  expiry plus a 30-minute grace window before cleanup; terminal cleanup releases the lease.
- Final `ORCH-WT-02` verification passed on 2026-07-12: 23 focused reactor tests and a real
  two-runtime/two-database shared-workspace integration test; `bun fmt`, `bun lint` (existing warnings
  only), `bun typecheck`, `bun run build`, and `bun run test` (server 1,402 passed/1 skipped; web 1,219
  passed).
- `ORCH-TASK-01` is complete in commit `70720baca`. Settled terminal tasks now support append-only
  archive, restore, and permanent-delete tombstones. Replay and command state retain full task history,
  while active SQL/project queries, snapshots, PM ledgers, live web state, and the task board omit
  archived/deleted tasks. Live, cancelling, incompletely landed, archived, and deleted task transitions
  are rejected by the decider as appropriate.
- Final `ORCH-TASK-01` verification passed on 2026-07-12: focused contract, decider, projector, SQL,
  migration, engine, PM, transport, and web-store tests; `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,413 passed/1 skipped; web 1,220 passed;
  contracts 61 passed; all 12 packages successful).
- `ORCH-TASK-02` is complete in commit `ae991db7d`. PM and MCP now expose archive, restore, and
  permanent-delete tools; typed RPC/client APIs provide the same actions plus archived-task lookup.
  Terminal task cards expose copy/archive/restore/confirmed-delete context menus, and the board shows
  archived tasks in a collapsible section. Restore events carry the task projection so open clients
  rehydrate immediately; archived lookup refreshes only on task membership changes, not stage activity.
- Final `ORCH-TASK-02` verification passed on 2026-07-12: focused contract/server/PM/MCP/client/store
  tests and 9/9 Chromium interactions; `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`,
  `bun run build`, and `bun run test` (server 1,414 passed/1 skipped; web 1,221 passed; all 12 packages
  successful).
- `ORCH-TASK-03` is complete in commit `879572049`. `createTask` now requires a stable key tied to the
  originating PM request and logical task. Canonical project/key inputs derive one safe task identity;
  canonical task content derives the command receipt, so exact retries emit one task event/worktree and
  changed content under the same key is rejected instead of silently duplicated.
- Final `ORCH-TASK-03` verification passed on 2026-07-12: PM/MCP/Claude adapter tests and a real-engine
  receipt/event/read-model test; `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`,
  `bun run build`, and a clean `bun run test` rerun (server 1,416 passed/1 skipped; web 1,221 passed; all
  12 packages successful).
- `ORCH-POLL-01..03` are complete in commit `e45e81a19`. Characterization found no recurring server
  timer: the PM system prompt itself instructed the model to poll `inspectStage`. The prompt now forbids
  recurring inspection and relies on the existing settlement, gate, quota, and interrupt re-entry
  events. Explicit status inspection remains available through the already-bounded structured digest.
- Final polling verification passed on 2026-07-12: PM prompt tests and existing bounded-digest tests;
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test`
  (server 1,416 passed/1 skipped; web 1,221 passed; all 12 packages successful).
- `ORCH-INT-01` is complete in commit `6a81412fd`. One lifecycle-locked actuator now serves PM/MCP,
  typed RPC, and task detail. It durably records the interrupt request and acknowledges it immediately;
  the existing provider reactor sends the provider interrupt without waiting for the PM turn. A later
  provider `interrupted`/`cancelled` completion settles the task as operator-interrupted instead of
  flowing through ordinary stage completion and its diff timeout.
- Final `ORCH-INT-01` verification passed on 2026-07-12: 217 focused server tests, 72 router tests, 20
  web client tests, 10 Chromium interactions, `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,419 passed/1 skipped; web 1,221 passed;
  all 12 packages successful).
- `ORCH-INT-02` is complete in commit `57eca50f1`. Active Codex turns now use app-server
  `turn/steer` with `expectedTurnId`; OpenCode reports live steering and Claude reports queuing into the
  active turn. Provider delivery is persisted as started, steered, or queued activity, while rejection
  remains explicit. Codex steering never falls back silently to a new turn, interrupt, or restart.
- Final `ORCH-INT-02` verification passed on 2026-07-12: 197 focused provider/orchestration tests and
  191 contract tests; `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`,
  and `bun run test` (server 1,424 passed/1 skipped; web 1,221 passed; all 12 packages successful).
- `ORCH-EMPTY-01` is complete in commit `a817631f6`. Active task detail now omits Plan and Gates
  entirely until a proposed plan or gate exists; populated rendering is unchanged.
- Final `ORCH-EMPTY-01` verification passed on 2026-07-12: 11 Chromium interactions, `bun fmt`,
  `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test` (server
  1,424 passed/1 skipped; web 1,221 passed; all 12 packages successful).
- ACCESS-01 and ACCESS-02 are intentionally one atomic slice: stage creation and provider startup both
  enforce the old opt-in, so changing only one would produce misleading projections or runtime downgrade.
  The repository has no strict `read-only` RuntimeMode literal; PM will use existing
  `approval-required`, which maps Codex to its read-only/on-request sandbox policy, instead of the current
  full-access PM mode. No compatibility fallback will be added.
- `ORCH-ACCESS-01/02` are complete. Worker stage projections and provider sessions now resolve to one
  unconditional `full-access` policy, while PM projections, starts, resumes, and resets use the existing
  `approval-required` policy. Global/project opt-ins were removed from contracts, resolution, persistence
  allowlists, settings UI, and save paths; legacy keys remain decode-tolerant but inert and are omitted
  when saved.
- Final `ORCH-ACCESS-01/02` verification passed on 2026-07-12: `bun fmt`, `bun lint` (existing warnings
  only), `bun typecheck`, `bun run build`, and `bun run test` (all 12 packages; server 1,421 passed/1
  skipped, web 1,221 passed).
- `ORCH-PMTH-01` is complete in commit `c967546af`. The documented policy pins one deterministic PM
  thread per project, one fresh provider thread per stage attempt, steering on the selected existing
  attempt, and ordered retry linkage through task stage history.
- Final `ORCH-PMTH-01` verification passed on 2026-07-12: 107 focused policy tests, `bun fmt`, `bun lint`
  (existing warnings only), an isolated clean `bun typecheck` rerun after a transient parallel tsgo
  failure, `bun run build`, and `bun run test` (all 12 packages; server 1,423 passed/1 skipped, web 1,221
  passed).
- `ORCH-PMTH-02` is complete in commit `c32a8317b`. PM task-ledger results now contain compact task
  summaries, total attempt counts, and at most three recent attempt records instead of unbounded task
  aggregates. Ledger snapshots and automatic stage/gate re-entry messages carry last-action cursors.
- Final `ORCH-PMTH-02` verification passed on 2026-07-12: 75 focused PM runtime/tool tests, `bun fmt`,
  `bun lint` (existing warnings only), a clean isolated `bun typecheck` rerun after the known workspace
  dependency-resolution race, `bun run build`, and `bun run test` (all 12 packages; server 1,424
  passed/1 skipped, web 1,221 passed).
- All tasks designated urgent through the July 13 cutoff are complete. Remaining `DEFERRED` work stays
  scheduled for after 2026-07-13; canonical pipeline ordering remains explicitly user-deferred.
- `UI-COLLAPSE-01` is complete in commit `cb4b277c3`. Shared content headers across Chat, empty-chat,
  Orchestrator, browser Settings, and Electron Settings now expose the desktop off-canvas toggle; the
  existing persisted cookie restores state and the trigger reflects desktop/mobile expansion correctly.
- Final `UI-COLLAPSE-01` verification passed on 2026-07-12: focused unit tests, 193/193 Chromium
  interactions across 15 files, `bun fmt`, `bun lint` (existing warnings only), a clean isolated
  `bun typecheck` rerun after the known workspace dependency-resolution race, `bun run build`, and
  `bun run test` (all 12 packages; server 1,424 passed/1 skipped, web 1,223 passed).
- Follow-up commit `da576baf0` fixes the macOS traffic-light overlap revealed by manual Electron QA.
  One shared conditional titlebar inset now protects Orchestrator, active Chat, empty Chat, and Settings
  only while the Electron sidebar is collapsed; browser and expanded layouts keep their prior spacing.
- Follow-up verification passed on 2026-07-13: 193/193 Chromium interactions, focused inset policy tests,
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and a clean
  `bun run test` rerun (server 1,424 passed/1 skipped, web 1,224 passed). The first full run had one
  unrelated server-router flake, which passed 72/72 in isolation before the clean rerun.
- Responsive follow-up commit `8c5422ce1` prevents `sm:px-*` header utilities from overriding the
  collapsed Electron inset. A Chromium computed-style test combines the real responsive padding with
  the shared rule and confirms 90px of macOS window-control clearance at desktop width.
- Responsive follow-up verification passed on 2026-07-13: 194/194 Chromium interactions, `bun fmt`,
  `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test` (server
  1,424 passed/1 skipped, web 1,224 passed; all 12 packages successful).

## July 13 Working Cutoff

- Before/through 2026-07-13, prioritize `ORCH-POLL-01..03`, `ORCH-INT-01..02`, `ORCH-EMPTY-01`,
  `ORCH-ACCESS-01..02`, and then `ORCH-PMTH-01..02` if time remains.
- Defer supersession, task splitting, normal-chat fork, composer draft persistence, sidebar/context-menu
  polish, permission display, reasoning-effort metadata, task-type registry, and release workflow until
  after 2026-07-13.

## Immediate Sequence

1. None active. Resume deferred items after 2026-07-13 in roadmap priority order.

## Repository State Notes

- Preserve existing untracked `release-dev/`, `release-local/`, and `release-local-fixed/` directories.
- Prior `.ged/work/root` plans remain recoverable from git history.
- Required checks are `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`; never use `bun test`.
