# TESTS - Orchestrator Completion Roadmap

## Test Strategy

Each slice adds focused characterization or behavior tests first, then runs the repository gates. Cross-
component lifecycle changes require integration coverage; UI interaction changes require browser tests.

## Lifecycle Safety

- Cancel during a long-running worker command: provider receives interrupt, session stops, stage settles,
  and only then is the worktree removed.
- Interrupt rejection/timeout: worktree remains, task exposes recovery state, and retry is idempotent.
- Restart during cancellation: reconciliation completes each remaining step exactly once.
- Orphaned active stage after restart becomes retryable and no longer holds `currentStageThreadId`.
- Worktree reaper cannot remove a path owned by another live runtime.
- Landing event during reactor startup still opens one PR and cleans up once.

## Landing and Release

- PM and client landing operations reject missing/rejected/mismatched land gates.
- Approved land gate followed by land reaches `landed`, opens or reuses a PR, and records the URL.
- Repeated land/release dispatch calls are idempotent.
- Release workflow refuses dirty/unlanded state and records authoritative workflow URL/status.

## Task Lifecycle

- Archive hides a terminal task from active board queries without erasing event history.
- Restore returns an eligible task; invalid restore reports a typed error.
- Permanent delete uses explicit retention semantics and cascades or tombstones associated stage threads.
- Repeated create with the same idempotency key returns one task.
- Supersession links old/new tasks and releases capacity without ambiguity.

## PM Efficiency and Threads

- An idle worker causes no periodic PM turns or repeated `inspectStage` calls.
- Stage settlement, gate resolution, quota recovery, and interrupt outcome each wake the PM once.
- PM re-entry payload remains bounded with large task and stage histories.
- Steering reuses the active stage attempt; retry creates a linked attempt.
- Codex interrupt reaches the provider before the original turn naturally completes.
- Unsupported live steering reports queued/rejected behavior immediately.

## Task Splitting

- Parent/child relationships and child order survive projection rebuild and restart.
- `splitTask` is atomic and idempotent.
- Dependencies prevent blocked children from starting and identify the next unblocked child.
- Parent progress derives from child terminal states.

## Web and Chat

- Forking at a message creates a distinct thread with the intended history boundary.
- Source thread remains unchanged after fork.
- Active task detail omits the Plan section until a proposed plan exists; empty `No gates` is omitted;
  populated sections still render.
- Composer drafts survive route and Chat/Orchestrator surface switches without leaking between contexts.
- Project sort/manual order matches between Chat and Orchestrator.
- Project/task context menus expose only actions valid for the current state.
- Effective worker permission mode is visible.

## Compatibility Checks Requiring Explicit Decisions

- Task archive/delete event shape and retention policy.
- Legacy unknown task types when the validated registry is introduced.
- Existing persisted `allowFullAccessWorkers=false` overrides when full access becomes the default.
- Forked thread provider resume behavior across Codex, Claude, and OpenCode.

Do not add fallback behavior for these cases without a specific user decision.

## Required Commands Per Implemented Slice

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Never run `bun test`.

For web interaction slices also run the repository's browser-test command for the affected package. For
release slices also run `bun run fmt:check` and `bun run release:smoke`.

## Completed Evidence

### ORCH-POLL-01 through ORCH-POLL-03

- Source characterization found no periodic server timer or scheduler for `inspectStage`; the repeated
  calls came from an explicit PM system-prompt instruction to poll while a worker remained active.
- The PM prompt now forbids polling or recurring status checks and names settlement, gate, quota, and
  interrupt events as the authoritative automatic re-entry paths. Prompt tests prevent regression.
- Existing `inspectStage` tests prove explicit requests return only the latest 10 messages and 20
  activities, truncate message text at 500 characters, report current turn/elapsed state, and extract
  only the latest token-usage sample rather than returning a full transcript.
- Verification passed on 2026-07-12: `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`,
  `bun run build`, and `bun run test` (server 1,416 passed/1 skipped; web 1,221 passed; all 12 packages
  successful).

