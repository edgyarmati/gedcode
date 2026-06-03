# Tests

## Verification Plan

Focused tests:

```sh
cd packages/contracts && bun run test src/settings.test.ts
cd packages/ged-workflow && bun run test src/WorkflowPrompt.test.ts
cd apps/server && bun run test src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts src/serverSettings.test.ts src/provider/Layers/ProviderInstanceRegistryLive.test.ts
```

Targeted checks:

```sh
rg -n "gedSubagentPreset|Codex Ged Subagent Preset|reasoning" packages/contracts/src/settings.ts packages/ged-workflow/src/WorkflowPrompt.ts apps/server/src/gedWorkflow docs/ged-workflow.md
```

Required repo gates:

```sh
bun fmt
bun lint
bun typecheck
```

Do not run `bun test`; use `bun run test` for Vitest.

## Evidence

- `cd packages/contracts && bun run test src/settings.test.ts`: passed; 1 file, 12 tests.
- `cd packages/ged-workflow && bun run test src/WorkflowPrompt.test.ts`: passed; 1 file, 8 tests.
- `cd apps/server && bun run test src/gedWorkflow/Layers/GedWorkflowServiceLive.test.ts src/serverSettings.test.ts src/provider/Layers/ProviderInstanceRegistryLive.test.ts`: passed; 3 files, 23 tests.
- `rg -n "gedSubagentPreset|Codex Ged Subagent Preset|reasoning" ...`: passed; setting, prompt, service tests, fixture defaults, and docs references present.
- `bun fmt`: passed.
- `bun lint`: passed with existing warnings only.
- `bun typecheck`: passed.
- Ged verifier review: passed in main thread. Native subagent tools were present, but their tool contract only allows spawning when the user explicitly asks for delegation; review confirmed Codex-only gating, provider-instance override precedence, subagents-disabled omission, and non-Codex omission.
