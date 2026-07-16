# State

- **Phase**: implement — follow-up queue, artifact, and worker-role slices are planned.
- **Active task**: `CHAT-QUEUE-01` persisted per-thread queue state and operations.
- **Roadmap source**: `.ged/work/root/SPEC.md`, `TASKS.md`, and `TESTS.md`.
- **Execution rule**: one bounded slice at a time; do not batch the roadmap.
- **Pipeline-order decision**: keep `ORCH-ORDER-01` fully deferred because stages may intentionally be
  skipped and the PM model can choose their order. Add only a narrow landing invariant requiring a
  successfully completed verification stage newer than the latest successfully completed work stage.
  Unrelated stages may occur between verification and landing. Apply this uniformly to every task;
  there are no existing user tasks to grandfather and no compatibility fallback should be retained.
- **Chat-fork decision**: use hybrid semantics. Codex uses a provider-native fork and rolls back only
  the new fork to the selected completed turn; the source remains untouched. Earlier-message forks or
  providers without native support use a fresh provider session initialized from copied visible history.
  The UI affordance should mirror Codex/ChatGPT's per-message **Continue in new task** action.
- **Chat-fork filesystem decision**: forking branches conversation history only. The new task retains
  the current filesystem state and never attempts to undo file changes from turns after the selected
  message; this limitation must be clear in the action's accessible description.
- **Chat-fork affordance decision**: show **Continue in new task** only on completed assistant
  messages, matching the reference Codex UI. Do not add the action to user messages or the thread menu.
- **GED-mode decision**: restore only a lightweight normal-chat prompt mode. GED mode supplies workflow
  instructions and skills to the selected main model; Gedcode does not enforce subagents, configure
  role models, or start managed child sessions. Provider-native subagent use is model/runtime-owned.
- **Worker policy**: GPT-5.6 Terra/high for medium work; GPT-5.6 Sol/high for difficult or
  cross-cutting work. `setTaskBackend` now carries the complete provider selection, including effort.
- **Queue decision**: normal-chat queueing is per-thread and enabled by default. Active-turn sends
  capture the full send context into durable FIFO items. Turn settlement drains one item at a time with
  stable command identity; Steer bypasses the wait. Turning queueing off changes future sends only and
  never silently flushes existing items.
- **Role-settings audit**: project/task settings already carry provider instance plus model, but the
  picker drops provider options when instance/model changes and exposes no thinking control. Review the
  classify/plan/review/work/verify taxonomy before changing it because the PM now owns intake, typing,
  splitting, scheduling, gates, landing, and release dispatch.
- **Artifact audit**: distinguish workspace `.ged/` memory, workspace `.gedcode/orchestrator/` runtime
  worktrees/leases/hooks, and user `~/.gedcode/` application state in one lifecycle guide.

## Current Progress

- `CHAT-FORK-02` implementation and focused verification are complete. Completed assistant
  messages expose **Continue in new task** with a current-filesystem tooltip/accessibility description,
  one-operation pending state, typed fork dispatch, error toast recovery, and success navigation. The
  production build, all 1,233 web unit tests, formatting, lint, and 12-package typecheck pass. The final
  focused Chromium run passed all 91 interactions, including visibility boundaries, pending and failure
  recovery, typed dispatch, target projection, and navigation. The final socket-enabled `bun run test
  --output-logs=errors-only` gate passed all 12 package tasks in 11m54s.
- `CHAT-FORK-01` is complete. The typed RPC creates an atomic event-sourced target task from a
  completed assistant-message boundary. Codex uses native `thread/fork` and rolls back only the new
  provider thread for earlier boundaries; other providers continue in a fresh session from copied
  visible history. Both paths leave the source untouched and retain the current filesystem state.
- Final `CHAT-FORK-01` verification passed on 2026-07-16: 63 focused contract tests and 106 focused
  server contract/decider/provider/reactor tests, `bun fmt`, `bun lint` (existing warnings only), `bun
  typecheck` across all 12 packages, and a clean socket-enabled `bun run test
  --output-logs=errors-only` rerun with all 12 package tasks successful in 10m31s. The first full run
  had one unrelated bootstrap-auth server-router flake, which passed immediately in isolation.
