# Verification Plan

## Focused automated coverage

- Run the checkpoint stage-gate test file.
- Assert a placeholder-triggered real checkpoint is captured while the task stays `working` and no
  `task.stage-completed` event exists.
- Emit the matching completed provider turn and assert exactly one stage completion with the shared
  deterministic command ID.
- Retain coverage for the ordinary terminal-completion capture path.

## Repository checks

- `bun fmt`
- `bun lint`
- Narrowest server package typecheck command discovered from package scripts.
- Focused Vitest invocation via `bun run test`; never invoke `bun test`.

## Expected outcome

Checkpoint progress remains observable during a running turn, but task/PM state cannot advance until
the provider declares the turn terminal.

## Evidence

- `bun run test src/orchestration/Layers/CheckpointReactor.test.ts
  src/orchestration/Layers/CheckpointReactor.stageGate.test.ts` from `apps/server` passed: 2 files,
  19 tests. The regression proves a real mid-turn checkpoint does not emit
  `task.stage-completed`, the task stays `working`, the terminal event completes exactly once, and
  the terminal checkpoint includes a file created after the early checkpoint.
- `bun fmt` passed across 1,447 files.
- `bun lint` passed with warnings and no errors. Reported warnings are existing repository warnings;
  the warning in the touched stage-gate test points to the pre-existing harness helper.
- `bun run typecheck` from `apps/server` passed.
- `git diff --check` passed.
- Acceptance review confirmed interrupted/cancelled runtime states map to `missing`, for which the
  checkpoint path does not settle a stage, and the existing deterministic completion command ID is
  unchanged.
