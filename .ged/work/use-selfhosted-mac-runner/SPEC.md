# SPEC: Route macOS x64 release build to self-hosted runner

## Goal

Use the connected local macOS self-hosted runner for the stuck `macOS x64` release build while leaving other release targets unchanged.

## Approach

- Change only the `macOS x64` matrix entry in `.github/workflows/release.yml` from GitHub-hosted `macos-13` to `[self-hosted, macOS, X64]`.
- Commit and push the workflow change.
- Cancel the stale queued `v0.1.0` run.
- Because no GitHub Release was created yet, move `v0.1.0` to the workflow-fix commit and push the tag again.

## Risks

- Label mismatch could keep the job queued.
- Tag delete/recreate could be blocked, but acceptable here because the release did not complete.
