# Tests

Planned verification:

- `bun run test packages/ged-workflow/src/WorkflowPrompt.test.ts`
- `bun run test apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts`
- `bun run test apps/web/src/components/settings/ProviderSettingsForm.test.ts`
- `bun fmt`
- `bun lint`
- `bun typecheck`

Evidence:

- NOTE: Root path form failed before Vitest because Turbo parsed the file path as a missing task:
  - `bun run test packages/ged-workflow/src/WorkflowPrompt.test.ts`
  - `bun run test apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts`
  - `bun run test apps/web/src/components/settings/ProviderSettingsForm.test.ts`
- PASS: `bun run test -- src/WorkflowPrompt.test.ts` from `packages/ged-workflow` (11 tests).
- PASS: `bun run test -- src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts` from `apps/server` (15 tests).
- PASS: `bun run test -- src/components/settings/ProviderSettingsForm.test.ts` from `apps/web` (11 tests; existing Node/localStorage warnings only).
- PASS: `bun fmt`.
- PASS: `bun lint` (existing warnings only; exit code 0).
- PASS: `bun typecheck`.