- `CHAT-GED-02` is complete. Normal chat composers expose a persisted Normal/GED selector on desktop
  and compact layouts, explain the lightweight workflow in a tooltip/menu description, and propagate
  the choice through thread creation, metadata updates, and every turn-start path. New drafts use a
  global default that is GED-on unless the user disables it in General settings.
- Final `CHAT-GED-02` verification passed on 2026-07-16: 15 focused settings tests, 125 focused web
  logic/store tests, 24 focused compact/settings Chromium interactions, 3 targeted full-Chat Chromium
  flows, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck` across all 12 packages, and
  the complete socket-enabled `bun run test --output-logs=errors-only` gate with all 12 package tasks
  successful in 10m37s.
- `CHAT-GED-01` is complete. Normal chat threads once again persist a lightweight GED-mode flag, with
  GED enabled when no explicit choice exists. Provider-bound GED turns receive bounded guidance for the
  repository's grill-me, planning, execution, and verification skills; stored messages remain pristine,
  Normal prompts remain byte-for-byte unchanged, and no managed subagent or role-model machinery was
  restored.
- Final `CHAT-GED-01` verification passed on 2026-07-16: 61 focused contract tests, 81 focused server
  tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck` across all 12 packages, and the
  complete 12-package `bun run test --output-logs=errors-only` gate in 10m49s.
- `ORCH-LAND-05` is complete. Landing now requires the newest successful verification attempt to have
  completed after the newest successful work attempt. Failed or interrupted verification does not
  qualify; unrelated later stages remain allowed, and no other pipeline ordering is enforced.
