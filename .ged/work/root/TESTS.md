# Tests

## Required

- `bun fmt`
- `bun lint`
- `bun typecheck`

## Focused

- `bun run test -- src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` from `apps/server`
- `bun run test -- src/gedWorkflow/Layers/GedWorkflowEventReactor.test.ts` from `apps/server`
- `bun run test -- src/GedBootstrap.test.ts src/WorkflowPrompt.test.ts` from `packages/ged-workflow`

## Evidence

- PASS: `bun run test -- src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` from `apps/server` (15 tests).
- PASS: `bun run test -- src/gedWorkflow/Layers/GedWorkflowEventReactor.test.ts` from `apps/server` (13 tests).
- PASS: `bun run test -- src/GedBootstrap.test.ts src/WorkflowPrompt.test.ts` from `packages/ged-workflow` (21 tests).
- PASS: `bun fmt`.
- PASS: `bun lint` with existing warnings only.
- PASS: `bun typecheck` after rerun; first run hit transient server package resolution for `effect/Layer`, direct `apps/server` typecheck and final root typecheck passed.
