# Tasks

## Slice 1: Contracts and settings defaults

1. [x] Add `GedSubagentRuntimeMode` schema/union in `packages/contracts/src/settings.ts`.
2. [x] Add `ServerSettings.gedSubagentRuntimeMode` defaulting to `"gedcode-managed"`.
3. [x] Add `ServerSettingsPatch.gedSubagentRuntimeMode`.
4. [x] Add/adjust settings tests for legacy decode default, valid patch, and invalid value rejection.
5. [x] Add shared settings patch test proving mode patches do not clear existing `gedModelSelections.roles`.

## Slice 2: Workflow prompt mode support

1. [x] Extend `WorkflowPromptOptions` with subagent runtime mode.
2. [x] Keep subagent section omitted when `subagentsEnabled` is false.
3. [x] Keep managed-mode prompt behavior compatible with current Gedcode-managed defaults.
4. [x] Add harness-native prompt copy instructing the selected harness/provider to create/use native subagents.
5. [x] Update `GedWorkflowServiceLive.getWorkflowPromptSuffix` to read settings instead of hardcoding `subagentsEnabled: true`.
6. [x] Add prompt tests for disabled, managed, and harness-native modes.

## Slice 3: Server invocation gate

1. [x] Update `GedRoleInvocationServiceLive` to refuse before dispatch when harness-native mode is enabled.
2. [x] Ensure refusal happens before role model resolution/child thread creation.
3. [x] Preserve existing behavior for managed mode, disabled global subagents, and disabled role settings.
4. [x] Add service test asserting harness-native mode produces no orchestration commands.

## Slice 4: Settings UI

1. [x] Add user-facing setting row near Ged subagent settings.
2. [x] Persist row changes through `updateSettings({ gedSubagentRuntimeMode })`.
3. [x] Disable or hide global per-role model pickers/reset controls when harness-native is enabled.
4. [x] Show explanatory copy that per-role custom models are ignored in harness-native mode.
5. [x] Preserve Ged main thread model controls.
6. [x] Apply same disabled/hidden state to project-level per-role Ged model overrides if present.

## Slice 5: Verification and cleanup

1. [x] Run targeted contract/shared/prompt/server/UI tests.
2. [x] Run `bun fmt`.
3. [x] Run `bun lint`.
4. [x] Run `bun typecheck`.
5. [x] Run `bun run test`.

## Plan-review required follow-ups

1. [x] Treat `ProjectGedModelsDialog` in `apps/web/src/components/chat/ChatHeader.tsx` as in-scope: disable/hide project per-role controls in harness-native mode while leaving the project main Ged model control usable.
2. [x] Add/update server tests for `GedWorkflowServiceLive.getWorkflowPromptSuffix` covering disabled, managed, harness-native, and settings-read fallback behavior.
3. [x] Keep prompt package runtime-mode typing dependency-safe: either avoid a new contracts dependency or update package metadata deliberately.
4. [x] Make composer/settings helper copy mode-aware so it does not claim role models come from Ged settings in harness-native mode.
5. [x] Strengthen invocation-gate tests so harness-native mode refusal is verified before role model resolution and before dispatch.
