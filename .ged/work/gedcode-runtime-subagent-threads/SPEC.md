# Spec: Gedcode-managed subagent role threads

## Goal

Make every configured Ged subagent role execute as a Gedcode-managed child thread instead of as provider/Codex-internal subagents.

Roles:

- `ged-explorer`
- `ged-planner`
- `ged-plan-reviewer`
- `ged-verifier`
- `ged-worker`

Each role must:

- use Gedcode settings for enabled/disabled state;
- use configured provider/model selection and role harness settings;
- run in its own child thread/session;
- return a captured result to the parent Ged workflow;
- allow the parent workflow to wait until child role completion before continuing.

## Current problem

The current Ged prompt describes subagent roles, so the main provider thread may use Codex/Pi/Claude-native subagent tools. Those run inside the provider harness and bypass Gedcode's role provider/model settings.

An explorer-only `GedRoleInvocationServiceLive` already creates child threads, but it is not generalized for all roles and lacks wait/result handoff semantics.

## Architecture

Implement a Gedcode-owned role orchestration path:

1. Main Ged thread emits a strict Ged role request instead of using provider-native subagent tools.
2. A server-side reactor detects role requests on completed Ged parent turns.
3. The reactor invokes requested roles through a child-thread manager.
4. The child-thread manager creates child threads with resolved role settings/model.
5. The manager waits for child turns to reach terminal state.
6. The manager captures child output and appends parent activities.
7. When intercom bridge is enabled, the server starts a parent handoff/continuation turn containing child results.

## Role invocation behavior

- Child threads use `gedWorkflowEnabled: false` to avoid recursively becoming parent workflows.
- Child prompts explicitly forbid provider-native subagents/delegation.
- Disabled global subagents or disabled role settings block invocation.
- Role model selection uses existing resolution: project role override > global role override > parent thread model > project default > global Ged main > fallback.
- Role runtime/interaction settings should be resolved through role harness settings once available; until then use safe defaults per role.

## Waiting and result capture

The child-thread manager should expose an `invokeAndWait` operation that:

- dispatches `thread.create` and `thread.turn.start`;
- subscribes to or polls orchestration state until child turn completion/failure/timeout;
- captures the final assistant text for the child turn;
- falls back to structured role artifacts where appropriate, e.g. proposed plan content for planner;
- appends `ged.role-invocation.completed` or `ged.role-invocation.failed` parent activity;
- returns role metadata, child thread id, status, and result text.

## Parent handoff

For explorer, planner, plan-reviewer, and verifier, the parent continuation waits until requested child roles finish. Worker is different: approved worker slices can run in parallel while the parent continues disjoint main-agent work, with results handed off when each worker completes.

When `gedIntercomBridgeEnabled` is enabled:

- parent continuation waits until requested blocking child roles finish;
- server dispatches a synthetic parent `thread.turn.start` with a user message containing role outputs and instructions to continue;
- this gives the main thread the child results in-context.

When disabled:

- results remain visible as parent activities;
- no automatic continuation turn is started.

## Prompt hardening

Update the Ged workflow prompt to:

- forbid provider-native subagent/Task/delegation tools for Ged roles;
- instruct the model to request role work through strict `ged-role-request` blocks;
- make role request blocks machine-parseable and unambiguous.

## Non-goals for first implementation

- Perfectly blocking every possible provider-native subagent mechanism at adapter level. Prompt hardening plus event visibility is first; adapter-level interruption can follow if needed.
- Unbounded worker parallelism. Worker can be non-blocking and parallel, but must be bounded by configured max parallelism and task suitability.
- Pushing or committing from child worker threads.

## Risks

- Parent continuation may duplicate work if role requests are processed twice; deterministic invocation ids/idempotency are required.
- Child role turns can hang on approvals; timeout handling is required.
- Worker role can conflict with parent worktree changes; run only bounded/disjoint worker tasks in parallel and cap concurrency. Unlike explorer/planner/reviewer/verifier, worker is non-blocking: parent can continue its own disjoint work while workers run.
- Large child output may exceed prompt budget; handoff needs truncation/summarization policy.

## Worker worktree strategy

`ged-worker` uses a separate worktree by default. Blocking/read-mostly roles inherit the parent thread worktree unless a future setting says otherwise.

Implementation should reuse Gedcode's existing worktree/bootstrap path rather than creating a parallel worktree implementation. If current worktree bootstrapping is only available from the WebSocket command path, extract it into a reusable server service used by both WebSocket dispatch and Ged role invocation.

Worker children should:

- request a prepared worktree using existing bootstrap semantics;
- derive deterministic branch/worktree names from the parent thread and invocation id;
- run setup scripts through the existing setup path when configured;
- report branch/worktree path in parent role activities;
- never auto-merge worker changes into the parent worktree.

## Child thread visibility

Ged role child threads should be inspectable but non-interactive.

Parent chat should render clickable role invocation activity cards for running/completed/failed roles. Clicking a card navigates to the child thread route.

Child thread route behavior:

- show transcript, activities, diffs, proposed plans, role metadata, parent link, and worktree path/branch;
- hide composer and mutating controls;
- show read-only banner indicating this is a Ged role child thread;
- allow navigation back to the parent thread.

## Child thread memory policy

Child thread shells are lightweight and may remain visible for status/linking. Child thread details should be loaded only while the user is viewing the child thread.

Add a visible-only subscription/cache policy for Ged child thread details:

- parent role activity cards use parent detail plus child shell status only;
- opening the child route subscribes to child detail;
- leaving the child route unsubscribes and evicts child detail content from memory while preserving shell state;
- child threads are excluded from normal sidebar detail prewarming.

This keeps UI memory low even when several subagents exist.
