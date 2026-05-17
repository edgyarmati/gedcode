# Tests

## Plan

- `bun fmt`
- Confirm `apps/server/src/server.ts` is clean and recorder files are not present.
- `bun lint`
- `bun typecheck`

## Evidence

- `bun run test src/gedWorkflow/Layers/GedWorkflowCheckpointRecorder.test.ts` from `apps/server/` passed while evaluating the recorder: 1 file, 3 tests.
- Final verifier found the recorder over-credited verifier checkpoints, so the server change was removed instead of committed.
- `git diff -- apps/server/src/server.ts` is empty; recorder source and test files are absent.
- `bun fmt` passed on the final state.
- `bun lint` passed on the final state with existing warnings outside this change.
- `bun typecheck` passed on the final state: 14 packages.
