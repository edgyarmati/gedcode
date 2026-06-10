# SPEC

## Goal

After the updater-fix CI is green, publish a stable release with GitHub-style release notes comparable to `v0.1.0`, then disable/supersede previous releases so users install the fixed stable build.

## Scope

- Confirm CI for the updater fix commit succeeds.
- Determine the next stable version and release command from repository scripts.
- Prepare release notes with a clear `What's Changed` section, contributors, and full changelog link.
- Dispatch and monitor the stable release workflow.
- Mark previous releases as non-current after the stable release is available.

## Non-Goals

- Change release automation unless required to complete the release safely.
- Rewrite historical release notes beyond disabling/superseding old releases.