### ORCH-INT-01

- The shared stage-interrupt actuator validates the active running turn under the task lifecycle lock,
  dispatches one durable `thread.turn.interrupt`, and returns an immediate `requested` result through
  PM/MCP and typed RPC without depending on the PM finishing its own turn.
- Provider command reactor coverage proves a persisted request invokes the provider interrupt path;
  ingestion coverage proves provider `interrupted`/`cancelled` completion emits one operator
  `task.stage-interrupted`, clears active ownership, blocks the task, and emits no stage-completed event.
- Router/client tests cover the typed end-to-end method and error surface. Chromium coverage verifies
  the active-task Stop stage action and its monotonic pending state.
- Verification passed on 2026-07-12: 217 focused server tests, 72 router tests, 20 client tests, 10
  Chromium interactions, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`,
  `bun run build`, and `bun run test` (server 1,419 passed/1 skipped; web 1,221 passed; all 12 packages
  successful).

### ORCH-INT-02

- Codex runtime tests assert the exact generated `turn/steer` payload with `expectedTurnId`, active
  turn reuse, idle `turn/start`, and rejection propagation with zero start/interrupt fallback.
- Claude and OpenCode tests distinguish active-turn queued and steered delivery. Provider reactor tests
  prove delivery is persisted as bounded worker activity; existing failure activity remains the explicit
  rejection path.
- PM tool output directs the PM to authoritative activity instead of implying that all providers handle
  a second message identically. The changelog records the required Codex app-server `turn/steer`
  capability and no compatibility fallback was introduced.
- Verification passed on 2026-07-12: 197 focused provider/orchestration tests and 191 contract tests;
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test`
  (server 1,424 passed/1 skipped; web 1,221 passed; all 12 packages successful).

### ORCH-LC-01 and ORCH-LC-02

- Decider tests reject progression after cancellation reservation and reject direct live-task
  abandonment outside the cancellation workflow.
- Provider reactor tests cover a queued worker start racing cancellation and skip provider startup after
  cancellation or terminal settlement.
- PM cancellation tests cover concurrent calls, phase checkpoint retries, shutdown failures, final
  abandonment failures, and terminal-task no-ops.
- Projection, migration, SQL snapshot, live subscription, and web-store tests cover replay and legacy
  compatibility for durable cancellation state.
- Repository gates passed on 2026-07-11: `bun fmt`, `bun lint`, `bun typecheck`, `bun run test`, and
  `bun run build`.

### ORCH-LC-03

- Startup reconciler tests prove completed phases are not repeated, missing provider sessions are not
  resurrected, terminal cleanup runs once, transient shutdown failure retries in the same startup, and a
  second reconciliation is a no-op.
- A persistence-backed three-runtime integration test persists reservation plus an interrupt checkpoint,
  resumes to abandonment after restart, and observes exactly one abandonment across another restart.
- External shutdown effects remain retry-safe/idempotent rather than transactionally exactly-once across
  a process crash between effect completion and its durable checkpoint.
- Repository gates passed on 2026-07-11: `bun fmt`, `bun lint`, `bun typecheck`, `bun run build`, and a
  clean root `bun run test` rerun (server 1,360 passed/1 skipped; web 1,214 passed).

### ORCH-LC-04

- Decider, in-memory projection, SQL projection, awaited-stage, live WebSocket, and web-store tests cover
  durable orphan interruption and clearing `currentStageThreadId` without treating interrupted work as
  completed or quota-blocked.
- Startup reconciler tests cover missing, null, already-interrupted, and stale provider sessions;
  independent session/stage repair; bounded retries; deterministic command IDs; and a worker becoming
  live while reconciliation is waiting for the task lifecycle lock.
- PM settlement tests prove the interruption wake-up is consumed exactly once and instructs the PM to
  inspect the preserved worktree before retrying the same role with a fresh handoff.
- A persistence-backed two-runtime integration test leaves an active stage behind, starts the real
  reconciler after restart, verifies the old stage and session are interrupted, and successfully starts
  a new same-role handoff.
