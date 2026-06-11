# TESTS

## Planned

- `bun run test`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- 2026-06-11T10:17:51+02:00: `bun run test && bun fmt && bun lint && bun typecheck` passed.
- `bun run test`: 14 Turbo tasks successful; `gedcode:test` reported 128 passed, 1 skipped files and 1068 passed, 4 skipped tests.
- `bun fmt`: `oxfmt` completed successfully.
- `bun lint`: `oxlint --report-unused-disable-directives` completed successfully with existing warnings.
- `bun typecheck`: 14 Turbo tasks successful.
