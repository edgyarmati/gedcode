# Spec

## Goal

Implement the first bounded Ged workflow orchestration slice: a server-side `GedRoleInvocationService` that can explicitly invoke one read-oriented child role, `ged-explorer`, through the existing orchestration engine.

This slice proves parent/child role-thread dispatch, provider-instance routing, workflow-recursion prevention, activity-based linkage, and prompt contract shape without adding a user-facing websocket/native API or automatic parent-turn interception.

## Scope

In scope:

- Add `GedRoleInvocationService` under `apps/server/src/gedWorkflow`.
- Support exactly one role: `ged-explorer`.
- Keep the entry point server-internal and test-only for this slice; no websocket/native/web/contracts API.
- Require caller-supplied `invocationId`; the service does not generate one yet.
- Create a child thread and start one child turn via orchestration commands.
- Copy parent `projectId`, `branch`, `worktreePath`, and exact `modelSelection`, including `instanceId` and options.
- Force child safety settings: `runtimeMode: "approval-required"`, `interactionMode: "default"`, and `gedWorkflowEnabled: false` on child thread and turn.
- Link parent and child only through existing `thread.activity.append` activities.
- Define a server-side `ged-explorer` prompt builder with fixed plain-text output sections.

Out of scope: user-facing API/UI changes, new contracts schemas, durable invocation store, automatic parent-turn interception, role completion tracking, output parsing, artifact writes, provider-level sandboxing, Pi integration, planner/verifier roles, and worker execution.

## Service API

Add `GedRoleInvocationService.ts`, `GedRoleInvocationServiceLive.ts`, and `GedExplorerPrompt.ts` under `apps/server/src/gedWorkflow`.

Initial input/result shape:

```ts
export type GedRole = "ged-explorer";

export interface GedRoleInvocationInput {
  readonly role: "ged-explorer";
  readonly invocationId: string;
  readonly parentThreadId: ThreadId;
  readonly request: string;
}

export interface GedRoleInvocationResult {
  readonly role: "ged-explorer";
  readonly invocationId: string;
  readonly parentThreadId: ThreadId;
  readonly childThreadId: ThreadId;
}
```

`invocationId` is required from caller, validated before dispatch with the same safe alphabet used by derived ids (`[A-Za-z0-9_-]`), and used to derive deterministic child thread id, command ids, and activity ids for testability and best-effort retry behavior.

## Context Resolution

Inputs do not override parent context.

1. Resolve parent thread detail by `parentThreadId`.
2. Resolve parent project shell by parent `projectId`.
3. Copy parent `projectId`, `modelSelection`, `branch`, and `worktreePath`.
4. Use project shell only for prompt context and existing provider cwd fallback.
5. Effective cwd for prompt display is `parent.worktreePath ?? project.workspaceRoot`.

Fail before dispatch with no side effects for unsupported role, invalid `invocationId`, blank request, missing parent thread, missing project, or malformed/missing parent model selection.

## Command Sequence

Dispatch through `OrchestrationEngineService` only:

1. `thread.create` child with deterministic `threadId`, copied context/model selection, title `Ged Explorer`, `runtimeMode: "approval-required"`, `interactionMode: "default"`, and `gedWorkflowEnabled: false`.
2. Parent `thread.activity.append` kind `ged.role-invocation.started` with invocation/parent/child/project/worktree payload.
3. Child `thread.activity.append` kind `ged.role-invocation.child` with invocation/parent/child/project payload.
4. Child `thread.turn.start` with prompt-builder text, no attachments, copied `modelSelection`, `runtimeMode: "approval-required"`, `interactionMode: "default"`, and `gedWorkflowEnabled: false`.

## Explorer Prompt Contract

`buildGedExplorerPrompt` must tell the child role that it is read-only, must inspect and report without modifying files, must not write source files, `.ged` files, plans, tests, commits, or artifacts, and must avoid mutating commands.

The final answer is plain text, not JSON, with exact top-level sections in order: `## Summary`, `## Scope Inspected`, `## Findings`, `## Evidence`, `## Risks And Constraints`, `## Open Questions`, `## Recommended Follow-Up Checks`.

The service does not parse the output.

## Partial-Failure Behavior

- Input/context failures happen before dispatch and leave no side effects.
- After each successful step, continue to the next step.
- On dispatch failure, stop immediately.
- Do not rollback/delete child threads; partial state remains for auditability.
- Attempt best-effort `ged.role-invocation.failed` activity on parent and child when applicable.
- Failure activity errors are logged/ignored and must not mask the original error.
- Once child turn start is accepted, the service returns success; provider/runtime failures are handled by existing ingestion paths.

## Risks

- Read-only is prompt/runtime-mode constrained, not provider-sandbox guaranteed.
- Partial multi-command state can exist until durable invocation storage exists.
- Child threads are normal visible threads until a grouping policy exists.
- Activities are the only parent/child linkage in this slice.
