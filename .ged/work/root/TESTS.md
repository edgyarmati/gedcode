# TESTS

## Planned

- `bun run test -- src/ssh/DesktopSshRemoteApi.test.ts` from `apps/desktop`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck`

## Evidence

- 2026-06-12T14:17: `bun run test -- src/ssh/DesktopSshRemoteApi.test.ts` passed from `apps/desktop` (`1 passed`, `3 passed`).
- 2026-06-12T14:17: `git diff --check` passed.
- 2026-06-12T14:17: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T14:17: `bun lint` passed with existing warnings.
- 2026-06-12T14:17: `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T14:18: Ged verifier fallback ran in the main thread because the workspace is out of subagent credits; final diff review found no blocking issues.
