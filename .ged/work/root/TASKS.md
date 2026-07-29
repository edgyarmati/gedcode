# Tasks

## S1 — Guard stage steering

- Require the selected thread to equal the task's active stage thread.
- Update tool guidance to explain the tracked-attempt requirement.
- Add focused active, completed, and superseded-stage tests.
- Verification: focused `pmTools` tests pass.

## S2 — Release notes and verification

- Add an Unreleased changelog entry.
- Run focused tests, `bun fmt`, `bun lint`, and the server typecheck.
- Record results and complete the checkpoint.
