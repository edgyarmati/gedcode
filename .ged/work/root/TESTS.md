# Verification Plan

## Automated

- `pmTools` focused tests prove active-stage steering remains available.
- Completed-stage steering fails without dispatching `thread.turn.start`.
- Omitted stage selection never falls back to the latest completed worker thread.
- Superseded-stage steering fails without dispatching `thread.turn.start`.
- `bun fmt`
- `bun lint`
- Narrow server typecheck

## Expected Outcome

No provider continuation can be queued for a stage whose completion is no longer awaited by the
task lifecycle.

## Evidence

- `bun run test src/orchestration/pm/pmTools.test.ts` from `apps/server`: 62 tests passed.
- `bun fmt`: passed.
- `bun lint`: passed with existing repository warnings and no errors.
- `bunx turbo run typecheck --filter=gedcode`: 8 dependency-aware package checks passed.
- Manual diff review confirmed rejected steering dispatches no provider command and active-stage
  steering retains the selected thread's runtime and interaction modes. Default steering resolves
  only the active stage and never falls back to the latest completed worker thread.
