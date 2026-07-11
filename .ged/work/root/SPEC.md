# SPEC - Orchestrator Completion Roadmap

## Goal

Finish the Orchestrator/PM control plane so it can drive work reliably from task creation through
landing, recover from interruption, avoid wasteful polling, and provide the task and chat operations
needed for daily use.

This is a phased roadmap. Only one bounded slice should be active at a time unless two slices have
disjoint write sets and independent verification.

## Scope

### Task lifecycle and reliability

- Gracefully interrupt and settle active workers before abandoning tasks or deleting worktrees.
- Expose the existing guarded `task.land` transition through PM, MCP, RPC, and UI actions.
- Add archive/restore and explicit permanent-delete semantics for terminal tasks.
- Make task creation idempotent and support explicit task supersession.
- Recover orphaned active stages after restart so tasks can be resumed or retried.
- Close worktree reaper ownership and startup-subscription races.
- Default orchestration workers to full write access and remove the obsolete opt-in controls.

### PM operation

- Replace continuous PM polling with event-driven settlement and operator-requested inspection.
- Route medium-difficulty worker stages to GPT-5.6 Terra at high reasoning and difficult,
  cross-cutting stages to GPT-5.6 Sol at high reasoning.
- Make worker reasoning effort an explicit per-role/per-task backend option so PM dispatch can enforce
  the selected effort instead of relying on provider defaults.
- Improve PM thread reuse and summaries so related work does not create unnecessary threads or
  repeatedly reload full histories.
- Make interrupt and steer commands observable and effective during active Codex turns.
- Add first-class parent/child task splitting for large requests.

### User experience

- Add normal-chat thread forking.
- In an active task detail view, hide the empty Plan section while no proposed plan exists. Also hide
  the empty `No gates` card when there are no gates.
- Persist unsent composer drafts when switching between Chat and Orchestrator contexts.
- Bring Orchestrator project/task sidebars to parity with Chat for context menus, sorting, and manual
  reordering.
- Display effective worker permissions and recovery/action status.

### Workflow specialization

- Add supported task types beyond `feature`, beginning with a release workflow.
- Give release work a dedicated playbook and safe dispatch/status surface instead of treating
  `release` as an arbitrary feature label.

## Explicitly Deferred

- Server enforcement of canonical pipeline order is intentionally deferred. Existing permissive stage
  ordering remains unchanged for now.
- Automatic merging to the default branch remains out of scope. Landing opens or records a gated PR.
- Bulk implementation of this roadmap is prohibited; slices land incrementally.

## Constraints

- Preserve the append-only orchestration event log. User-facing deletion should be modeled explicitly;
  do not edit SQLite rows or erase historical events ad hoc.
- Destructive cleanup must be idempotent and restart-safe.
- Provider interruption must report requested, acknowledged, timed-out, and failed states.
- PM correctness must come from server commands and durable state, not prompt wording alone.
- Worker backend policy is Terra/high for medium work and Sol/high for difficult or high-risk work.
- Existing user changes and untracked release directories must not be modified.
- Every user-visible slice updates `CHANGELOG.md` under `## Unreleased`.
- Required repository checks are `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`. Never run
  `bun test`.

## Acceptance Criteria

1. Cancelling an active task cannot delete its worktree while its provider session or terminal is still
   running.
2. An approved land gate has an explicit, guarded action that reaches `landed` and starts the existing
   PR-opening path.
3. Terminal tasks can be archived, restored where valid, and explicitly deleted from active views.
4. Retried PM task creation returns or supersedes the existing semantic task instead of producing
   duplicates.
5. Server restart cannot leave an interrupted stage permanently occupying `currentStageThreadId`.
6. PM operation is settlement-driven; it does not continuously poll worker threads while nothing has
   changed.
7. Stop and steer actions show immediate acknowledgement and accurately report provider outcome.
8. Large tasks can be represented as a parent with ordered, independently executable child slices.
9. Normal chat supports thread forking, and unsent drafts survive context switches.
10. Active task detail omits the Plan section until a proposed plan exists and omits the gates section
    when there are no gates.
11. Orchestrator sidebars provide native context menus, sorting, and manual ordering.
12. Release tasks use a real release playbook and observable dispatch flow.

## Delivery Order

1. Lifecycle safety and landing.
2. Recovery, idempotency, task retention, and worker access defaults.
3. Event-driven PM operation and effective interrupt/steer behavior.
4. Parent/child task splitting.
5. Chat and sidebar UX.
6. Release specialization.