- Repository gates passed on 2026-07-11: `bun fmt`, `bun lint`, `bun typecheck`, `bun run build`, and
  `bun run test` (server 1,373 passed/1 skipped; web 1,215 passed).

### ORCH-LAND-01

- Decider tests require no active stage and the latest land gate to be resolved, approved, and
  content-hash matched; an older approval cannot bypass a newer pending gate.
- Shared landing-executor tests cover first dispatch, already-landed idempotency, concurrent calls
  collapsing to one command under the lifecycle lock, and typed missing-task failure without dispatch.
- PM tests prove `landTask` delegates through the shared executor and reports whether landing started or
  was already complete. Authenticated MCP tests cover tool listing, required input schema, and routing
  through the same executor registry used by Claude and Codex PM sessions.
- Existing landing integration coverage still passes for ready/draft PR creation, loud provider failure,
  worktree cleanup, and reuse of an existing PR URL.
- Repository gates passed on 2026-07-11: `bun fmt`, `bun lint`, `bun typecheck`, `bun run build`, and
  `bun run test` (server 1,381 passed/1 skipped; web 1,215 passed).

### ORCH-LAND-02

- Contract, client, and server-router tests cover the typed `orchestrator.landTask` request/result and
  typed missing-task error while delegating through the shared lifecycle-locked executor.
- Landing integration now drives approved gate -> shared executor -> `task.pr-opened`, retaining ready
  and draft PR creation, provider-failure, worktree-preservation/cleanup, and existing-PR coverage.
- Web logic tests mirror the decider's exact review/no-active-stage/content-matched-latest-gate
  eligibility and prioritize authoritative PR URL/failure state over transient request state.
- Browser coverage drives the task-detail Land action and verifies monotonic request pending, retryable
  request failure, PR opening, durable PR-open failure activity, final PR link, and no premature Landed
  label. Lifecycle actions are mutually disabled and task headers remount by task ID to isolate requests.
- Repository gates passed on 2026-07-11: focused server/integration/web/browser tests, `bun fmt`,
  `bun lint`, `bun typecheck`, `bun run build`, and `bun run test` (server 1,382 passed/1 skipped; web
  1,218 passed).

### ORCH-WT-01

- Focused reactor coverage publishes the same terminal event through the buffered live subscription and
  durable replay while startup snapshot capture is in progress, then proves one cleanup side effect.
- Persistence-backed landing coverage pauses startup terminal cleanup after the reactor has subscribed,
  lands another task inside the former gap, and proves exactly one branch push, PR creation,
  `task.pr-opened` event, and target worktree cleanup.
- Startup snapshot scans use one captured read model/cursor; snapshot failure replays from sequence zero,
  replay failures are logged, and replay/live terminal events are sequence-deduplicated before the serial
  worker without dropping the ongoing hot subscription.
- Repository gates passed on 2026-07-11: focused reactor/integration tests, `bun fmt`, `bun lint`,
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,384 passed/1 skipped; web 1,218 passed).

### ORCH-LAND-03

- Contract, decider, in-memory projector, SQL projection, snapshot-query, live-event, and web-store tests
  cover durable `opening-pr`, `failed`, and `completed` task landing metadata plus legacy null defaults.
- Task-only replay reconstructs all three states without stage-thread activity. Migration 47 preserves
  legacy rows while adding nullable validated JSON landing state.
- Reactor and real-engine landing tests prove exhausted provider/git failures persist actionable detail
  and branch-push state, retain the worktree, and are not retried automatically during startup.
- Task detail prioritizes durable landing state while retaining the existing activity fallback for older
  histories; the board keeps PR opening active and routes exhausted failure into Needs you.
- Verification passed on 2026-07-12: focused contract/decider/projector/projection/reactor/integration/web
  tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and two clean
  root `bun run test` passes. The final run had server 1,390 passed/1 skipped and web 1,219 passed.

### ORCH-LAND-04

