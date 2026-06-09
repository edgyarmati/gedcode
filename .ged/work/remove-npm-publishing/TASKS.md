# TASKS

1. Remove npm release job
   - Remove `publish_cli` from `.github/workflows/release.yml`.
   - Update release job needs to `[preflight, build]`.
   - Remove OIDC permission if no longer needed.

2. Update public docs
   - Remove `npx gedcode` / `npx t3` install guidance.
   - Remove npm Trusted Publishing / npm publish release docs.
   - Document GitHub Releases as the install/update path.

3. Verify auto-update release path
   - Confirm workflow still uploads desktop artifacts, update manifests, blockmaps, and macOS zip payloads.
   - Confirm docs mention users can update through the desktop update UI after installing a release build.

4. Verify and commit
   - Run `bun fmt`, `bun lint`, `bun typecheck`.
   - Run focused greps for removed npm publishing references.
   - Commit changes.

## Exact doc scope

User-facing docs in scope: `README.md`, `REMOTE.md`, `docs/release.md`, `docs/observability.md`, `.docs/quick-start.md`.
Archived/history/planning docs out of scope: `.ged/**`, `docs/superpowers/**` unless directly linked as current install guidance.
