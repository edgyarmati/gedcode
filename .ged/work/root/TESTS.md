# Tests

Planned verification:

- `bun run test -- src/CheckpointValidation.test.ts src/WorkflowPrompt.test.ts` from `packages/ged-workflow`
- `bun run test -- src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` from `apps/server`
- Focused settings UI tests from `apps/web`
- `bun fmt`
- `bun lint`
- `bun typecheck`

Evidence:

- PASS: `bun run test -- src/CheckpointValidation.test.ts src/WorkflowPrompt.test.ts` from `packages/ged-workflow` (39 tests).
- PASS: `bun run test -- src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` from `apps/server` (16 tests).
- PASS: `bun run test -- src/components/settings/SettingsPanels.logic.test.ts` from `apps/web` (6 tests; existing Node warning only).
- PASS: `bun fmt`.
- PASS: `bun lint` (existing warnings only; exit code 0).
- PASS: `bun typecheck`.
- PASS: Ged verifier review reported no blocking findings.
