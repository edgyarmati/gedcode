# Concurrent Task Admission

## Goal

Make `maxParallelTasks` limit tasks that are actually executing worker stages instead of limiting
the number of non-terminal task records or approved split children.

## Constraints

- Keep the persisted `maxParallelTasks` configuration key; no migration or compatibility fallback.
- Preserve the existing single-active-stage-per-task invariant.
- Enforce the project-resolved limit in the pure decider so concurrent command handling cannot bypass
  it.
- Continue enforcing dependency readiness before a child stage can start.
- Do not add a separate task-inventory or materialized-worktree limit in this change.
- Run focused tests, `bun fmt`, `bun lint`, and the narrowest relevant package typecheck.
- Document the user-visible behavior change under `CHANGELOG.md` `## Unreleased`.

## Acceptance Criteria

1. A task can be created when other non-terminal tasks exist, regardless of `maxParallelTasks`.
2. An inactive parent can be split into all eight approved children when `maxParallelTasks` is lower
   than eight.
3. Starting a worker stage is rejected when the project already has `maxParallelTasks` tasks with
   active stages.
4. Starting a stage remains allowed below the configured limit.
5. Terminal tasks and inactive tasks do not consume concurrent-task capacity.
6. Contracts, comments, and settings labels describe runtime task concurrency accurately.
7. Focused decider and configuration/UI logic tests pass.
