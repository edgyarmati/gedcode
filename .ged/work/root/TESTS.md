# TESTS

## Planned

- `bun run test src/vcs/GitVcsDriverCore.test.ts src/vcs/VcsStatusBroadcaster.test.ts` from `apps/server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- 2026-06-11T15:05: `bun run test src/vcs/GitVcsDriverCore.test.ts src/vcs/VcsStatusBroadcaster.test.ts` passed from `apps/server` (`2 passed`, `26 passed`).
- 2026-06-11T15:05: `git diff --check` passed.
- 2026-06-11T15:06: `bun fmt` passed (`oxfmt`, 1232 files).
- 2026-06-11T15:06: `bun lint` passed with existing warnings.
- 2026-06-11T15:06: `bun typecheck` passed (`14 successful, 14 total`).
