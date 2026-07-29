# TESTS — Codex PM Lifecycle Accountability

## Planned

- `apps/server/src/orchestration/pm/PmReEntryQueue.test.ts`
  - appends the lifecycle action contract;
  - accepts orchestration-tool evidence;
  - accepts a non-empty `[PM_WAITING: ...]` marker;
  - sends exactly one corrective turn after a passive acknowledgement;
  - never applies accountability to a user-message batch or when policy is disabled.
- `apps/server/src/orchestration/claude/DriverPmAdapter.test.ts`
  - resets action evidence at turn start;
  - records trusted orchestration MCP tool calls;
  - ignores unrelated MCP/provider tools.
- `apps/server/src/orchestration/Layers/PmRuntime.test.ts`
  - enables lifecycle accountability only for Codex PM runtimes.

## Required Checks

- Focused Vitest files via `bun run test`.
- `bun fmt`
- `bun lint`
- Narrowest relevant server typecheck.
- `git diff --check`

## Evidence

- `bun run test src/orchestration/pm/PmReEntryQueue.test.ts
  src/orchestration/claude/DriverPmAdapter.test.ts
  src/orchestration/Layers/PmRuntime.test.ts` from `apps/server`: 3 files, 75 tests passed.
- `bun fmt`: passed.
- `bun lint`: passed with existing repository warnings and no errors.
- `bun run typecheck` from `apps/server`: passed.
- `git diff --check`: passed.
- Manual diff review confirmed the accountability option is enabled only when the PM driver is
  Codex and settlement durability ordering is unchanged.
