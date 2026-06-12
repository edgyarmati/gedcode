# TESTS

## Planned

- `bun run test -- src/client.test.ts src/protocol.test.ts` from `packages/effect-acp`
- `bun run test -- src/client.test.ts` from `packages/effect-codex-app-server`
- `bun run build` from `apps/server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- 2026-06-12T12:27: `bun run test -- src/client.test.ts src/protocol.test.ts` passed from `packages/effect-acp` (`2 passed`, `14 passed`).
- 2026-06-12T12:27: `bun run test -- src/client.test.ts` passed from `packages/effect-codex-app-server` (`1 passed`, `2 passed`).
- 2026-06-12T12:27: `bun run build` passed from `apps/server`.
- 2026-06-12T12:27: `git diff --check` passed.
- 2026-06-12T12:27: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-12T12:27: `bun lint` passed with existing warnings.
- 2026-06-12T12:27: `bun typecheck` passed (`14 successful`, `14 total`).
- 2026-06-12T12:29: Ged verifier reported no blocking findings.
