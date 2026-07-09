# Spec: App data directory and orchestrator config cleanup

## Goal

GedCode should use `~/.gedcode` as its default app data base directory, migrate existing default `~/.t3` data once for users upgrading from older releases, and simplify Orchestrator configuration by making orchestration always enabled and removing the max-stage-handoffs limit entirely.

## Scope

- Default app data base path for fresh installs.
- One-time startup migration from default `~/.t3` to default `~/.gedcode` when the new location does not already exist.
- Server/desktop path tests and user-facing notes.
- Orchestrator project/global config schemas, runtime guards, resolver helpers, settings/project-settings UI logic, and tests.

## Decisions

- Explicit `T3CODE_HOME` / `--base-dir` values remain respected and are not migrated automatically.
- Migration copies old default data into the new default path when `~/.gedcode` is absent and `~/.t3` exists; it does not delete `~/.t3`.
- Existing persisted `enabled` and `maxStageHandoffs` JSON fields become ignored legacy data.
- PM runtime and decider should treat every project as orchestrator-enabled.
