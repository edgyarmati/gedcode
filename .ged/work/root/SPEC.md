# Spec

## Goal

Add a standing repository instruction in `AGENTS.md` requiring user-visible changes to be documented in `CHANGELOG.md` so future work includes changelog maintenance by default.

## User-visible behavior

- Future agents working in this repo are explicitly told to update `CHANGELOG.md` when they make changes that should be documented for the next release.
- The requirement is stated in the main repo instructions, not left to per-task reminders.

## Non-goals

- Expanding the changelog itself beyond the prior update.
- Changing runtime behavior or source code outside repo instructions and workflow metadata.
- Defining a full release process beyond the documentation requirement.

## Acceptance criteria

- `AGENTS.md` explicitly requires documenting relevant changes in `CHANGELOG.md`.
- The requirement makes clear this should happen before task completion, without needing a separate user reminder.
- Required checks pass.
