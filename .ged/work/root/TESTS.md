# TESTS

## Planned

- `bun run test -- src/diagnostics/ProcessDiagnostics.test.ts src/environment/Layers/ServerEnvironmentLabel.test.ts src/project/Layers/RepositoryIdentityResolver.test.ts src/terminal/Layers/Manager.test.ts` from `apps/server`
- `bun run test -- src/command.test.ts src/tunnel.test.ts` from `packages/ssh`
- `bun run test -- src/tailscale.test.ts` from `packages/tailscale`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- 2026-06-12T09:41: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T09:42: `bun run test -- src/diagnostics/ProcessDiagnostics.test.ts src/environment/Layers/ServerEnvironmentLabel.test.ts src/project/Layers/RepositoryIdentityResolver.test.ts src/terminal/Layers/Manager.test.ts` passed from `apps/server` (`4 passed`, `53 passed`).
- 2026-06-12T09:42: `bun run test -- src/command.test.ts src/tunnel.test.ts` passed from `packages/ssh` (`2 passed`, `18 passed`).
- 2026-06-12T09:42: `bun run test -- src/tailscale.test.ts` passed from `packages/tailscale` (`1 passed`, `7 passed`).
- 2026-06-12T09:42: `git diff --check` passed.
- 2026-06-12T09:42: `bun lint` passed with existing warnings.
- 2026-06-12T09:42: `bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T09:42: Ged verifier reported no blocking findings.
