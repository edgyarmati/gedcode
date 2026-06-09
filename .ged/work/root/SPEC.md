# Spec

## Goal

Hide the Ged workflow status pill when the current chat is idle.

## Problem

The previous fix made the label more accurate, but the header still renders `workflowState` unconditionally. Since `workflowState` is read from persistent checkpoint files, stale planning/checkpoint state remains visible after an answer has completed.

## Scope

- Gate the header workflow pill by live work state.
- Show the pill while a turn is actively dispatching or running.
- Hide it once the thread is idle, even if checkpoint files still describe a pending workflow phase.
- Add focused client logic coverage for the display gate.

## Non-goals

- Do not change the checkpoint schema.
- Do not remove checkpoint polling.
- Do not redesign the header.

## Acceptance Criteria

- The screenshot state shown by the user would not display `planning gate` while the composer is idle.
- The pill still appears during local send/dispatch or active provider running state.
- `bun fmt`, `bun lint`, and `bun typecheck` pass.
