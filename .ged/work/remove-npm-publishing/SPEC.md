# SPEC: Release via GitHub Releases only

## Goal

Remove npm publishing from release automation and docs. Release GedCode through GitHub Releases desktop artifacts, with existing desktop auto-update assets preserved.

## Scope

- Release workflow: remove npm publish job/dependencies, keep desktop artifact builds, update manifests, GitHub Release, finalize job.
- Docs: remove npm/npx install guidance and point users to GitHub Releases.
- Verify updater configuration remains present.

## Non-goals

- Do not publish npm packages.
- Do not add signing/notarization.
- Do not remove internal build/publish helper code unless required.
