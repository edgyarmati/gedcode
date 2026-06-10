# TESTS

## Planned

- `bun run test --filter=@t3tools/scripts`
- Focused provider registry test command using `bun run test`
- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
- Release workflow dispatch confirmation

## Evidence

- Failure evidence: release run `27283195015` failed in `Resolve previous release tag` with `Invalid stable release tag 'v0.1.1-nightly.20260610.1'`.
- Failure evidence: CI run `27282954747` failed in `src/provider/Layers/ProviderRegistry.test.ts` at the `re-probes when settings change the codex binaryPath` timestamp assertion.
- PASS: `bun run test --filter=@t3tools/scripts -- resolve-previous-release-tag.test.ts`
- Initial focused provider-registry command used the wrong Bun workspace filter syntax and failed with `No packages matched the filter`.
- PASS: `bun run test --filter=gedcode -- src/provider/Layers/ProviderRegistry.test.ts -t "re-probes when settings change the codex binaryPath"`
- PASS: `bun fmt`
- PASS: `bun lint` (existing warnings only)
- PASS: `bun typecheck`
- PASS: `bun run test`
- PASS: `bun run release:smoke`
- PASS: GitHub CI run `27283813766`
- PASS: GitHub release run `27283814112` for `0.1.1-nightly.20260610.1`
