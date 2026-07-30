# TESTS — Work Inbox and Reachable Force Landing

## TDD method

Each row is implemented as one vertical RED → GREEN cycle through a public contract or UI surface.
Do not batch all tests before implementation.

## Normal-task Inbox lifecycle

- Contract decoding for settle, snooze, reopen, events, and shell lifecycle fields.
- Decider settles an eligible normal task and rejects runtime-owned/archived invalid transitions.
- `thread.turn.start` reopens settled/snoozed state in the same command decision.
- Projector replay produces the same lifecycle state as live projection.
- SQLite migration and restart preserve state and snooze deadline.
- Deadline sweep wakes eligible snoozes once and ignores future/already-active rows.
- Shell snapshot carries lifecycle without using archived-thread APIs.

### IN-01 evidence

- RED: `bun run --cwd apps/server test -- src/orchestration/decider.inboxLifecycle.test.ts`
  failed because `OrchestrationCommand` did not decode `thread.inbox.settle`.
- GREEN: the same focused command passed (1 file, 1 test) after the contracts,
  decider, and projector implementation.
- `bun run --cwd packages/contracts typecheck` passed.
- `bun run --cwd apps/server typecheck` passed.

### IN-02 evidence

- `bun run --cwd apps/server test -- src/orchestration/Layers/ProjectionPipeline.test.ts` passed
  (1 file, 32 tests), including the SQLite projection-restart shell-snapshot tracer.
- The real SQLite pipeline test setup applied migration 074; no standalone migration test exists.
- `bun run --cwd packages/contracts typecheck` passed.
- `bun run --cwd apps/server typecheck` passed.
- `git diff --check` passed.

### IN-03 evidence

- `bun run --cwd apps/server test -- src/orchestration/decider.inboxLifecycle.test.ts` passed
  (1 file, 2 tests), including snooze, explicit reopen, and controlled-clock due wake.
- `bun run --cwd apps/server test -- src/orchestration/Layers/InboxLifecycleReconciler.test.ts`
  passed (1 file, 1 test), proving the live scheduler does not wake early and dispatches once.
- `bun run --cwd apps/server test -- src/orchestration/Layers/ProjectionPipeline.test.ts` passed
  (1 file, 32 tests).
- `bun run --cwd packages/contracts typecheck`, `bun run --cwd apps/server typecheck`, and
  `git diff --check` passed.

### IN-04 evidence

- `bun run --cwd apps/web test -- src/inboxSelectors.test.ts` passed (1 file, 1 test).
- `bun run --cwd apps/web typecheck` and `git diff --check` passed.

## Inbox UI

- Selector emits flat Normal-task shelves with the selected row retained.
- Selector emits nonterminal Orchestrator entries and excludes terminal tasks.
- Normal-task row uses existing chat route.
- Orchestrator row uses project workspace route, never task-detail route.
- Animated Inbox/Orchestrator pill preserves last valid Orchestrator project behavior.
- Normal/Orchestrator categories render without project group headings.

### IN-05 evidence

- `bun run --cwd apps/web test:browser -- src/components/Sidebar.browser.tsx` passed (1 tracer):
  a seeded real store and memory router render the actual Sidebar within SidebarProvider, show Inbox
  content and the shared animated pill, switch to the actual OrchestratorSidebarNav, and navigate a
  project row to its project workspace route.
- `bun run --cwd apps/web test:browser -- src/components/InboxSidebar.browser.tsx` passed (1 test).
- `bun run --cwd apps/web test -- src/inboxSelectors.test.ts` passed (1 test).
- `bun run --cwd apps/web test:browser -- src/components/orchestrator/OrchestratorSidebarNav.browser.tsx`
  passed (4 tests).
- `bun run --cwd apps/web typecheck`, focused `bun run lint -- apps/web/src/components/Sidebar.browser.tsx`,
  and `git diff --check` passed.

## Force landing

