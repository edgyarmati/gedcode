# Tests

## Plan

- `bun run test` targeted suites:
  - composer draft store tests for per-chat Ged toggle persistence and cleanup.
  - orchestration contract/projection/server tests for thread-created/meta-updated workflow field.
  - Ged workflow guard/service tests or provider reactor tests validating disabled threads skip injection/enforcement.
- Required completion checks:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`

## Evidence

- `bun fmt` passed.
- `bun lint` passed with 0 errors. Existing warnings remain in unrelated/react-hook lint areas.
- `bun typecheck` passed across all 14 Turbo packages.
- `bun run test --filter=@t3tools/web -- src/composerDraftStore.test.ts src/lib/chatThreadActions.test.ts` passed: 71 tests.
- `bun run test --filter=@t3tools/contracts -- src/orchestration.test.ts src/provider.test.ts` passed: 49 tests.
- `bun run test --filter=t3 -- src/orchestration/projector.test.ts src/persistence/Layers/ProjectionRepositories.test.ts` passed: 12 tests.
- Read-only verifier found two medium issues; both were addressed before final required checks:
  - Contextual new-thread inheritance now passes the active chat Ged state explicitly instead of applying sticky Ged state to unrelated drafts.
  - Provider turn dispatch now preserves omitted `gedWorkflowEnabled` so the Ged guard can still consult server defaults.