- Contract, engine classification, decider, and projector tests cover the explicit
  `task.landing.retry` command and `task.landing-retry-requested` event, including rejection unless the
  task is landed with an exhausted failure and a retained worktree.
- Shared executor and PM tests cover first retry dispatch, completed-task idempotency, in-progress
  coalescing, and accurate operator messages while retaining the existing public RPC result contract.
- Reactor tests prove failed landings remain stable across startup, explicit retry opens or reuses one
  pull request, a later failed attempt is not deduplicated against the first, and the worktree is removed
  only after success.
- A real-engine integration test drives provider failure -> durable failure -> shared retry actuator ->
  successful PR creation, and browser coverage verifies the durable Retry landing action and pending UI.
- Verification passed on 2026-07-12: focused contract/server/reactor/integration/web/browser tests,
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test`
  (server 1,397 passed/1 skipped; web 1,219 passed).

### ORCH-WT-02

- Reactor tests cover atomic lease creation from both the startup snapshot and a post-snapshot
  `task.created` event, periodic renewal, live foreign-lease protection, expiry plus grace, new unleased
  directory grace, terminal release, deterministic-path validation, and the existing orphan metric.
- Lease records are stored outside the removable worktree and contain schema-validated version, task,
  project, canonical worktree path, and renewal time. Malformed or inaccessible metadata fails safe.
- A persistence-backed integration test starts two runtimes with independent SQLite event stores over
  one Git workspace. The observer knows the project but not the owner's task and proves its startup
  orphan scan preserves the leased worktree.
- Verification passed on 2026-07-12: 23 reactor tests plus the two-database integration test,
  `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and `bun run test`
  (server 1,402 passed/1 skipped; web 1,219 passed).

### ORCH-TASK-01

- Contract, decider, in-memory replay, engine classification, and live-event tests cover append-only
  archive, restore, and permanent-delete commands/events. Legacy tasks decode with null tombstones.
- Lifecycle invariants allow only abandoned tasks or fully landed tasks with a recorded pull request;
  archived tasks reject ordinary commands until restored and deleted tasks reject all later transitions.
- Migration 48 and SQL projection tests preserve tombstoned rows and full command state while active
  project queries, public snapshots, PM ledgers, and web state omit archived/deleted tasks.
- Verification passed on 2026-07-12: focused contract/decider/projector/SQL/migration/engine/PM/web
  tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and
  `bun run test` (all 12 packages successful; server 1,413 passed/1 skipped, web 1,220 passed,
  contracts 61 passed).

### ORCH-TASK-02

- PM and authenticated MCP tests cover archive, restore, and delete tool discovery, schema routing,
  deterministic command dispatch, and structured results.
- Typed websocket, client transport, and environment API tests cover archived lookup plus all three
  lifecycle actions. Restore events include the restored task projection and immediately repopulate the
  web store without a reconnect or polling loop.
- Component and Chromium tests cover status-sensitive terminal task menus, archive from the active
  board, restore from the archived section, and omission of the empty-board message when archives exist.
- Verification passed on 2026-07-12: focused contract/server/PM/MCP/client/store tests, 9/9 affected
  Chromium tests, `bun fmt`, `bun lint` (existing warnings only), `bun typecheck`, `bun run build`, and
  `bun run test` (all 12 packages successful; server 1,414 passed/1 skipped, web 1,221 passed).

### ORCH-TASK-03

- PM tests prove canonical whitespace variants of the same project/key/task request derive identical
  task, command, and PM provenance IDs; changed content keeps the task identity but changes the command.
- MCP and Claude adapter tests require and route the explicit stable `idempotencyKey`.
- A real-engine test dispatches the identical create command twice and observes one receipt result, one
  `task.created` event, and one projected task; a changed-content command for the same task is rejected.
- Verification passed on 2026-07-12: focused PM/MCP/Claude/engine tests, `bun fmt`, `bun lint` (existing
  warnings only), `bun typecheck`, `bun run build`, and a clean `bun run test` rerun (all 12 packages;
  server 1,416 passed/1 skipped, web 1,221 passed).
