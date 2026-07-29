# Active Stage Steering

## Goal

Prevent the PM from steering a completed or superseded worker stage whose later turn completion is
no longer tracked by orchestration.

## Constraints

- Keep same-thread steering for the task's currently active stage.
- Reject completed and superseded stage threads before dispatching a provider turn.
- Direct the PM toward a fresh tracked worker attempt after stage settlement.
- Do not add stage-reopening or compatibility behavior.
- Add focused regression coverage and an Unreleased changelog entry.

## Acceptance Criteria

1. `steerStage` continues to dispatch a turn for the exact active stage thread.
2. `steerStage` rejects a completed task stage when `currentStageThreadId` is null.
3. `steerStage` rejects an older task-owned stage after a newer stage takes ownership.
4. Rejection dispatches no provider turn and explains that a fresh tracked attempt is required.
5. Focused tests, formatting, lint, and server typecheck pass.
