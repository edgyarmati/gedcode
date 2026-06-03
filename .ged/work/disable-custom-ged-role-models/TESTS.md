# Tests

## Targeted automated tests

- `bun run test --filter @t3tools/contracts -- src/settings.test.ts`
  - Legacy settings decode to `gedSubagentRuntimeMode: "gedcode-managed"`.
  - Patch accepts `"harness-native"`.
  - Invalid mode is rejected.

- `bun run test --filter @t3tools/shared -- src/serverSettings.test.ts`
  - Applying runtime mode patch preserves existing Ged model selections.

- `bun run test --filter @t3tools/ged-workflow -- src/WorkflowPrompt.test.ts`
  - Disabled subagents omit subagent instructions.
  - Managed mode keeps Ged-managed guidance.
  - Harness-native mode contains native subagent instructions and does not imply Gedcode per-role model routing.

- `cd apps/server && bun run test src/gedWorkflow/Layers/GedRoleInvocationService.test.ts`
  - Default managed mode still dispatches child thread/turn.
  - Harness-native mode refuses before dispatch and creates no commands.
  - Existing disabled-subagents and disabled-role tests still pass.

- UI-focused tests where practical:
  - Settings logic/helper test: per-role model controls enabled in managed mode, disabled/hidden in harness-native mode.
  - If project dialog is included, add/update `ChatHeader` logic test for project per-role controls.

## Full required checks

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

## Manual checks

- Fresh/legacy settings show Gedcode-managed mode by default.
- Enabling **Use harness-native subagents** disables or hides per-role model controls.
- Main Ged thread model remains configurable.
- Switching back to managed mode restores prior per-role selections.
- Starting a Ged-managed role invocation in harness-native mode creates no child thread.
- New Ged workflow prompt in harness-native mode tells the provider/harness to use native subagents.

## Additional plan-review tests

- Server workflow service test: `getWorkflowPromptSuffix` reflects `gedSubagentsEnabled=false`, managed mode, harness-native mode, and settings-read failure fallback.
- Project Ged model dialog test: project per-role controls are disabled/hidden in harness-native mode; project main Ged model remains configurable.
- Composer/settings copy test or focused UI assertion: no harness-native view claims “Subagent role models come from Ged settings.”
- Invocation service test: harness-native mode refuses before dispatch and before role model resolution-dependent behavior can occur.
