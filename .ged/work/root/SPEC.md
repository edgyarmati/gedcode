# Spec

## Goal

Make the top Ged workflow status badge accurately reflect checkpoint progress instead of showing `implementing` for every active workflow.

## Problem

`GedWorkflowServiceLive` maps any active checkpoint lifecycle to `phase: "implement"`. This makes random questions and pre-plan work show an inaccurate `implementing` pill while Ged is running.

## Scope

- Derive `GedWorkflowState.phase` from checkpoint gates:
  - closed lifecycle -> `done`
  - trivial active task -> `classify`
  - non-trivial with no valid clarification -> `clarify`
  - non-trivial with clarification but no valid planner checkpoint -> `plan`
  - non-trivial with valid planner but no valid verifier -> `implement`
  - verified lifecycle or valid verifier -> `verify`
- Improve badge copy so it communicates the actual workflow gate, not just a generic verb.
- Add focused tests for phase derivation.

## Non-goals

- Do not change the checkpoint schema.
- Do not add a new WebSocket push channel for Ged workflow state.
- Do not redesign the full chat header.

## Acceptance Criteria

- Random/trivial turns no longer show `implementing`.
- Non-trivial turns before planning show clarification or planning-oriented copy.
- Planned-but-unverified work still shows implementation-oriented copy.
- Verified/closed states are distinguishable.
- `bun fmt`, `bun lint`, and `bun typecheck` pass.
