# Verification Plan

## Automated

- Decider task tests:
  - task creation is independent of the concurrency limit;
  - an eight-child split is accepted under a lower concurrency limit;
  - stage startup succeeds below the limit;
  - stage startup fails at the limit.
- Existing shared/contracts/settings logic tests affected by copy or resolution changes.
- `bun fmt`
- `bun lint`
- Narrow server, contracts, shared, and web typechecks as required by the changed files.

## Expected Outcome

Every command exits successfully. Focused tests demonstrate that task inventory is unbounded by
`maxParallelTasks`, while active worker-stage admission remains fail-closed at the configured limit.

## Evidence

- `bun run test src/orchestration/decider.task.test.ts
  src/orchestration/Layers/OrchestrationEngine.test.ts` from `apps/server`: 2 files, 105 tests
  passed.
- `bun fmt`: passed.
- `bun lint`: passed with existing repository warnings and no errors.
- `bunx turbo run typecheck --filter=gedcode --filter=@t3tools/contracts
  --filter=@t3tools/web`: 8 dependency-aware package checks passed.
- Manual diff review confirmed task creation and splitting no longer consume concurrent-task
  capacity, while the pure decider rejects stage starts at the configured project limit.
