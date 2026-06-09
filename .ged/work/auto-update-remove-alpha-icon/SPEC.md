# SPEC: Updates, stable branding, and icon refresh

## Goal

Restore/expose in-app desktop auto-update controls, remove stable “Alpha” labeling, align stale package versions to `0.1.0`, and replace oversized icon assets with cleaner Apple-compliant assets that include safe-zone padding.

## Approach

- Reuse existing desktop updater backend/IPC/state; avoid backend rewrites unless required.
- Make update controls discoverable in-app for desktop users while hiding them for hosted/non-desktop web.
- Stable branding should display as bare `GedCode`; dev/nightly may remain labeled.
- Bump stale `apps/web` and `packages/contracts` versions to `0.1.0`.
- Generate a cleaner icon set with Apple-safe padding and commit required desktop/web assets.

## Acceptance Criteria

- Stable app surfaces show `GedCode`, not `GedCode (Alpha)`.
- Version shown in app is `0.1.0` after the branch build.
- In-app desktop update UI exposes status, check/download/install, and track where applicable.
- New icon assets are correctly sized and padded so macOS dock/app switcher rendering is not oversized.
- Legacy Alpha names remain only where explicitly needed for migration/backward compatibility.
