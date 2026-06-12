# TESTS

## Planned

- `bun run test -- src/backend/tailscaleEndpointProvider.test.ts` from `apps/desktop`
- `bun run test -- src/workspace/Layers/WorkspaceEntries.test.ts` from `apps/server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck`

## Evidence

- 2026-06-12T14:24: `bun run test -- src/backend/tailscaleEndpointProvider.test.ts` passed from `apps/desktop` (`1 passed`, `5 passed`).
- 2026-06-12T14:24: `bun run test -- src/workspace/Layers/WorkspaceEntries.test.ts` passed from `apps/server` (`1 passed`, `15 passed`).
- 2026-06-12T14:24: `git diff --check` passed.
- 2026-06-12T14:24: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T14:24: `bun lint` passed with existing warnings.
- 2026-06-12T14:24: `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T14:25: Ged verifier fallback ran in the main thread because the workspace is out of subagent credits; final diff review found no blocking issues.
