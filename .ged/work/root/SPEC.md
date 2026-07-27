# SPEC — Replacement Landing for Existing Pull Requests

## Goal

Make landing idempotent by approved repository content rather than by task or pull-request existence.
A task whose existing PR published verified HEAD A may return through Work and Verify at HEAD B,
request a replacement land gate, and publish exactly approved HEAD B to that same PR.

## Constraints

- Human approval remains mandatory for every land gate.
- The replacement gate must match the current clean, freshly verified HEAD.
- Existing event history and persisted landing JSON must continue decoding without data migration.
- A normal first landing must retain its current create-PR behavior.
- Replacement publication must update the existing remote branch safely with force-with-lease, never
  an unconditional force push.
- The existing PR title and body must be updated to the newly approved proposal.
- Landing retries must retain the worktree and exact approved proposal.
- Do not add a compatibility path that preserves stale completed landing behavior.
- Preserve unrelated worktree changes.
- Run focused tests only, followed by `bun fmt`, `bun lint`, the narrowest relevant package
  typechecks, and an unreleased changelog entry.

## Acceptance Criteria

- Durable landing state records the approved/published content hash and decodes legacy rows where it
  is absent.
- Starting new Work or Verify after completed publication invalidates the completed landing state
  without deleting the existing PR identity.
- A pending replacement land gate for the current verified HEAD is visible and can be approved.
- Gate approval dispatches a new landing attempt when the existing PR's published hash differs.
- Repeated landing at the same published hash remains idempotent.
- The landing actuator force-with-lease pushes the approved exact HEAD to the existing PR branch.
- The actuator updates the existing PR title and body from the approved replacement proposal.
- Successful replacement publication records the new published hash and leaves the task associated
  with the same PR.
- Focused server, contract, projection, reactor, and web tests cover stale invalidation,
  actionability, exact-head publication, PR update, and same-hash idempotency.

## Follow-up: PM Prompt Prefix

### Goal

Allow users to append custom instructions to the Orchestrator PM's built-in system prompt through
an inheritable global default and a per-project override.

### Constraints

- Preserve the mandatory built-in PM prompt; custom text is appended, not substituted.
- An omitted project value inherits the global default.
- An explicitly empty project value disables a non-empty global prefix for that project.
- Existing persisted settings and project metadata continue decoding without migration.
- Worker prompt prefixes and the current `plan`, `work`, and `verify` role contract are unchanged.

### Acceptance Criteria

- Global Orchestrator settings expose a PM prompt prefix field.
- Project Orchestration settings expose an inheritable PM prompt prefix field.
- Runtime PM sessions receive the resolved prefix exactly once after the built-in prompt.
- Schema, settings logic, runtime prompt resolution, and UI behavior have focused coverage.
- The unreleased change is documented.

## Follow-up: Worker Thread Continuation Policy

### Goal

Make the Orchestrator PM continue a viable worker stage thread for the first bounded correction instead
of treating every unsatisfactory result as a new attempt.

### Constraints

- Preserve fresh attempts for independent verification, materially different approaches, capability
  changes, exhausted or corrupted context, and terminal provider/session failures.
- Verifiers remain independent and must not repair implementation defects.
- Preserve the existing durable distinction between another turn in one attempt (`steerStage`) and a
  new attempt (`handoffWorker`).
- Do not add a compatibility fallback for the former eager-fresh-attempt PM policy.

### Acceptance Criteria

- The PM prompt explicitly prefers same-thread continuation for a bounded correction to the current
  viable stage.
- Tool descriptions make the cost/audit distinction between continuation and a new attempt clear.
- The feature playbook uses the same decision rule for unsatisfactory Work results.
- Verify findings still go to Work and are followed by fresh independent Verify.
- The thread-reuse and worker-role decisions document the refined policy.
- Focused prompt/tool tests and required quality gates pass.
