# TESTS

Required:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Focused checks:

- `grep -n "id-token: write" .github/workflows/release.yml`
- `grep -n -- "--provenance" .github/workflows/release.yml docs/release.md`
- `! grep -nE "NODE_AUTH_TOKEN|NPM_TOKEN" .github/workflows/release.yml docs/release.md`

Do not run:

- full release workflow
- tag push / GitHub Release creation
- `npm publish`
- desktop signing/notarization checks
