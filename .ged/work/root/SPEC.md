# SPEC — Reliable Replay, Then Task-Oriented Inbox

## Goal

Deliver two sequential, independently reviewable changes:

1. Harden GedCode's durable orchestration subscriptions so snapshot, replay, buffered-live, and live
   delivery form one ordered, deduplicated server contract.
2. After PR 1 is merged, add a durable task-oriented Inbox for normal chat threads and Orchestrator
   tasks without replacing GedCode's existing task aggregate or client runtime.

PR 2 must start from the merged PR 1 base; it is not a stacked PR.

## Agent and Delivery Workflow

- Only GPT-5.6 Sol at low reasoning may be delegated production-code implementation.
- GPT-5.6 Terra at low reasoning may scout, run tests, and independently verify; it must not edit
  production code.
- Luna is unavailable in this environment; Terra is the approved test/verification substitute.
- Work test-first in vertical slices: one observable failing test, minimal implementation, then the
  next behavior. Do not write the whole test suite before implementation.
- Run focused tests only during ordinary work. Never run `bun test`; use `bun run test`.
- Before each PR: run `bun fmt`, `bun lint`, the narrowest relevant package typechecks, focused
  tests, and `git diff --check`; update `CHANGELOG.md` and `docs/upstream-decisions.md`.
- Commit intentionally, push, and open a detailed PR. Do not merge without explicit authorization.
- Preserve pre-existing user edits in `CHANGELOG.md` and `docs/upstream-decisions.md`.

## PR 1 — Durable Subscription Bootstrap

### Contract

- Scope is sequence-backed durable UI state only: shell, normal thread, Orchestrator project, and
  Orchestrator task subscriptions.
- Raw provider/token streaming is out of scope. PR 1 guarantees reconstruction after an event has
  entered the durable orchestration log.
- The server owns bootstrap correctness through one shared abstraction:
  1. attach/buffer live delivery before snapshot loading;
  2. load a snapshot and its sequence cursor;
  3. replay durable events strictly after that cursor;
  4. drain buffered events;
  5. continue live delivery without changing ordering rules.
- Every event is applied at most once and sequence order is preserved across replay, buffer drain,
  reconnect, and the transition to live delivery.
- Client recovery remains a defensive gap detector, not the normal mechanism for closing bootstrap
  races.
- When replay distance exceeds one central bounded limit, use a fresh snapshot rather than loading
  an unbounded history. Do not add a degraded fallback path.
- Persisted domain events and lifecycle transitions are lossless and are never coalesced.
- Only replaceable transport-level projection/activity updates for the same thread/task may be
  coalesced. The transport message must communicate its covered sequence range so intentional
  compaction is not treated as data loss.
- Oversized activity/tool fields are trimmed only by one shared WebSocket transport projector used
  for replay and live delivery. Persistence and detail-query data remain complete.
- Truncated transport values retain identity/status metadata and expose explicit truncation metadata,
  including the original size, so the UI cannot silently present a preview as complete.
- Protocol/schema cleanup may be breaking: there are no production clients requiring compatibility.
  Do not retain obsolete paths or add compatibility shims.

### PR 1 Acceptance Criteria

- A deterministic interleaving test proves an event emitted after snapshot loading begins but before
  it completes is delivered exactly once.
- Snapshot, replay, buffered, and live events remain strictly ordered and deduplicated.
- Reconnect/re-subscribe preserves the same contract.
- A replay beyond the central bound recovers through a fresh snapshot.
- Same-thread/task high-frequency replaceable updates are coalesced without hiding domain
  transitions or causing false gap recovery.
- Large activity/tool payloads are complete in persistence and reduced only on WebSocket delivery,
  with visible truncation metadata.
- Shell, thread, project, and task subscription paths use the shared bootstrap contract.

## PR 2 — Task-Oriented Inbox

### Product Structure

- GedCode retains two top-level views: Inbox and Orchestrator.
- Inbox contains a polished long sliding-pill switch between:
  - `Threads`: normal chat threads;
  - `Orchestrator`: Orchestrator task rows.
- These sources remain visually and semantically distinct. Do not merge them into one flat model.
- Do not group Inbox rows by project.
- PM threads and internal worker-stage threads remain hidden implementation details.
- Clicking an Orchestrator task row navigates to that task's project-level Orchestrator view, not a
  task-detail route.
- Each pill side defaults to Active and has a compact lifecycle filter for Active, Snoozed, Settled.
- Native execution/session status remains distinct from inbox lifecycle status.

### Durable Lifecycle

- Lifecycle state and transitions are server-backed, persisted, and replayable; no UI-only state.
- Shared lifecycle vocabulary is `active`, `snoozed`, and `settled`, while native thread/task state
  remains intact.
- A settled normal thread reopens on a new sent or queued user message.
- A settled Orchestrator task reopens only when its durable execution resumes. Project-level PM
  messages do not reopen every task.
- Viewing or navigating never reopens an item.
- Ordinary background activity does not cancel an explicit snooze.
- Direct user activity and manual unsnooze clear snooze immediately.
- Approval required, input required, or a new failure requiring intervention raises a snoozed item
  into Active.
- Manual settle is blocked for pending approval/input and fresh unadopted user work.
- Completed Orchestrator tasks settle automatically.
- Normal threads auto-settle conservatively after upstream's default three inactive days; the
  setting is nullable (disabled) and accepts 1–90 days.
- Explicit `active` pins a thread against automatic settlement until new user activity resets it.
- Follow upstream's coherent snooze presets and local-calendar behavior: one hour, this evening when
  meaningful, tomorrow 09:00, and next Monday 09:00, with DST-safe calendar arithmetic.

### Adaptation Boundary

- Adapt the behavioral invariants from upstream commits `32c6012d`, `202e5609`, and relevant polish.
- Do not copy upstream's Sidebar/client-runtime stack, project grouping, Sidebar v1/v2 compatibility,
  beta flags, mobile work, PR auto-settlement, bulk selection, drag ordering, or unrelated task tabs.
- Reuse GedCode's event-sourced projections, normal-chat thread model, Orchestrator task aggregate,
  current routing, and existing internal-thread filtering.

### PR 2 Acceptance Criteria

- Thread/task lifecycle survives restart, snapshot, and replay.
- Settle and snooze commands are idempotent and enforce blockers.
- Normal user activity reopens settled threads; durable task progress reopens only the affected task.
- Snooze expiry and raised-hand behavior return items to Active correctly.
- The type pill and lifecycle filter partition rows correctly with no project grouping.
- Orchestrator rows navigate to the project Orchestrator view.
- Auto-settlement and snooze presets match the documented timing rules, including DST behavior.
