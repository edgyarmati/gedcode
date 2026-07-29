# Tasks

## S1 — Move admission to stage startup

- Replace active-worktree counting with active-stage counting.
- Remove `maxParallelTasks` admission from `task.create` and `task.split`.
- Enforce the resolved project limit in `task.stage.start`.
- Verification: focused decider tests cover create, split, below-limit start, and at-limit rejection.

## S2 — Align public descriptions and release notes

- Update contract comments and user-facing labels to say "concurrent tasks".
- Add an Unreleased changelog entry.
- Verification: focused contract and web logic tests, formatting, lint, and relevant typechecks.

## S3 — Final verification

- Run the focused test set.
- Run `bun fmt`, `bun lint`, and the narrowest relevant package typechecks.
- Record results in `TESTS.md` and transition `STATE.md` to complete.
