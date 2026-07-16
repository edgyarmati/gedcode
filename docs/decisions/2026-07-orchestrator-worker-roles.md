# Orchestrator Worker Role Ownership

## Decision

The Orchestrator exposes three worker roles: `plan`, `work`, and `verify`.

The PM is the workflow owner. A worker is a bounded execution context for work that benefits from a
separate provider turn and task worktree; it is not a second workflow controller.

## Responsibility Map

| Responsibility                                                                               | Owner           | Notes                                                                                              |
| -------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------- |
| Understand the user request and maintain acceptance criteria                                 | PM              | The PM may ask the user for missing product decisions.                                             |
| Create/reuse/supersede tasks and choose the registered task type                             | PM              | `createTask` and `classifyRequest` are PM actuators; no classify worker is needed.                 |
| Decide whether to split, define child scope/dependencies, and schedule runnable children     | PM              | `splitTask` is atomic and idempotent.                                                              |
| Explore the codebase and produce a concrete technical plan                                   | `plan` worker   | Optional for small or already-specific work. A second `plan` attempt can critique a doubtful plan. |
| Request and track plan, land, and release approval                                           | PM              | Workers cannot approve gates.                                                                      |
| Select task worker backends, start/steer/interrupt workers, and handle quota/retry state     | PM              | Provider execution remains detached and event-driven.                                              |
| Implement source/config/schema/test changes                                                  | `work` worker   | One bounded implementation slice per attempt.                                                      |
| Independently test and review the latest implementation                                      | `verify` worker | Report problems; the PM starts another `work` attempt for fixes, followed by fresh verification.   |
| Land/open or retry a pull request, dispatch an approved release, archive/delete/cancel tasks | PM              | These remain guarded lifecycle actuators, never worker side effects.                               |

## Removed Roles

- `classify` duplicated the PM's registered task-type/playbook selection. Classification remains a
  durable PM command and task lifecycle state, not a worker.
- `review` duplicated two existing responsibilities. Pre-work plan critique is another bounded `plan`
  attempt; post-work code review belongs to `verify`.

There are no compatibility aliases or persisted-user-task migration. This is an unreleased application
without a user task ledger, so removed role values are rejected at schema/tool boundaries.

## Invariants

- Stage order stays permissive. The PM may skip `plan` when it is unnecessary.
- `work` is the only role authorized by policy to implement product changes.
- `verify` must not repair findings in place. Landing continues to require a successful `verify`
  attempt newer than the latest successful `work` attempt.
- Normal-chat GED mode remains unrelated: it guides one selected model and does not invoke these
  Orchestrator workers.