- Final `ORCH-LAND-05` verification passed on 2026-07-16: 78 focused decider, actuator, slice, and
  integration tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck` across all 12
  packages after isolating the known resolver race, and the complete 12-package `bun run test
  --output-logs=errors-only` gate in 10m26s.
- `UI-SIDEBAR-02` is complete. Orchestrator project rows now use the app-native context menu for
  rename, orchestration settings, path copy, and guarded removal. Every task card, including active,
  attention, grouped-child, terminal, and archived cards, exposes only actions valid for its durable
  lifecycle state; active cancellation uses the existing typed actuator.
- Final `UI-SIDEBAR-02` verification passed on 2026-07-15: 42 focused unit tests, 18 focused Chromium
  interactions, the full web suite (1,231/1,231), all 200 Chromium interactions, `bun fmt`, `bun lint`
  (existing warnings only), `bun typecheck`, `bun run build`, and the complete 12-package `bun run
  test` gate. The server suite passed 1,454 tests with one skipped.
- `ORCH-REL-02` is complete. Release publishing now requires a content-matched human approval and a
  clean project root before reserving one durable dispatch attempt. The lifecycle lock and persisted
  dispatching state prevent concurrent or post-crash automatic duplicates; success/failure survives
  replay and SQL restart, and PM plus task detail expose the authoritative state and workflow URL.
- Final `ORCH-REL-02` verification passed on 2026-07-15: focused server/web/shared/contract tests,
  `bun fmt`, `bun fmt:check`, `bun lint` (existing warnings only), `bun typecheck`, `bun run
  release:smoke`, and the complete 12-package `bun run test` gate. The server suite passed 1,454 tests
  with one skipped; all 12 packages passed.
- `ORCH-REL-01` is complete in commit `a50cea68e`. The registry now installs a dedicated release
  playbook and every PM runtime receives all registered task-type skills. Release creation records its
  source through the durable dependency projection and requires exactly one visible, fully landed
  feature task with a recorded pull request in the same project. Classification and worker startup
  revalidate that provenance, including replayed tasks, and release tasks cannot be split children.
- Final `ORCH-REL-01` verification passed on 2026-07-15: 149 focused registry/playbook/decider/PM
  tests, all 190 contract tests, the full server suite (1,449 passed/1 skipped), `bun fmt`, `bun lint`
  (existing warnings only), and `bun typecheck`.
- `ORCH-TYPE-01` is complete in commit `a7b960f0f`. Task-type config now carries extensible ids for
  durable replay while one server-owned registry defines installed types and their built-in playbooks.
  Project config writes, PM create/split/classify operations, and authoritative decider boundaries all
  reject unknown types rather than inheriting the feature workflow.
- Final `ORCH-TYPE-01` verification passed on 2026-07-15: 15 focused contract tests, 109 focused
  registry/playbook/decider/PM tests, all 190 contract tests, the full server suite (1,445 passed/1
  skipped), `bun fmt`, `bun lint` (existing warnings only), and `bun typecheck`.
- `UI-SIDEBAR-01` is complete in commit `a63565d44`. Chat and Orchestrator now read and write the
  same persisted project sort preference and physical project order. The Orchestrator sidebar supports
  last-user-message, created-at, and manual modes; manual mode exposes environment-safe drag handles
  and reorders through the existing persisted UI-state operation.
- Final `UI-SIDEBAR-01` verification passed on 2026-07-15: 85 focused sorting/order unit tests, 3
  focused Chromium interactions, the full web suite (1,229/1,229), all 198 Chromium interactions,
  `bun fmt`, `bun lint` (existing warnings only), and `bun typecheck`. The required root test run
  completed 11 of 12 packages; the unchanged server Vitest process was stopped after remaining alive
  without output for more than nine minutes.
- `UI-DRAFT-01` is complete in commit `a254a128d`. The PM composer now uses the existing persisted,
  debounced composer-draft store under the deterministic environment-scoped PM thread identity. Drafts
  survive route/surface unmounts, remain isolated per project, do not collide with interactive question
  answers, and clear only after a successful send.
- Final `UI-DRAFT-01` verification passed on 2026-07-14: 44 focused unit tests, 6 focused Chromium
  interactions, the full web suite (1,229/1,229), `bun fmt`, `bun lint` (existing warnings only), and
  `bun typecheck`. The first Chromium launch timed out before connecting; the clean retry passed.
- `ORCH-SPLIT-04` is complete in commit `18e58d664`. The task board now removes child tasks from
  duplicate top-level buckets, orders them deterministically beneath one collapsible parent, summarizes
  aggregate completion, derives the group bucket from child lifecycle state, and bubbles child gates or
  blockers into Needs you. Standalone archived and terminal actions remain unchanged.
- Final `ORCH-SPLIT-04` verification passed on 2026-07-14: 40 focused rendering/partition tests, 13
  focused Chromium interactions, `bun fmt`, `bun lint` (existing warnings only), and `bun typecheck`.
  The complete web suite passed 1,228/1,228 and all 196 Chromium interactions passed.
- `ORCH-SPLIT-03` is complete in commit `329d3bb4a`. PM policy and the built-in feature playbook now
  distinguish genuinely oversized work from small edits, require two to eight independently verifiable
  ordered children, and use the existing plan gate to approve the complete child graph before one
  idempotent split. Scheduling is limited to unblocked children without a new gate type or pipeline
  enforcement.
- Final `ORCH-SPLIT-03` verification passed on 2026-07-14: 37 focused PM/playbook tests, `bun fmt`,
  `bun lint` (existing warnings only), and `bun typecheck`. The serialized workspace run passed nine
  package suites, including server, and exposed only the existing five-second MessagesTimeline timing
  flake; that test passed 12/12 in isolation and the complete web suite passed 1,226/1,226 with a
  15-second timeout budget.
- `ORCH-SPLIT-02` is complete in commit `9d7e9c06d`. One idempotent `task.split` command converts a
  top-level inactive parent into a container and creates two to eight ordered children atomically.
  Children retain bounded acceptance criteria and explicit acyclic dependencies; blocked children
  cannot start, while PM ledgers identify their blockers and next runnable siblings. PM and MCP expose
  the shared actuator, SQL/replay preserve split details, and parent worktree cleanup is event-driven.
- Final `ORCH-SPLIT-02` verification passed on 2026-07-14: 216 focused tests, 189 contract tests, the
  full server suite (1,439 passed/1 skipped), `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, and the complete 12-package `bun run test --output-logs=errors-only` gate.
