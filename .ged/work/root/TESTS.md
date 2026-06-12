# TESTS

## Planned

- `bun run test -- src/codexModelOptions.test.ts` from `apps/server`
- `bun run test -- src/provider/Layers/CodexAdapter.test.ts` from `apps/server`
- `bun run test -- src/provider/Layers/CodexProvider.test.ts` from `apps/server`
- `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` from `apps/server`
- `bun run test -- src/provider/makeManagedServerProvider.test.ts` from `apps/server`
- `bun run test -- src/textGeneration/CodexTextGeneration.test.ts` from `apps/server`
- `bun run test -- src/client.test.ts` from `packages/effect-codex-app-server`
- `bun run test -- src/protocol.test.ts` from `packages/effect-codex-app-server`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck`

## Evidence

- PASS: `bun run test -- src/codexModelOptions.test.ts` from `apps/server` (1 file, 2 tests)
- PASS: `bun run test -- src/provider/Layers/CodexAdapter.test.ts` from `apps/server` (1 file, 22 tests)
- PASS: `bun run test -- src/provider/Layers/CodexProvider.test.ts` from `apps/server` (1 file, 2 tests)
- PASS: `bun run test -- src/provider/Layers/ProviderRegistry.test.ts` from `apps/server` (1 file, 36 tests)
- PASS: `bun run test -- src/provider/makeManagedServerProvider.test.ts` from `apps/server` (1 file, 4 tests)
- PASS: `bun run test -- src/textGeneration/CodexTextGeneration.test.ts` from `apps/server` (1 file, 15 tests)
- PASS: `bun run test -- src/client.test.ts` from `packages/effect-codex-app-server` (1 file, 3 tests; passed after adding the missing local `mockPeerArgs` helper)
- PASS: `bun run test -- src/protocol.test.ts` from `packages/effect-codex-app-server` (1 file, 3 tests)
- PASS: `bun run test -- src/provider/Layers/CodexProvider.test.ts` from `apps/server` after service-tier option builder cleanup (1 file, 2 tests)
- PASS: `git diff --check`
- PASS: `bun fmt`
- PASS: `bun lint` (passes with existing warnings)
- PASS: `TURBO_DAEMON=false TURBO_CONCURRENCY=1 bun typecheck` final rerun (14 packages)
- NOTE: Earlier typecheck attempts failed transiently resolving dependencies from unrelated packages, then one rerun exposed and fixed a local readonly type issue in the service-tier option builder.
