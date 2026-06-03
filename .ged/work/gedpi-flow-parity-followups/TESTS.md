# Tests

## Targeted tests

- `bun run test --filter @t3tools/contracts -- src/settings.test.ts`
- `bun run test --filter @t3tools/shared -- src/gedModelSelection.test.ts src/serverSettings.test.ts`
- `cd apps/server && bun run test src/gedWorkflow/Layers/GedRoleInvocationService.test.ts`
- `cd apps/web && bun run test src/store.test.ts src/components/chat/ChatHeader.test.ts src/components/settings/SettingsPanels.logic.test.ts`

## Full checks before completion

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

## Manual testing notes

- Open global settings and verify the Ged orchestration section shows subagents, intercom, critique mode, main model, and all role rows.
- Change a role model and verify only that role is updated.
- Clear a role and verify it returns to inherited state.
- Open a project thread header's Ged models dialog and verify all roles can be overridden/reset per project.
- Start a Ged explorer invocation and verify it uses the configured explorer model.
