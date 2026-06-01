# Tasks

## Revised Planning

1. [x] Read latest `.ged/work/root` planning artifacts and latest runtime state.
2. [x] Run explorer discovery and skill-fit reconnaissance.
3. [x] Run `ged-plan-reviewer` critique.
4. [x] Replace stale root planning artifacts with an implementation-ready initial-slice plan.
5. [x] Review/approve revised plan before source implementation.

## Slice 1: Explorer Prompt Builder

1. [x] Add `apps/server/src/gedWorkflow/GedExplorerPrompt.ts`.
2. [x] Implement `buildGedExplorerPrompt`.
3. [x] Include invocation, parent thread, project/workspace, branch, worktree, and model context.
4. [x] Enforce read-only/no-artifact-write instructions.
5. [x] Enforce exact plain-text final output sections.

## Slice 2: Service API And Errors

1. [x] Add `apps/server/src/gedWorkflow/Services/GedRoleInvocationService.ts`.
2. [x] Define `GedRoleInvocationInput`, `GedRoleInvocationResult`, and service shape.
3. [x] Support only `role: "ged-explorer"`.
4. [x] Require caller-supplied `invocationId`; do not generate it internally.
5. [x] Add local validation for `invocationId` and `request`.
6. [x] Add typed/local errors for invalid input, missing parent context, and orchestration dispatch failure.

## Slice 3: Live Service Implementation

1. [x] Add `apps/server/src/gedWorkflow/Layers/GedRoleInvocationServiceLive.ts`.
2. [x] Depend on `OrchestrationEngineService` and `ProjectionSnapshotQuery`.
3. [x] Resolve parent thread detail and project shell.
4. [x] Copy exact parent `modelSelection`, `projectId`, `branch`, and `worktreePath`.
5. [x] Derive deterministic child thread id, command ids, and activity ids from `invocationId`.
6. [x] Dispatch in order: child `thread.create`, parent activity, child activity, child `thread.turn.start`.
7. [x] Use exact child `runtimeMode: "approval-required"` and `interactionMode: "default"`.
8. [x] Set `gedWorkflowEnabled: false` on child thread create and child turn start.
9. [x] Implement partial-failure stop/no-rollback/best-effort-failure-activity behavior.
10. [x] Do not modify websocket/native APIs, contracts, or web UI.

## Slice 4: Focused Tests

1. [x] Add prompt builder tests.
2. [x] Add service input/context failure tests.
3. [x] Add service successful dispatch tests.
4. [ ] Add partial-failure behavior tests.
5. [ ] Add provider reactor integration coverage for routing, runtime mode, cwd, and `gedWorkflowEnabled: false`.
6. [x] Run targeted server tests.
7. [x] Run required repo checks.
