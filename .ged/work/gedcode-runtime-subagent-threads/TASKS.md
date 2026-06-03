# Tasks

## Slice 1: Role registry and prompts

1. Add server role metadata for all Ged subagent roles.
2. Add prompt builders for planner, plan-reviewer, verifier, and worker.
3. Generalize explorer prompt conventions across all role prompts.
4. Ensure all child prompts forbid provider-native subagents/delegation.

## Slice 2: Generic child-thread invocation

1. Generalize `GedRoleInvocationServiceLive` beyond explorer.
2. Resolve enabled state and model settings for every role.
3. Create child threads/turns with resolved role model and safe runtime defaults.
4. Keep child `gedWorkflowEnabled: false`.
5. Emit started/child activities for every role.

## Slice 3: Wait and result capture

1. Add `invokeAndWait` lifecycle operation.
2. Wait for child turn terminal state through orchestration events/projection state.
3. Capture assistant final text and role artifact fallbacks.
4. Add timeout/failure handling.
5. Emit completed/failed parent activities.
6. Make invocation ids idempotent.

## Slice 4: Parent role-request reactor

1. Define strict `ged-role-request` format.
2. Implement parser with unit tests.
3. Add server reactor that observes completed parent Ged turns.
4. Ignore child threads and non-Ged parent turns.
5. Invoke requested roles sequentially.
6. Start parent result handoff turn when intercom bridge is enabled.
7. Wire reactor into production server layer.

## Slice 5: Prompt and UI copy updates

1. Update `WorkflowPrompt` to stop telling providers to run subagents directly.
2. Instruct parent thread to emit role requests instead.
3. Update web role metadata so all roles are runtime-capable, no longer configuration-only.
4. Add visible failure/activity copy for disabled roles/timeouts.

## Slice 6: Worker parallelism and safety

1. Treat worker as the only non-blocking Ged subagent role.
2. Allow bounded parallel worker invocations for approved disjoint/easy slices.
3. Let the parent main thread continue disjoint main-agent work while workers run.
4. Enforce worker suitability and max parallelism settings.
5. Ensure worker child prompt forbids commit/push/product decisions.
6. Handoff worker results as they complete; parent incorporates/adjudicates them before final verification/commit.
7. Add tests covering worker parallelism, max-parallel enforcement, and result handoff.

## Slice 7: Worker worktree bootstrap reuse

1. Extract existing worktree/bootstrap dispatch logic into a reusable server service if needed.
2. Route WebSocket thread bootstrap and Ged worker invocation through the same service.
3. For worker role requests, create child threads with prepared separate worktrees by default.
4. Use deterministic worker branch/worktree names derived from parent thread and invocation id.
5. Include worker branch/worktree metadata in parent role activities and handoff output.
6. Fail visibly if worker worktree creation fails and no explicit fallback is configured.

## Slice 8: Child thread visibility and read-only UI

1. Add durable parent/child role-origin metadata to thread create/projection contracts.
2. Render parent timeline role invocation cards for started/completed/failed role threads.
3. Make role cards clickable and navigate to the child thread.
4. Add read-only child thread route/view for `ged-role-invocation` origin threads.
5. Hide composer and mutating controls in child role thread view.
6. Add parent back-link and role/worktree metadata banner.

## Slice 9: Child thread memory policy

1. Add visible-only thread detail subscription/cache policy for Ged child threads.
2. Ensure parent cards use child shell state only, not child detail subscriptions.
3. Subscribe to child detail only while child route is mounted.
4. Unsubscribe and evict child detail content on unmount while preserving shell state.
5. Exclude child role threads from sidebar detail prewarming.
