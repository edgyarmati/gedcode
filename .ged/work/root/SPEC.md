# SPEC — Durable PM Lifecycle and Landing Automation

## Goal

Make Orchestrator react reliably to durable lifecycle outcomes without model polling: delivery wakes the
PM, landing approval opens a draft PR immediately, GitHub merge detection unblocks dependent work, and
workers can use a network-enabled workspace sandbox while safely pausing for capability-bound work.

The completed delegation, context, PR-metadata, and stage-history roadmap remains recorded in
`TASKS.md`, `TESTS.md`, and `STATE.md`; this specification is the next implementation phase.

## Domain Language

- **Lifecycle inbox**: per-PM-thread durable, deduplicated system-event queue. It records an event
  before any provider turn is requested and retains it until the PM has received it.
- **Lifecycle wake**: a server-side attempt to deliver pending inbox events to the PM. It is distinct
  from UI visibility and never becomes a synthetic user message.
- **Orchestration-owned thread**: a PM, task-stage, helper, or other thread created for the
  orchestrator and persisted with an ownership link. It is visible from its task history, not Chat.
- **Landing approval**: the user’s approval of a verified task’s stored PR proposal. It authorizes
  creating or updating its draft PR, but never making the PR ready or merging it.
- **PR opened**: a draft PR exists and is tracked. **PR merged** is the remote GitHub state that
  unblocks dependents. **Integrated** remains a separately recorded local/repository settlement when
  needed; it is not inferred from a draft PR.
- **Capability boundary**: a narrow worker operation that cannot run in its sandbox (for example,
  authentication or a broader host permission). The worker pauses; it does not fail or escalate itself.

## Decisions and Constraints

### Durable lifecycle delivery

- Every actionable provider, stage, helper, permission, PR, and settlement outcome appends a typed,
  idempotency-keyed lifecycle event to the owning PM inbox. Duplicates must not create a second PM turn.
- The server wakes the PM even when the project/UI is closed. Lifecycle content is structured system
  context, never a user-authored chat item.
- A queued user message has priority. It consumes pending lifecycle events in the same PM turn so the
  PM answers the user from current task state without spending a second turn.
- Urgent events are high priority but never silently interrupt an active PM turn. They run after the
  turn settles; a visible user-controlled steer action is optional only when the provider supports it.
- Transient startup/connection failures get a small bounded retry budget. Auth, quota, and known
  rate-limit failures do not repeatedly invoke the model. Events remain durable and retry after a
  provider-health or credential/quota change, restart, or explicit Retry.
- The UI reports retained-event count and a clear PM-needs-attention state whenever delivery cannot
  proceed. Recovery must be restart-safe and must not poll a model.

### Thread ownership and history

- Every newly created orchestration thread has explicit persisted ownership metadata from creation.
  Chat filters these threads out; task pages keep them accessible by stage, attempt, and chronology.
- Failed attempts and read-only helpers remain inspectable. A task defaults to its latest attempt but
  does not discard earlier transcripts or results.
- Do not retroactively classify, hide, migrate, or delete existing threads. This product behavior has
  not shipped, so no compatibility fallback is required.

### Landing and remote PR lifecycle

- A valid landing approval immediately starts landing and creates or updates the configured draft PR.
  The redundant top-level Land action is removed from the normal approval flow.
- The state progression is `Awaiting approval` → `Landing` → `PR opened`. Landing failure exposes
  Retry landing. Approval remains valid only while the verified task HEAD is unchanged; a changed HEAD
  requires a new review and approval.
- A draft PR is ready for review only; marking ready and merging remain explicit user actions unless a
  future auto-merge policy is introduced. Dependents remain blocked until `pr_merged`, not `pr_opened`.
- The server synchronizes only orchestrator-tracked open PRs through conditional GitHub API requests:
  frequent while the app is active, slower in background, and stopped when none remain. It uses no
  LLM/model invocation and must be bounded in CPU/network work.
- A detected external merge appends `pr_merged`, wakes the PM, updates dependent eligibility, and is
  replay/restart safe. GitHub unavailability preserves the last known tracked state and schedules
  ordinary non-model recovery rather than falling back to a local merge.

### Worker network and capability handling

- Codex workers run `workspace-write` with network access enabled by default. A global Orchestrator
  network setting defaults on. The PM may disable network for an individual handoff, but cannot enable
  it when the user has globally disabled it.
- Workers never automatically broaden their sandbox. Authenticated, user-scoped, or broader host
  operations are performed by the full-access PM behind existing approval boundaries.
- On a capability boundary, retain the worker session and pause its stage. The PM resolves or seeks
  approval for the narrow operation, records the result, then resumes/steers that same worker with the
  result. Expiry occurs only after a generous timeout or explicit cancellation.

## Out of Scope

- Retroactive orchestration-thread migration or Chat filtering for old data.
- Automatic PR readiness or merge, provider-turn interruption, and model polling.
- A new remembered allow/ask/deny policy for PM privileged actions.
- A local-main fallback when GitHub synchronization or PR access is unavailable.

## Acceptance Criteria

- Lifecycle events survive restart, deduplicate, recover from provider failures without token-burning
  polling, and are delivered in correct user-message/urgent-event order.
- New orchestration threads never appear in Chat and every attempt/helper remains reachable from its
  task history.
- One approval creates/updates a draft PR; stale HEAD invalidates approval; only a confirmed merge
  unblocks dependents and wakes the PM.
- GitHub synchronization has bounded, adaptive, non-LLM cost and stops with no tracked open PRs.
- Worker network defaults on but respects global/per-handoff limits; capability pauses retain session
  context and resume only after PM settlement.
- Each slice updates `CHANGELOG.md` when user-visible, passes `bun fmt`, `bun lint`, narrow package
  typechecks, and focused `bun run test` targets. Full suites are release-only.
