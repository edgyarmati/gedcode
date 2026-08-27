# Tasks

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| RG-01 | DONE | Remove active release-task registration, PM instructions, MCP/tool entrypoints, provenance parameters, and the release-dispatch actuator. Add the direct human-request `gh` workflow guidance. | Registry, PM prompt, MCP schema, PM tool, and decider tests prove only feature tasks and plan/land gates remain active. |
| RG-02 | DONE | Preserve and test the legacy compatibility boundary for old release configuration, events, projections, persisted dispatch state, and task retention operations. | Focused compatibility/migration/projector tests prove old snapshots decode while new release operations are rejected. |
| RG-03 | DONE | Document the change and run required focused and repository checks. | `CHANGELOG.md` updated; focused tests, `bun fmt`, `bun lint`, server/web typechecks, and `git diff --check` pass. |
