# SPEC

## Goal

Backport the accepted SSH HTTP status preservation behavior from upstream commit `4956415f`.

## Scope

- Preserve forwarded SSH HTTP status markers in desktop SSH remote API errors.
- Adapt the upstream behavior to this fork's `DesktopSshRemoteApi` layer, which wraps SSH HTTP calls before IPC methods return errors.
- Add a focused desktop SSH remote API test for an HTTP auth failure.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not rewrite desktop IPC method signatures.
- Do not change SSH tunnel request behavior or authentication flows.
- Do not address other desktop/source-control backlog items in this slice.

## Acceptance Criteria

- A failed forwarded SSH HTTP request keeps `[ssh_http:<status>]` at the desktop API error message boundary.
- Existing schema decode error wrapping remains unchanged.
- Focused desktop SSH remote API tests pass.
- Required repository checks pass.
- Completed upstream item is removed from the desktop/SSH/source-control backlog entry.
