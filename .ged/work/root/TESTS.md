# TESTS

## Planned

- `bun run test -- src/providerRuntime.test.ts` from `packages/contracts`
- `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` from `apps/server`
- `bun run test -- src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` from `apps/server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- 2026-06-12T12:42: `bun run test -- src/providerRuntime.test.ts` passed from `packages/contracts` (`1 passed`, `9 passed`).
- 2026-06-12T12:42: `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` passed from `apps/server` (`1 passed`, `57 passed`).
- 2026-06-12T12:42: `bun run test -- src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` passed from `apps/server` (`1 passed`, `41 passed`).
- 2026-06-12T12:42: `git diff --check` passed.
- 2026-06-12T12:42: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T12:42: `bun lint` passed with existing warnings.
- 2026-06-12T12:43: `bun typecheck` failed under default Turbo concurrency in unrelated packages with module-resolution errors; rerun with serial Turbo execution to avoid the resolver race.
- 2026-06-12T12:43: `TURBO_CONCURRENCY=1 bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T12:44: `bun run test -- src/providerRuntime.test.ts` passed from `packages/contracts` after formatting (`1 passed`, `9 passed`).
- 2026-06-12T12:44: `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` passed from `apps/server` after formatting (`1 passed`, `57 passed`).
- 2026-06-12T12:44: `bun run test -- src/orchestration/Layers/ProviderRuntimeIngestion.test.ts` passed from `apps/server` after formatting (`1 passed`, `41 passed`).
- 2026-06-12T12:44: After replacing a non-ASCII preview separator, `bun fmt`, `git diff --check`, and `bun run test -- src/provider/Layers/ClaudeAdapter.test.ts` passed.
- 2026-06-12T12:45: `bun lint` passed with existing warnings.
- 2026-06-12T12:45: `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T12:56: Ged verifier reported no blocking findings.
