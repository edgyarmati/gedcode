# TESTS

## Planned

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
- `bun run release:smoke`
- Confirm `gh workflow run release.yml --ref main -f version=0.1.1-nightly.20260610.1`

## Evidence

- PASS: `bun fmt`
- PASS: `bun lint` (warnings only; exit code 0)
- PASS: `bun typecheck`
- PASS: `bun run test`
- PASS: `bun run release:smoke`
- Pending: release workflow dispatch confirmation for `0.1.1-nightly.20260610.1`