- Request contract accepts omitted/blank-trimmed reason.
- Decider accepts Review/Verify even with active stage, dirty worktree, and no land gate.
- Decider rejects duplicate, terminal, cancelling, and unrelated-status requests.
- Projector/replay preserve pending request and audit metadata.
- WebSocket RPC dispatches only durable intent and does not inspect or land immediately.
- PM runtime consumes the request exactly once live and after restart replay.
- PM guidance requires interrupt/wait, scoped change review, ambiguity stop, final clean HEAD,
  exact PR proposal, and normal landing.
- Browser action exists in Review/Verify, allows no reason, and shows pending progress.
- Existing gate card no longer exposes direct Force land.
- Integration proves dirty changes can be scoped/committed before exact normal landing.

### FL-01 evidence

- `bun run --cwd packages/contracts test -- src/orchestration.test.ts` passed (70 tests).
- `bun run --cwd apps/server test -- src/orchestration/decider.task.test.ts -t "records a durable optional-reason force-land request"`
  passed, covering optional trimmed reason, Review/Verify acceptance despite an active stage and no
  gate/inspection, pending projection, and duplicate/terminal/cancelling/unrelated rejection.
- `bun run --cwd apps/server test -- src/orchestration/projector.test.ts` passed (24 tests).
- `bun run --cwd apps/server test -- src/orchestration/Layers/ProjectionPipeline.test.ts` passed
  (32 tests), including persistence/restart projection coverage.
- `bun run --cwd packages/contracts typecheck` and `bun run --cwd apps/server typecheck` passed.

### FL-02 evidence

- `bun run --cwd apps/server test -- src/orchestration/Layers/PmRuntime.test.ts -t "delivers one pending force-land request"`
  passed. The tracer proves exactly one delivery across concurrent live observation and restart replay,
  with durable safe-finalization guidance: interrupt and await settlement, scoped intended-change commit,
  ambiguous-scope human stop, then exact PR proposal and normal land gate on a clean final HEAD.
- `bun run --cwd apps/server typecheck` and focused PmRuntime lint passed.

### FL-03 evidence

- The focused browser/RPC tracer covers Review and Verify without a land gate, optional reason,
  pending progress, and absence of the old gate-card action. Contracts, server, and web typechecks
  passed after the new request surface was wired.

### FL-04 evidence

- `bun run --cwd apps/server test -- src/orchestration/decider.task.test.ts -t "allows a pending force-land request"`
  passed: a pending request permits an exact clean final land gate and normal human approval without
  fresh Verify, while a dirty finalization remains rejected.
- `bun run --cwd apps/server test -- src/orchestration/taskLanding.test.ts` passed (6 tests).
- Contracts, server, and web typechecks, focused landing lint, and `git diff --check` passed.

## Final gates

- `bun fmt` passed (1,451 files).
- `bun lint` passed with warnings only; no lint errors were reported. The warnings include existing
  repository warnings as well as test-file style warnings and do not change the command exit status.
- Full `bun typecheck` passed: 12 Turbo tasks successful.
- Full `bun run test` completed successfully. Its captured output was truncated before the aggregate
  footer, so focused evidence was also rerun rather than inferring individual coverage from that log.
- `bun run --cwd apps/server test -- src/orchestration/decider.inboxLifecycle.test.ts src/orchestration/Layers/InboxLifecycleReconciler.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts src/orchestration/decider.task.test.ts src/orchestration/Layers/PmRuntime.test.ts src/orchestration/taskLanding.test.ts`
  passed (6 files, 183 tests).
- `bun run --cwd apps/web test -- src/inboxSelectors.test.ts` passed (1 file, 1 test).
- The combined browser command for the four Inbox/Sidebar/force-land tracers exited successfully but
  printed only Vitest's `RUN` banner and no collection/result summary. This is inconclusive fresh
  browser-run output; the individually recorded browser evidence above remains the acceptance-test
  evidence and no browser-runner behavior was changed in this checkpoint.
- `git diff --check` passed.
