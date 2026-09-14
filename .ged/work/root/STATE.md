# State

- Phase: complete
- Work: Retire Orchestrator release gating while preserving historical upgrade compatibility
- Active task: none
- Completed tasks: RG-01, RG-02, RG-03
- Blockers: none
- Verification: passed

## Locked decisions

- Keep the repository GitHub Actions release workflow and all packaging/updater machinery.
- Remove GedCode's internal release task, approval gate, and dispatch actuator from active use.
- A current explicit human request authorizes the PM to invoke the requested existing workflow with
  ordinary shell/`gh` access.
- Preserve historical release contracts, events, projections, persistence, migration 053, and UI
  rendering; do not auto-mutate legacy user tasks.

## Subsequent release checkpoint (2026-09-14)

- Active release work: `.ged/work/release-patch-0.4.5/`.
- Local implementation and independent reviews: passed, including final guard re-review.
- Final full tests: 4,374 passed / one existing skip; full typecheck, formatting and lint passed.
- Next: commit/push reviewed release candidate; require exact-SHA green CI before dispatch.
- Publication and cross-platform artifact validation remain pending; no release success claimed.
