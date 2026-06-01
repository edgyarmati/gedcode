# Tests

## Contracts

- `ServerSettings` decodes legacy payloads with `gedModelSelections: { mainThread: null, roles: {} }`.
- Settings patch accepts global main selection, `mainThread: null`, role map with `ged-explorer`, and empty role map for clearing without stale keys after persistence round-trip.
- Project/detail/shell/event payloads decode legacy project data without `roleModelSelections`.
- Project meta update accepts and projects whole role map replacements, including override then clear.

## Shared Resolver

- Main resolver order: existing thread > project main > global main > fallback.
- Role resolver order: project role > global role > parent thread > project main > global main > fallback.
- No role overrides returns parent model, preserving current behavior.
- Clear/update helpers do not mutate input maps.

## Server

- `GedRoleInvocationServiceLive` with no overrides creates child thread/turn using parent model.
- Global role override makes child thread/turn use global role model.
- Project role override beats global role model.
- Prompt includes resolved model instance/model.
- Invocation still dispatches exactly one child thread and one child turn.
- Partial-failure behavior is covered at least for child turn start failure.

## Persistence/Projection

- Migration adds project role model selections with `{}` default.
- `project.created` persists/projects role map.
- `project.meta-updated` replaces role map and clear behavior removes stale role entries.
- Snapshot query returns role map in project shell/detail.

## Web

- Global settings UI writes and clears main/role Ged model defaults.
- Project override UI dispatches `defaultModelSelection` for main override.
- Project override UI dispatches whole `roleModelSelections` map for role override/clear.
- New/draft thread selection and dispatched thread-create/bootstrap payloads use project main over global main and global main over fallback.
- Existing thread model remains authoritative.

## Required Commands

```sh
bun fmt
bun lint
bun typecheck
bun run test
```

Use `bun run test`, never `bun test`.
