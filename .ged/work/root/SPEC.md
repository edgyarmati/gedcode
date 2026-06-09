# Packaged Dev Startup Fix

## Goal

Packaged `GedCode (Dev)` builds must start like packaged apps while keeping separate dev identity and state.

## Problem

The previous packaged dev identity change made `environment.isDevelopment` true for `-dev` versions. Startup code uses that flag for live dev server behavior, including requiring `T3CODE_PORT`, loading the Vite dev server, disabling packaged update behavior, and relaunching through the dev launcher path.

## Scope

- Keep `isDevelopment` scoped to live dev server mode.
- Add a separate dev identity flag for `-dev` packaged versions.
- Use the identity flag for display name, state paths, user data name, app user model id, Linux desktop identity, and dev icon selection.
- Keep packaged dev backend/window/update behavior packaged.

## Acceptance Criteria

- Packaged `0.1.1-dev.1` does not require `T3CODE_PORT`.
- Packaged `0.1.1-dev.1` still uses `GedCode (Dev)`, `com.t3tools.gedcode.dev`, and dev user-data/state paths.
- Live `bun dev:desktop` behavior remains unchanged.
- Required checks pass.
