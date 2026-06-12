# TESTS

## Planned

- `bun run test -- src/sourceControl/GitHubSourceControlProvider.test.ts` from `apps/server`
- `bun run test -- src/sourceControl/GitLabSourceControlProvider.test.ts` from `apps/server`
- `bun run test -- src/sourceControl/SourceControlProviderRegistry.test.ts` from `apps/server`
- `bun run test -- src/sourceControl/SourceControlDiscovery.test.ts` from `apps/server`
- `bun run test -- src/sourceControl/AzureDevOpsCli.test.ts` from `apps/server`
- `bun run test -- src/sourceControl.test.ts` from `packages/shared`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck`

## Evidence

- PASS: `bun run test -- src/sourceControl/GitHubSourceControlProvider.test.ts` from `apps/server` (1 file, 8 tests)
- PASS: `bun run test -- src/sourceControl/GitLabSourceControlProvider.test.ts` from `apps/server` (1 file, 6 tests)
- PASS: `bun run test -- src/sourceControl/SourceControlProviderRegistry.test.ts` from `apps/server` (1 file, 8 tests)
- PASS: `bun run test -- src/sourceControl/SourceControlDiscovery.test.ts` from `apps/server` (1 file, 2 tests)
- PASS: `bun run test -- src/sourceControl/AzureDevOpsCli.test.ts` from `apps/server` (1 file, 7 tests)
- PASS: `bun run test -- src/sourceControl.test.ts` from `packages/shared` (1 file, 5 tests)
- PASS: `git diff --check`
- PASS: `bun fmt`
- PASS: `bun lint` (passes with existing warnings)
- PASS: `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` (14 packages)
- PASS: Ged verifier fallback ran in the main thread at 2026-06-12T14:39:46Z because the workspace is out of subagent credits; final diff review found no blocking issues.
