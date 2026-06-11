# TESTS

## Planned

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
- `bun run release:smoke`

## Evidence

- 2026-06-11T10:45:00+02:00: `bun fmt && bun lint && bun typecheck && bun run test && bun run release:smoke` passed.
- `bun fmt`: `oxfmt` completed successfully.
- `bun lint`: `oxlint --report-unused-disable-directives` completed successfully with existing warnings.
- `bun typecheck`: 14 Turbo tasks successful.
- `bun run test`: 14 Turbo tasks successful; `gedcode:test` reported 128 passed, 1 skipped files and 1068 passed, 4 skipped tests.
- `bun run release:smoke`: release smoke checks passed.
