# SPEC

## Goal

Backport the projection correctness behavior from upstream commit `57f6bf7e` without pulling unrelated upstream refactors.

## Requirements

- Keep a turn `running` while the provider session remains `running` with the same `activeTurnId`; assistant messages and diff-completed events must not settle that turn early.
- Settle a still-running turn when the session leaves `running`, using the session timestamp and mapping ready/idle to `completed`, error to `error`, and stopped/interrupted to `interrupted`.
- When a different active turn starts running on the same thread, settle the superseded running turn as `completed` at the new session timestamp.
- Keep server replay projection, persisted SQL projection, and web client store semantics aligned.
- Reuse active turn ids for mid-turn steers in the local Claude, Cursor, and OpenCode adapters.
- Accept conflicting provider `turn.started` events only when they correspond to a pending server turn start and the provider already expects that turn.
- Port applicable web duration formatting from the upstream fold fix so visible completion durations do not render a rounded `10.0s` label.
- Add focused tests for replay projection, persisted projection, web store behavior, ingestion, provider steer behavior, and duration formatting.
- Add a `CHANGELOG.md` unreleased note.
- Remove or narrow `57f6bf7e` from `docs/upstream-decisions.md` after the backport lands.

## Non-Goals

- Do not backport the upstream client-runtime reducer extraction.
- Do not add the upstream Grok provider path; it does not exist locally.
- Do not backport upstream turn-fold row extraction or visual-only timeline changes when the equivalent row type does not exist locally.
