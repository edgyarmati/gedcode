# Tests

Planned verification:

- `bun fmt`
- `bun lint`
- `bun typecheck`

Evidence:

- PASS: `bun fmt`.
- PASS: `bun lint` with existing warnings only.
- PASS: `bun typecheck`.
- PASS: `bun run test -- WorkflowPrompt.test.ts` from `packages/ged-workflow`.
- NOTE: `bun run test packages/ged-workflow/src/WorkflowPrompt.test.ts` failed before running Vitest because the root Turbo script parsed the file path as a missing task.
- NOTE: `bun --filter @t3tools/ged-workflow run test -- WorkflowPrompt.test.ts` failed because this Bun setup did not match the workspace filter.
