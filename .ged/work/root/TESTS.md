# TESTS

## Planned

- `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` from `apps/server`
- `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` from `apps/server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck`

## Evidence

- 2026-06-12T14:02: `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` passed from `apps/server` (`1 passed`, `58 passed`).
- 2026-06-12T14:02: `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` passed from `apps/server` (`1 passed`, `35 passed`).
- 2026-06-12T14:02: `git diff --check` passed.
- 2026-06-12T14:03: After fixing a test type guard, `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` passed from `apps/server` (`1 passed`, `58 passed`).
- 2026-06-12T14:03: After fixing a test type guard, `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` passed from `apps/server` (`1 passed`, `35 passed`).
- 2026-06-12T14:03: `git diff --check` passed.
- 2026-06-12T14:03: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T14:03: `bun lint` passed with existing warnings.
- 2026-06-12T14:04: `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T14:05: Ged verifier fallback ran in the main thread because the workspace is out of subagent credits; final diff review found no blocking issues.
