# SPEC: npm trusted publishing

## Goal

Update GedCode's release workflow and release docs so the CLI npm publish uses npm trusted publishing/OIDC with provenance instead of `NPM_TOKEN`. Do not change desktop signing/notarization behavior.

## Approach

- Keep the existing `publish_cli` job and CLI publish script.
- Rely on existing workflow `permissions: id-token: write`.
- Remove `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` from the npm publish step.
- Add `--provenance` to `node apps/server/scripts/cli.ts publish ...`.
- Update `docs/release.md` to describe npm Trusted Publisher/OIDC setup, not token auth.

## Acceptance Criteria

- Release workflow publish command includes `--provenance`.
- Release workflow no longer references `NODE_AUTH_TOKEN` or `NPM_TOKEN`.
- Release docs no longer state npm OIDC is not automated or that `NPM_TOKEN` is required.
- Desktop signing docs/workflow remain unchanged.