- `ORCH-SPLIT-01` is complete in commit `9acb70191`. Task creation and durable events carry an
  optional top-level parent and zero-based sibling order; the decider rejects partial, cross-project,
  nested, hidden-parent, and duplicate-order relationships. Replay and SQL projections derive parent
  totals and landed/abandoned terminal progress, and migration 51 preserves unique sibling order.
- Final `ORCH-SPLIT-01` verification passed on 2026-07-14: 121 focused hierarchy/restart tests, all
  189 contract tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, and the full
  server suite (1,432 passed/1 skipped).
- `ORCH-BACKEND-01` is complete in commit `65dd541ac`. The PM and MCP backend override accepts
  validated provider options alongside instance/model, task ledgers expose effective per-role
  selections, and PM policy explicitly routes configured Terra/high medium work and Sol/high difficult
  or cross-cutting work without assuming model changes imply effort changes.
- Final `ORCH-BACKEND-01` verification passed on 2026-07-14: 85 focused server tests, `bun fmt`,
  `bun lint` (existing warnings only), and `bun typecheck`. The full isolated server suite passed
  1,428 tests with one skipped; the socket-dependent scripts package passed 74 tests outside the
  sandbox. The root parallel run was cancelled only because those socket tests cannot bind under the
  managed sandbox.
- `ORCH-ACCESS-03` is complete in commit `b43e9b751`. Stage-start events now stamp the resolved worker
  runtime mode, durable stage history and SQL snapshots preserve it, migration 50 backfills older
  attempts from their actual stage threads, and task detail renders Full access, Approval required, or
  Auto-accept edits per attempt.
- Final `ORCH-ACCESS-03` verification passed on 2026-07-14: 118 focused server tests, 5 UI logic tests,
  and 12 Chromium interactions; `bun fmt`, `bun lint` (existing warnings only), and `bun typecheck`.
  All ten unaffected workspace packages passed; package-isolated full gates passed web 1,226/1,226 and
  server 1,428/1,429 with one skipped. Parallel root attempts exposed only existing five-second timing
  flakes, all of which passed in isolation.
- `ORCH-TASK-04` is complete in commit `7dc1593e4`. `createTask` accepts an optional settled
  predecessor and durably links successor/predecessor in both directions. The decider rejects active,
  hidden, cross-project, and already-replaced predecessors; replay, SQL projection, restart snapshots,
  PM ledgers, MCP input, and the task board retain and expose the relationship.
- Final `ORCH-TASK-04` verification passed on 2026-07-14: 157 focused server tests and 38 focused web
  tests; `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, and all 12 workspace test
  packages. The server package passed 1,427 tests with 1 skipped; an error-only full run was stopped
  after hiding long-running Git integration progress, then the visible server rerun completed cleanly.
- `ORCH-PMBOOT-02` is complete. Claude's constrained PM surface now exposes the read-only `Skill`
  loader while continuing to deny Bash, writes, Task, and Agent immediately. The PM prompt delegates
  heavier exploration through bounded `createTask`/`handoffWorker` stages instead of unavailable native
  subagents.
- Final `ORCH-PMBOOT-02` verification passed on 2026-07-14: 97 focused provider/runtime tests,
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, and a clean `bun run test
  --output-logs=errors-only` across all 12 packages. One unrelated `effect-acp` timing test failed on the
  first full run, then passed 9/9 in isolation before the clean rerun.
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
- All tasks designated urgent through the July 13 cutoff are complete. Post-cutoff work has resumed in
  roadmap order; canonical pipeline ordering remains explicitly user-deferred.
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

## Remaining Work

1. `CHAT-QUEUE-01` adds the persisted queue contract and store operations without changing send/UI
   behavior.
2. `CHAT-QUEUE-02` adds idempotent queue/steer dispatch and one-at-a-time draining.
3. `CHAT-QUEUE-03` adds the reference queue controls and compact/browser coverage.
4. `DOC-ARTIFACTS-01` and `ORCH-ROLES-01..02` follow as separate commits.
5. `ORCH-ORDER-01` remains deferred by the user.

## Repository State Notes

- Preserve existing untracked `release-dev/`, `release-local/`, and `release-local-fixed/` directories.
- Prior `.ged/work/root` plans remain recoverable from git history.
- Required checks are `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`; never use `bun test`.
