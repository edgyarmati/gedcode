# TASKS

1. Workflow update
   - Edit `.github/workflows/release.yml`.
   - In `publish_cli`, add `--provenance` to the CLI publish command.
   - Remove the `env: NODE_AUTH_TOKEN: $${{ secrets.NPM_TOKEN }}` block.
   - Preserve `id-token: write`.

2. Release docs update
   - Edit `docs/release.md`.
   - Move npm OIDC trusted publishing out of “not automated”.
   - Replace `NPM_TOKEN` required-secret guidance with npm Trusted Publisher prerequisites.
   - Update the example publish command to include `--provenance`.
   - Update rehearsal/troubleshooting guidance for OIDC/trusted publisher failures.

3. Scope guard
   - Do not modify desktop signing/notarization workflow or secrets.
   - Do not run or dispatch the release workflow.
   - Do not publish to npm, push tags, or create releases.
