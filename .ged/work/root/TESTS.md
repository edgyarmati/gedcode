# TESTS

## Evidence

- Release `v0.1.1-nightly.20260610.1` publishes `nightly-mac.yml`, `nightly.yml`, and `nightly-linux.yml` with version `0.1.1-nightly.20260610.1` and matching artifact paths.
- Downloaded macOS arm64 artifact `GedCode-0.1.1-nightly.20260610.1-arm64.zip`; `GedCode (Nightly).app/Contents/Info.plist` contains `CFBundleShortVersionString` and `CFBundleVersion` set to `0.1.1-nightly.20260610.1`.
- Settings version label is built from `import.meta.env.APP_VERSION`, which `apps/web/vite.config.ts` resolves from `apps/web/package.json` or `APP_VERSION` during release builds.
- `cd apps/desktop && bun run test src/updates/DesktopUpdates.test.ts` passed: 9 tests.
- `bun fmt` passed.
- `bun lint` passed with existing warnings.
- `bun typecheck` passed after replacing `effect/Sink` subpath imports with the package-root `Sink` export.
- `bun run test` passed: 14 Turbo tasks successful; server package 1068 passed / 4 skipped, all package tasks successful.
