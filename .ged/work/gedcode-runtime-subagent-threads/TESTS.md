# Tests

## Unit tests

- Role registry includes explorer, planner, plan-reviewer, verifier, and worker.
- Role prompt builders include role boundary, no-provider-native-subagents instruction, and stable output sections.
- Role request parser accepts valid strict requests for all roles.
- Role request parser rejects malformed JSON, unknown roles, duplicate/oversized requests, and extra non-request text when strict mode requires only a request.
- Model selection keeps existing precedence.

## Server service tests

- Each role creates one child thread and one child turn.
- Child thread/turn uses resolved role model selection.
- Disabled global subagents or disabled role blocks invocation.
- Child thread/turn always has `gedWorkflowEnabled: false`.
- `invokeAndWait` returns completed result text after child turn completion.
- Timeout returns failed status and appends failure activity.
- Planner result capture can fall back to proposed plan output.

## Reactor/integration tests

- Completed parent Ged turn with role request launches Gedcode-managed child role thread.
- Parent handoff turn is not dispatched until child completion.
- Parent handoff contains child role metadata and result text.
- Reactor ignores child threads and normal non-request assistant output.
- Duplicate terminal events do not duplicate invocations.
- Worker role invocations can run in bounded parallel according to max parallelism, while blocking roles still make the parent wait.

## Required checks

- `bun fmt`
- `bun lint`
- `bun typecheck`
- Focused server Ged workflow tests added for this work.
- `bun run test` before commit.

## Worker worktree tests

- Worker invocation uses existing bootstrap/worktree service with `prepareWorktree` semantics.
- Non-worker roles do not create separate worktrees by default.
- Worker branch/worktree names are deterministic and collision-safe.
- Worktree setup failure appends a visible parent failure activity.
- Worker handoff includes child thread id, branch, worktree path, and result metadata.

## Child thread UI and memory tests

- Parent timeline renders clickable running/completed/failed role activity cards.
- Clicking a role card navigates to the child thread route.
- Child route renders read-only transcript and metadata banner.
- Composer and mutating controls are hidden for role child threads.
- Parent role cards do not subscribe to child thread detail.
- Child view subscribes on mount and unsubscribes on unmount.
- Child detail content is evicted on unmount while shell status remains.
- Sidebar detail prewarm excludes Ged role child threads.
