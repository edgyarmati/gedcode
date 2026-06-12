# TESTS

## Planned

- `bun run test src/orchestration/projector.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts src/orchestration/Layers/ProviderRuntimeIngestion.test.ts src/provider/Layers/ClaudeAdapter.test.ts src/provider/Layers/CursorAdapter.test.ts src/provider/Layers/OpenCodeAdapter.test.ts` from `apps/server`
- `bun run test src/store.test.ts src/session-logic.test.ts` from `apps/web`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- 2026-06-12T06:56: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T06:56: `bun run test src/orchestration/projector.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts src/orchestration/Layers/ProviderRuntimeIngestion.test.ts src/provider/Layers/ClaudeAdapter.test.ts src/provider/Layers/CursorAdapter.test.ts src/provider/Layers/OpenCodeAdapter.test.ts` passed from `apps/server` (`6 passed`, `159 passed`).
- 2026-06-12T06:56: `bun run test src/store.test.ts src/session-logic.test.ts` passed from `apps/web` (`2 passed`, `70 passed`).
- 2026-06-12T06:56: `git diff --check` passed.
- 2026-06-12T06:57: `bun lint` passed with existing warnings.
- 2026-06-12T06:57: `bun typecheck` passed (`14 successful`, `14 total`).
