# Tests

## Required

- `bun fmt` passed.
- `bun lint` passed with existing warnings only.
- `bun typecheck` passed.

## Focused

- `bun run test -- src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` from `apps/server` passed: 1 file, 13 tests.

## Evidence

- Initial root-level `bun run test apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` failed because Turbo treated the file path as a task name; reran the package test script with `--` from `apps/server`.
