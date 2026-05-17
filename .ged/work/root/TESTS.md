# Tests

## Plan

- `file`/`identify` or `sips` on generated assets to confirm expected dimensions and formats.
- Inspect ICO/ICNS embedded sizes.
- `bun run test lib/brand-assets.test.ts` from `scripts/`
- `bun run build:marketing`
- `bun fmt`
- `bun lint`
- `bun typecheck`

## Evidence

- `file`/`identify` confirmed PNG dimensions for 16, 32, 180, and 1024px generated assets, plus WebP output.
- `identify` confirmed web ICO containers contain 32px and 16px entries; desktop Windows ICO containers contain 256, 128, 64, 48, 32, and 16px entries.
- `iconutil -c iconset` confirmed desktop ICNS contains 16, 32, 64, 128, 256, 512, and 1024px iconset outputs.
- 16px favicon was enlarged for visual legibility check.
- `bun fmt` passed.
- Root `bun run test scripts/lib/brand-assets.test.ts` was not a valid Turbo task invocation.
- `bun run test lib/brand-assets.test.ts` from `scripts/` passed: 1 file, 5 tests.
- `bun lint` passed with pre-existing warnings outside the branding change.
- `bun run build:marketing` passed.
- `bun typecheck` passed: 14 packages.
- Browser smoke against `apps/marketing` preview passed for desktop 1280x900 and mobile 390x844; nav mark measured 26x26 and footer mark measured 20x20.
