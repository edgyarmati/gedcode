# Tasks: App data directory and orchestrator config cleanup

1. Add default app-data migration support from `~/.t3` to `~/.gedcode` for desktop startup and ensure fresh default paths use `~/.gedcode`.
2. Remove Orchestrator `enabled` from contracts, UI draft/build logic, runtime guards, and tests so all projects are enabled.
3. Remove `maxStageHandoffs` from contracts/shared resolution/server enforcement/UI logic/tests.
4. Update changelog and Ged durable notes.
5. Run focused tests plus `bun fmt`, `bun lint`, `bun typecheck`, and `git diff --check`.
6. Tighten desktop data migration so an existing `~/.gedcode` base directory does not prevent migrating the active legacy state directory from `~/.t3/userdata` or `~/.t3/dev` when the corresponding target state directory is absent.
