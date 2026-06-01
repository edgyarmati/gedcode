# Spec: Harness-native Ged subagent mode

## Goal

Add a Ged workflow setting, user-facing as **Use harness-native subagents**, that switches subagent ownership from Gedcode-managed child threads to the selected harness/provider’s native subagent mechanism.

Default/backcompat remains **Gedcode-managed**:

- Gedcode may create role child threads.
- Per-role Ged provider/model controls are visible/enabled.
- Existing role model resolution and defaults continue to work.

When harness-native mode is enabled:

- Gedcode-managed role child-thread invocation is refused before dispatch.
- Per-role custom model controls are disabled or hidden in settings UI.
- Workflow prompt instructs the selected harness/provider to create/use native subagents.
- Existing stored per-role model settings are preserved but ignored until managed mode is re-enabled.

## Contract

Add a server setting enum such as:

```ts
gedSubagentRuntimeMode: "gedcode-managed" | "harness-native";
```

Default: `"gedcode-managed"`.

`gedSubagentsEnabled` remains the global on/off switch:

- `gedSubagentsEnabled === false`: no subagent prompt section and no Gedcode role invocation.
- `gedSubagentsEnabled === true && gedSubagentRuntimeMode === "gedcode-managed"`: current Gedcode-managed behavior.
- `gedSubagentsEnabled === true && gedSubagentRuntimeMode === "harness-native"`: prompt asks provider/harness to use native subagents; Gedcode role invocation refuses before dispatch.

## Design

### Settings/contracts

Update `packages/contracts/src/settings.ts`:

- Add `GedSubagentRuntimeMode` schema.
- Add `ServerSettings.gedSubagentRuntimeMode` with legacy-safe default `"gedcode-managed"`.
- Add optional patch field.

Update shared settings patch tests to ensure mode changes do not clear role model selections.

### Prompt behavior

Update `packages/ged-workflow/src/WorkflowPrompt.ts`:

- Extend `WorkflowPromptOptions` with runtime mode.
- Keep no subagent section when subagents are disabled.
- In managed mode, keep Gedcode-managed guidance.
- In harness-native mode, explicitly instruct the selected provider/harness to create/use native subagents and state that Gedcode per-role custom models are not used in this mode.

Update `apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.ts`:

- Stop hardcoding `subagentsEnabled: true`.
- Read server settings and pass both `gedSubagentsEnabled` and `gedSubagentRuntimeMode`.

### Server role invocation gate

Update `apps/server/src/gedWorkflow/Layers/GedRoleInvocationServiceLive.ts`:

- After loading settings and checking `gedSubagentsEnabled`, refuse invocation when `gedSubagentRuntimeMode === "harness-native"`.
- Fail before model resolution and before any dispatch.
- Preserve existing input-error style.
- Existing managed-mode dispatch and role model resolution must remain unchanged.

### UI

Update `apps/web/src/components/settings/SettingsPanels.tsx`:

- Add a Ged orchestration row for **Use harness-native subagents** / subagent runtime mode.
- Explain the tradeoff:
  - Gedcode-managed: child threads, per-role provider/model routing.
  - Harness-native: provider/harness-native subagents, no Gedcode per-role model routing.
- When harness-native is enabled:
  - Disable or hide per-role model pickers and reset controls.
  - Show explanatory copy that stored per-role models are ignored in this mode.
- Ged main thread model remains configurable.

If project-level Ged model override UI exposes per-role model controls, apply the same disabled/hidden treatment there too.

## Non-goals

- Do not delete or migrate existing per-role model selections.
- Do not implement provider-native subagent APIs server-side.
- Do not change main Ged thread model selection semantics.
- Do not remove Gedcode-managed mode.

## Risks

- Confusion between `gedSubagentsEnabled` and runtime mode; UI copy must make precedence clear.
- Provider-native subagents are prompt-directed/best-effort and vary by harness.
- Stored per-role models may feel stale when switching back; preserve them intentionally for reversibility.

## Plan-review refinements

- Project-level per-role overrides in `apps/web/src/components/chat/ChatHeader.tsx` are in scope and must be hidden/disabled in harness-native mode while preserving the project main Ged model override.
- `GedWorkflowServiceLive.getWorkflowPromptSuffix` must catch settings-read failures and fall back to legacy-safe managed defaults so workflow prompt injection remains non-failing.
- Runtime mode type ownership should avoid introducing a new dependency from `packages/ged-workflow` to contracts unless already present; prefer a local string union in the prompt package and contract-backed values at server call sites, with tests covering accepted values.
- User-facing composer/settings copy such as “Subagent role models come from Ged settings” must become mode-aware or neutral in harness-native mode.
- Invocation-gate tests must prove harness-native refusal happens before model resolution/dispatch, not just that no commands are dispatched.
