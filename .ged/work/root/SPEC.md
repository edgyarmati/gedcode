# SPEC - Orchestrator Completion Roadmap

## Goal

Finish the Orchestrator/PM control plane so it can drive work reliably from task creation through
landing, recover from interruption, avoid wasteful polling, and provide the task and chat operations
needed for daily use.

This is a phased roadmap. Only one bounded slice should be active at a time unless two slices have
disjoint write sets and independent verification.

## Scope

### Collapsible left sidebar

- The shared left sidebar can be collapsed and reopened on desktop from a visible content-header control.
- Chat, empty-chat, Orchestrator, and Settings surfaces expose the same control; mobile sheet behavior is
  unchanged.
- The last expanded/collapsed choice is restored from the existing sidebar-state cookie on reload.
- Sidebar resizing remains available while expanded.

### Task lifecycle and reliability

- Gracefully interrupt and settle active workers before abandoning tasks or deleting worktrees.
- Expose the existing guarded `task.land` transition through PM, MCP, RPC, and UI actions.
- Add archive/restore and explicit permanent-delete semantics for terminal tasks.
- Make task creation idempotent and support explicit task supersession.
- Recover orphaned active stages after restart so tasks can be resumed or retried.
- Close worktree reaper ownership and startup-subscription races.
- Default orchestration workers to full write access and remove the obsolete opt-in controls.
- Require a successful verification attempt newer than the latest successful work attempt before
  landing can begin and open a pull request.

### PM operation

- Start PM provider sessions with an enforceable read-only policy that permits built-in file/search
  exploration without opening invisible approval requests.
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

- While a normal-chat turn is active, sending captures a durable per-thread FIFO queue item instead of
  dropping or immediately steering the message. Queue items retain the selected backend/model options,
  GED/runtime modes, images, and terminal context used when composed.
- A settled turn drains exactly one queued item with a stable command/message identity; retries after
  reconnect are idempotent. Remaining items wait for the resulting turn to settle.
- Queued rows expose **Steer**, **Delete**, and a context menu with **Edit message** and **Turn off
  queueing**. Steering sends that item immediately; disabling queueing affects future sends in that
  thread and leaves existing queued items intact.
- Add **Continue in new task** to completed assistant messages in normal chat. Codex forks provider
  state natively and rolls back only the new fork to the selected turn; older-message forks and
  providers without native support initialize a fresh session from copied visible history. Forking
  branches conversation history only and retains the current filesystem state.
- Restore a lightweight Normal/GED composer mode. GED mode injects workflow instructions and available
  skills into the main provider prompt, but does not enforce, manage, or configure subagents. Native
  subagent use remains entirely under the selected model and provider runtime.
- In an active task detail view, hide the empty Plan section while no proposed plan exists. Also hide
  the empty `No gates` card when there are no gates.
- Persist unsent composer drafts when switching between Chat and Orchestrator contexts.
- Bring Orchestrator project/task sidebars to parity with Chat for context menus, sorting, and manual
  reordering.
- Display effective worker permissions and recovery/action status.

### Worker configuration and taxonomy

- Review the worker-stage vocabulary now that the PM owns intake, task typing, splitting, scheduling,
  gates, landing, and release dispatch. Document which roles remain worker handoffs before changing the
  stage registry or playbooks.
- For every retained worker role, project and task overrides expose provider instance (harness), model,
  and supported thinking/reasoning level. Changing instance or model preserves valid option selections
  and removes options unsupported by the new model.

### Artifact lifecycle documentation

- Document workspace-local `.ged/` workflow memory separately from workspace-local `.gedcode/`
  orchestrator worktrees/leases/hooks and user-level `~/.gedcode/` settings, database, logs, and SSH
  state.
- For each artifact, state its creator, creation trigger, lifetime, cleanup owner, and whether it is safe
  to commit or delete. Link the guide from GED help/settings where users encounter the workflow.

### Workflow specialization

- Add supported task types beyond `feature`, beginning with a release workflow.
- Give release work a dedicated playbook and safe dispatch/status surface instead of treating
  `release` as an arbitrary feature label.

## Explicitly Deferred

- Server enforcement of canonical pipeline order is intentionally deferred. Existing permissive stage
  ordering remains unchanged; stages may intentionally be skipped. The post-work verification landing
  invariant is the only enforced ordering rule.
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

1. A newly started PM can inspect its project and reach an orchestration decision without stalling on
   an approval request that the PM surface cannot resolve.
2. Cancelling an active task cannot delete its worktree while its provider session or terminal is still
   running.
3. An approved land gate has an explicit, guarded action that reaches `landed` and starts the existing
   PR-opening path.
4. Terminal tasks can be archived, restored where valid, and explicitly deleted from active views.
5. Retried PM task creation returns or supersedes the existing semantic task instead of producing
   duplicates.
6. Server restart cannot leave an interrupted stage permanently occupying `currentStageThreadId`.
7. PM operation is settlement-driven; it does not continuously poll worker threads while nothing has
   changed.
8. Stop and steer actions show immediate acknowledgement and accurately report provider outcome.
9. Large tasks can be represented as a parent with ordered, independently executable child slices.
10. Normal chat supports thread forking, and unsent drafts survive context switches.
11. Active task detail omits the Plan section until a proposed plan exists and omits the gates section
    when there are no gates.
12. Orchestrator sidebars provide native context menus, sorting, and manual ordering.
13. Release tasks use a real release playbook and observable dispatch flow.
14. Landing is rejected unless the latest successful verification is newer than the latest successful
    work attempt; this applies uniformly without legacy-task fallback.
15. GED mode is selectable in normal chat and changes prompt guidance without starting managed workers
    or requiring provider-native subagents.
16. **Continue in new task** appears only on completed assistant messages, opens the fork, preserves the
    source thread, and clearly states that current filesystem state is retained.
17. Messages submitted during an active normal-chat turn appear in a durable FIFO queue; each can be
    steered, edited, or deleted, and automatic draining cannot duplicate a provider turn after retry.
18. Every retained orchestrator worker role can select harness, model, and supported thinking level at
    project and task scope, with the effective inherited selection visible.
19. A user-facing artifact guide distinguishes `.ged/`, project `.gedcode/`, and `~/.gedcode/` by
    location, creation time, ownership, retention, and deletion safety.

## Delivery Order

1. Lifecycle safety and landing.
2. Recovery, idempotency, task retention, and worker access defaults.
3. Event-driven PM operation and effective interrupt/steer behavior.
4. Parent/child task splitting.
5. Chat and sidebar UX.
6. Release specialization.
7. Queued normal-chat messages, artifact documentation, and reviewed worker-role configuration.
