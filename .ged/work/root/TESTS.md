# Tests

## Expected

- `bun run test -- src/model.test.ts` from `packages/shared`
- `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` from `apps/server`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- PASS: `bun run test -- src/model.test.ts` from `packages/shared` (12 tests).
- PASS: `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` from `apps/server` (34 tests).
- PASS: `bun fmt`.
- PASS: `bun lint` with existing warnings only.
- PASS: `bun typecheck` after rerun; first root run hit transient `vitest` resolver errors in existing server test files, direct `apps/server` typecheck passed, and final root typecheck passed.
