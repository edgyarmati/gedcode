# TESTS

## Focused Tests

- `packages/contracts`: orchestrator config/settings tests for `maxRetriesPerStage`; orchestration schema decode tests for stage block command/event.
- `apps/server` persistence tests for quota projection migration/repository.
- `apps/server` projector/decider tests for `task.stage.block` and retry limit behavior.
- `apps/server` ProviderRuntimeIngestion tests for quota telemetry/error projection.
- `apps/server` ProviderCommandReactor tests for blocked-instance admission.
- `apps/server` resumption tests proving exactly-one `task.stage.start` after blocked->ok.

## Required Checks

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

## Evidence

- `cd apps/server && bun run test src/orchestration/Layers/ProviderCommandReactor.test.ts src/orchestration/Layers/ProviderRuntimeIngestion.test.ts src/orchestration/Layers/CheckpointReactor.stageGate.test.ts src/orchestration/Layers/CheckpointReactor.test.ts integration/orchestrationEngine.integration.test.ts` passed: 5 files, 108 passed, 1 skipped.
- `cd apps/server && bun run test src/git/GitManager.test.ts -t "status ignores synthetic local branch aliases when the upstream remote name contains slashes"` passed after raising the overloaded Git status test timeout.
- `bun fmt` passed.
- `bun lint` passed with pre-existing warnings.
- `bun typecheck` passed: 13/13 turbo tasks.
- `bun run test` passed: 13/13 turbo tasks; server suite 152 files, 1214 passed, 1 skipped.
