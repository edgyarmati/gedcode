# TESTS

## Planned

- `bun run test -- src/provider/Layers/CursorProvider.test.ts` from `apps/server`
- `bun run test -- src/provider/acp/CursorAcpExtension.test.ts` from `apps/server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck`

## Evidence

- 2026-06-12T14:10: Initial `bun run test -- src/provider/Layers/CursorProvider.test.ts` failed because the mock extension response exposed bracket-encoded fallback model ids instead of Cursor base model ids; fixture corrected before final verification.
- 2026-06-12T14:10: `bun run test -- src/provider/acp/CursorAcpExtension.test.ts` passed from `apps/server` (`1 passed`, `5 passed`).
- 2026-06-12T14:10: After correcting the mock fixture, `bun run test -- src/provider/Layers/CursorProvider.test.ts` passed from `apps/server` (`1 passed`, `21 passed`).
- 2026-06-12T14:10: After correcting the mock fixture, `bun run test -- src/provider/acp/CursorAcpExtension.test.ts` passed from `apps/server` (`1 passed`, `5 passed`).
- 2026-06-12T14:10: `git diff --check` passed.
- 2026-06-12T14:11: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T14:11: `bun lint` passed with existing warnings and one new schema-hoisting warning; hoisted the decoder before final verification.
- 2026-06-12T14:11: After hoisting the Cursor response decoder, `bun run test -- src/provider/Layers/CursorProvider.test.ts` passed from `apps/server` (`1 passed`, `21 passed`).
- 2026-06-12T14:11: After hoisting the Cursor response decoder, `bun run test -- src/provider/acp/CursorAcpExtension.test.ts` passed from `apps/server` (`1 passed`, `5 passed`).
- 2026-06-12T14:11: After hoisting the Cursor response decoder, `git diff --check` passed.
- 2026-06-12T14:11: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T14:11: `bun lint` passed with existing warnings.
- 2026-06-12T14:11: A chained `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` run failed transiently in `@t3tools/tailscale` resolving `@effect/vitest`; rerunning the same typecheck command standalone passed.
- 2026-06-12T14:11: Standalone `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T14:12: Ged verifier fallback ran in the main thread because the workspace is out of subagent credits; final diff review found no blocking issues.
