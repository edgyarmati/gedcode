# Tests

## Planned

- Browser/component regression around `ConnectionsSettings` ensuring the Revoke button is rendered with a light-mode-safe destructive text color.
- Required repository checks:
  - `bun fmt`
  - `bun lint`
  - `bun typecheck`
- Focused test command using `bun run test` for the settings browser coverage.

## Evidence

- PASS: `bun fmt`.
- Initial focused browser run failed because Playwright Chromium was missing from `/Users/edgy/Library/Caches/ms-playwright`.
- PASS: `bun run test:browser:install` from `apps/web` installed Chromium.
- PASS: `bun run test:browser -- src/components/settings/SettingsPanels.browser.tsx` from `apps/web` (17 tests; existing client settings hydrate console error did not fail the suite).
- PASS: `bun lint` (existing warnings only; exit code 0).
- PASS: `bun typecheck`.
- Ged verifier reported no blocking findings, with residual risk that the first assertion used the exact default RGB token.
- Updated the browser assertion to compare against the active `--destructive` CSS variable; prior verification is invalidated pending rerun.
- PASS after assertion update: `bun fmt`.
- PASS after assertion update: `bun run test:browser -- src/components/settings/SettingsPanels.browser.tsx` from `apps/web` (17 tests; existing client settings hydrate console error did not fail the suite).
- PASS after assertion update: `bun lint` (existing warnings only; exit code 0).
- PASS after assertion update: `bun typecheck`.
- PASS: Ged verifier rerun reported no blocking findings.
