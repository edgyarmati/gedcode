# Tasks

1. [x] Update `packages/ged-workflow/src/WorkflowPrompt.ts` harness-native section to list `ged-explorer`, `ged-planner`, and `ged-verifier` roles.
2. [x] Add explicit fallback instructions for providers without native subagent tools.
3. [x] Update `packages/ged-workflow/src/WorkflowPrompt.test.ts` for role/fallback assertions.
4. [x] Update `apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` for injected prompt assertions.
5. [x] Run focused tests and required checks.

## Plan-review required change

6. [x] Remove user-facing Gedcode-managed subagent runtime selection; Ged subagents are always harness-native.
7. [x] Make prompt generation ignore deprecated managed mode and always emit harness-native role/fallback instructions when Ged subagents are enabled.
8. [x] Keep/strengthen server managed role invocation refusal so Gedcode does not create role child threads.
9. [x] Remove non-sensical Ged orchestration settings rows: Intercom bridge, Ged main thread model, and Ged role models; keep Critique mode.
