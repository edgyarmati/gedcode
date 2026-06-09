# Packaged Dev Desktop Identity

## Goal

Packaged desktop builds with a dev version suffix must install and run side by side with the stable GedCode app.

## Scope

- Detect dev desktop versions such as `0.1.1-dev.1`.
- Package dev builds as `GedCode (Dev)` with a dev app id.
- Keep dev packaged runtime state separate from stable state.
- Prevent dev packaged builds from accidentally using the stable GitHub update feed.
- Leave nightly behavior unchanged except where shared helpers need to distinguish stable/nightly/dev.

## Non-Goals

- Do not redesign nightly update subscription semantics.
- Do not remove or change `bun dev:desktop`.
- Do not add a new GitHub Actions dev release workflow.

## Acceptance Criteria

- `bun run dist:desktop:artifact -- --build-version 0.1.1-dev.1` produces a dev-named app artifact.
- Dev packaged builds use `com.t3tools.gedcode.dev` and `GedCode (Dev)`.
- Stable packaged builds still use `com.t3tools.gedcode` and `GedCode`.
- Nightly packaged builds still use `GedCode (Nightly)` and the nightly updater channel.
- Dev runtime uses dev user-data/state identifiers so it does not share stable local app state.
