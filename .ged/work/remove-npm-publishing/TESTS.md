# TESTS

- `bun fmt`
- `bun lint`
- `bun typecheck`
- Focused checks:
  - no npm publish job in `.github/workflows/release.yml`
  - no `npx gedcode`/`npx t3` in public docs
  - release docs still mention updater manifests and desktop update button
