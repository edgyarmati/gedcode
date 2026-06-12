# TESTS

## Planned

- `bun run test:browser -- src/components/chat/ProviderModelPicker.browser.tsx` from `apps/web`
- Browser/manual verification for model picker rendering if a local dev server is needed and practical.
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false bunx turbo run typecheck --concurrency=1`

## Evidence

- PASS: `bun run test:browser -- src/components/chat/ProviderModelPicker.browser.tsx` from `apps/web` (1 file, 25 tests; Vite/browser emitted a non-fatal Legend List zero-height warning in test DOM)
- PASS: `git diff --check`
- PASS: `bun fmt`
- PASS: `bun lint` (existing warnings only)
- PASS: `TURBO_DAEMON=false bunx turbo run typecheck --concurrency=1`
- PASS: `curl -I http://127.0.0.1:5733/` against `apps/web` Vite dev server returned HTTP 200.
- LIMITED: In-app Browser smoke could not run because Chrome DevTools connection failed at `http://127.0.0.1:9222/json/version`; targeted browser component coverage passed instead.
- PASS: Main-thread verifier fallback reviewed the staged/unstaged diff and found no blocking issues for this slice.
