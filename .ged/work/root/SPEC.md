# SPEC — Work Inbox and Reachable Force Landing

## Goal

Make GedCode open around work rather than history:

- a primary Inbox view with separate Normal tasks and Orchestrator categories;
- durable Active, Snoozed, and Settled lifecycle for normal chat threads;
- active Orchestrator task shortcuts that open the owning project workspace;
- a useful Force land now request available from Review or Verify.

## Domain contract

- A Normal task is still an `OrchestrationThread`.
- Its Inbox lifecycle is `active | snoozed | settled`, separate from archive.
- Snooze has a durable wake time. Expired snoozes return to Active.
- Settling and snoozing are explicit lifecycle transitions.
- Starting a new user turn on a snoozed or settled normal task reopens it atomically.
- Orchestrator tasks retain their existing task lifecycle. Inbox membership is derived from status.
- An Orchestrator entry opens `/orch/{environmentId}/{projectId}`, never task detail.
- A Force-land request is durable intent, not a direct landing actuator.

## UI contract

- GedCode has an animated long-pill switch between Inbox and Orchestrator views.
- Inbox has two flat categories: Normal tasks and Orchestrator.
- No project grouping appears in either Inbox category.
- Normal tasks show Active first, with Snoozed and Settled shelves available.
- The selected normal task remains visible even when not in the current active shelf.
- Orchestrator shows active and attention-requiring tasks, excluding terminal tasks.
- Clicking an Orchestrator entry opens its project Orchestrator workspace.
- Force land now appears on tasks in Review or Verify.
- Its confirmation explains finalization and skipped stages; reason is optional.
- A pending request shows PM finalization progress and cannot be duplicated.

## Force-land workflow

1. Human requests force landing from Review or Verify.
2. The server durably records the request; no gate or clean worktree is required yet.
3. The request re-enters the PM exactly once across live delivery or replay.
4. If a stage is active, the PM interrupts it and waits for durable interruption settlement.
5. The PM inspects changes and commits only intended task changes through existing scoped
   change-review tools.
6. Ambiguous scope, conflicts, or unsafe staged residue stop for human input.
7. The PM prepares exact PR title/body and requests the normal land gate for the final clean HEAD.
8. Normal approval performs the existing serialized, idempotent, normal-push landing.

The old direct `task.land.force` verification override and gate-card Force land action are removed.
There is no compatibility fallback because the product has no clients that require the old protocol.

## Constraints

- Adapt upstream interaction semantics; do not import its client-runtime/sidebar stack.
- Reuse GedCode events, projections, snapshots, subscriptions, routing, and task model.
- Archive remains distinct from settling.
- Do not add snooze/settle state to Orchestrator tasks.
- Do not add generic PM Git access or blindly commit a dirty worktree.
- Persistence keeps full data; this PR does not alter replay transport architecture.
- No project grouping.

## Acceptance criteria

- Normal-task lifecycle transitions survive restart, snapshot, and replay.
- Sending to snoozed or settled normal task reopens it without a lost/duplicate transition.
- Snoozed tasks wake at/after their persisted deadline.
- Inbox selectors and browser UI render correct flat categories and shelves.
- Orchestrator entries reflect live task status and navigate to project workspace.
- Force-land request accepts Review/Verify with an optional reason and dirty worktree.
- Duplicate/ineligible/terminal force-land requests are rejected.
- PM receives safe finalization instructions exactly once live and after restart replay.
- Normal final landing still requires exact proposal, clean final HEAD, branch ownership, lifecycle
  serialization, and normal push.
- Focused contracts/server/web tests pass with format, lint, and narrow typechecks.
- Changelog and upstream decision tracking describe the completed adapted implementation.
