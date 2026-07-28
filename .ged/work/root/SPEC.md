# SPEC — Forced Landing and Direct PM Publication

## Goal

Add two separate operator workflows:

1. Let a human force-land a review-ready task by bypassing only the fresh Verify requirement.
2. Let the project PM publish one existing commit to an explicit branch/PR without creating an
   Orchestrator task.

This work is an independent PR based on `main`; it must not depend on replay-hardening PR #67.

## Shared Constraints

- Use test-driven vertical slices: one public behavior test, minimal implementation, then repeat.
- Only Sol-low implementation agents may edit production code.
- Terra-low agents own test authoring, test execution, and independent verification.
- Preserve normal task Verify behavior and the existing default task pipeline.
- Do not add compatibility fallbacks; there are no production clients requiring old wire behavior.
- Run focused tests only, then `bun fmt`, `bun lint`, narrow typechecks, and `git diff --check`.
- Update `CHANGELOG.md` and durable handoff documentation before publication.

## Forced Landing

### Contract

- Forced landing is a distinct audited command/RPC, not an overload of normal gate approval.
- It targets one current pending `land` gate and requires a non-empty human-provided reason.
- It may bypass only the requirement for a fresh successful Verify after the latest Work.
- It preserves all other normal landing invariants:
  - task and project exist and are enabled;
  - task is idle in Review with no active/cancelling stage;
  - the targeted gate is the latest pending content-matched land gate;
  - gate proposal has exact PR title/body;
  - task-owned worktree has been inspected;
  - worktree is clean;
  - inspected HEAD matches the gate content hash;
  - lifecycle serialization, landing idempotency, branch ownership, and normal PR actuator apply.
- Forced landing atomically resolves the land gate as human-approved and starts the existing landing
  workflow.
- The durable event/audit projection records that verification was overridden and the exact reason.
- UI presents a secondary destructive/exception action with explicit confirmation and required
  reason. Normal Approve remains the primary action when all normal invariants pass.
- Force landing never means force-pushing, publishing arbitrary refs, bypassing content identity, or
  landing a dirty/uninspected worktree.

### Acceptance

- Normal approval still rejects missing/stale Verify.
- Force-land succeeds with missing/stale Verify when every preserved invariant holds.
- Force-land rejects dirty, uninspected, wrong-HEAD, wrong-gate, non-review, or active-stage tasks.
- Repeated force-land is idempotent and never starts two landing attempts.
- Durable replay/restart preserves override origin and reason.
- UI requires confirmation/reason and sends the dedicated command.

## Direct Publication

### Contract

- Add a dedicated server-owned PM tool/service; do not expand `commitDirectChanges` or expose raw Git.
- Inputs are explicit: required project ID, immutable source commit, destination branch, base branch, exact PR
  title/body, and optional existing PR URL.
- The shared PM MCP transport is trusted and global, so the explicit project ID is the authoritative
  target selected by the PM rather than inferring a project from a global read model. The server
  validates that project before resolving its workspace/provider; this deliberately avoids a
  per-project MCP endpoint redesign.
- The workflow publishes exactly one existing commit without creating an Orchestrator task,
  work-stage thread, Verify stage, or task land gate.
- Validate:
  - project repository identity and primary checkout;
  - clean primary checkout;
  - source commit resolves and belongs to the repository;
  - destination/base branch names are explicit and allowed by protected-ref policy;
  - existing PR, if supplied, belongs to the same repository and destination head.
- Perform work in an isolated temporary worktree.
- Apply exactly one source commit to the destination using a non-interactive cherry-pick/commit
  workflow; no commit ranges, merges, rebases, force pushes, or arbitrary ref updates.
- Push normally and create or update the PR through the existing source-control provider.
- Cleanup the temporary worktree on success and failure.
- Return and project a durable PM activity/audit result; repeated identical publication is
  idempotent.
- PM instructions prefer direct publication for trivial commit-routing/PR operations and retain
  tasks for implementation, uncertain work, multi-commit work, or anything needing independent
  Verify.

### Acceptance

- PM can publish one existing commit to a new explicit branch/PR without dispatching `task.create`.
- Existing matching branch/PR publication updates idempotently without force push.
- Invalid commit, dirty checkout, protected destination, mismatched PR, cherry-pick conflict, push
  failure, and provider failure return typed failures and clean up.
- PM tool schema and prompt make the taskless boundary explicit.
- Activity projection records source commit, destination/base, PR result, and outcome without
  leaking secrets.

## Out of Scope

- Skipping Verify inside ordinary task pipelines.
- PM implementation work without a task.
- Generic PM branch management, arbitrary shell Git, multi-commit publication, merge/rebase, or
  force push.
- Automatically inferring a destination branch, base branch, PR title, or PR body.
