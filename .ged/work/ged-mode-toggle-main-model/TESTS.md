# Tests

## Automated

- Focused tests for mode/model fallback: normal ignores Ged main, Ged workflow uses Ged main, explicit draft/thread selection wins, role presets are not mutated from composer changes.
- Existing tests must still pass.

## Required commands

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`
- `bun run build:desktop`

## Manual checks

- Composer shows explicit Normal thread vs Ged workflow state.
- Switching mode preserves focus and updates visible state.
- Ged workflow copy explains the model picker is for the main thread model.
- Composer model selection does not modify role presets.
- Global/project role preset settings still exist for subagents.
