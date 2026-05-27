# Tests

## Current Status

No source implementation for the revised `GedRoleInvocationService` slice has been applied yet.

Existing evidence:

- Explorer confirmed orchestration, provider reactor, Ged guard bypass, and activity surfaces are available.
- Reviewer blockers addressed in the revised plan: explicit invocation entry point, stale state, invocation id semantics, prompt contract, exact runtime mode, context resolution, and partial-failure behavior.

## Prompt Builder Tests

Target: `apps/server/src/gedWorkflow/GedExplorerPrompt.test.ts`

Checks: prompt identifies `ged-explorer`, includes invocation/thread/project/worktree/model context, states read-only boundaries, forbids source/`.ged`/artifact writes and commits, requires plain text not JSON, and includes exact output sections in order.

## Service Unit Tests

Target: `apps/server/src/gedWorkflow/Layers/GedRoleInvocationService.test.ts`

Success checks: child thread has copied parent context/model selection, `runtimeMode: "approval-required"`, `interactionMode: "default"`, and `gedWorkflowEnabled: false`; child turn has prompt output, no attachments, copied model selection, and `gedWorkflowEnabled: false`; parent/child activities have expected kinds and payloads.

Failure checks: unsupported role, invalid `invocationId`, blank request, missing parent, and missing project fail before dispatch; null branch/worktree copy through; partial dispatch failures stop before unsafe later steps and attempt best-effort failure activity where applicable.

## Provider Reactor Integration Test

Target: existing or new server integration test around `ProviderCommandReactor`.

Checks: service-created child turn flows through orchestration, provider session/sendTurn receive copied model instance, cwd/runtime mode are correct, and Ged workflow prompt suffix is not injected.

## Required Commands

```sh
cd apps/server && bun run test src/gedWorkflow/GedExplorerPrompt.test.ts
cd apps/server && bun run test src/gedWorkflow/Layers/GedRoleInvocationService.test.ts
cd apps/server && bun run test src/orchestration/Layers/ProviderCommandReactor.test.ts
bun fmt
bun lint
bun typecheck
```

Use `bun run test`, never `bun test`.
