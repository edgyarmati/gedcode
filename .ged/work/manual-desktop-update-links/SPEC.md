# Manual Desktop Update Links

## Goal

Desktop update notifications should remain channel-aware, but clicking the update action should open the browser to the appropriate GitHub release/download page instead of downloading or installing inside the app.

## Scope

- Preserve selected update channel (`latest` or `nightly`) and existing check/poll behavior.
- For an available update, the primary UI action opens an external release page.
- Do not use in-app `downloadUpdate`, staged install, or restart-to-install UI for normal manual update action.
- Keep updater state predictable and avoid claiming an update was downloaded.

## Non-goals

- Resolve exact platform asset URLs in-app.
- Change channel picker semantics.
- Remove all existing installer code paths unless unnecessary for the manual action.
