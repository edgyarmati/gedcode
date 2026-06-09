# Tests

## Required

- `bun fmt` passed.
- `bun lint` passed with existing warnings only.
- `bun typecheck` passed.

## Focused

- `bun run test -- ../scripts/build-desktop-artifact.test.ts` from `scripts` passed: 1 file, 10 tests.
- `bun run test -- src/app/DesktopEnvironment.test.ts src/settings/DesktopAppSettings.test.ts` from `apps/desktop` passed: 2 files, 15 tests.

## Evidence

- Initial root-level `bun run test -- scripts/build-desktop-artifact.test.ts` failed because Turbo treated the file path as a task name; reran from the `scripts` package so Vitest received the test file.
