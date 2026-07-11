# State

- **Phase**: implement.
- **Active task**: `ORCH-LAND-01` - add a guarded landing actuator to PM tools and MCP.
- **Roadmap source**: `.ged/work/root/SPEC.md`, `TASKS.md`, and `TESTS.md`.
- **Execution rule**: one bounded slice at a time; do not batch the roadmap.
- **Deferred by user**: `ORCH-ORDER-01` server-enforced canonical pipeline ordering.
- **Worker policy**: GPT-5.6 Terra/high for medium work; GPT-5.6 Sol/high for difficult or
  cross-cutting work. Current `setTaskBackend` can enforce the model but not reasoning effort;
  `ORCH-BACKEND-01` tracks that gap.

## Current Progress

- Planning artifacts refreshed for the Orchestrator completion roadmap on 2026-07-10.
- All prior orchestration tasks are terminal/abandoned, but remain in the ledger because task deletion is
  not implemented.
- `ORCH-LC-01` and `ORCH-LC-02` are complete on `main` in commits `7ef9c07c2`, `24827fed6`, and
  `c1bdaca7d`.
- Cancellation now reserves the task durably, serializes against worker startup, checkpoints provider
  interrupt/session stop/thread close, records retryable failures, and abandons only after shutdown.
- Direct abandonment of a live task is internal-only. Projection snapshots, SQL persistence, live event
  subscriptions, and the web store all carry the cancellation state.
- `ORCH-LC-03` is complete: startup reconciliation resumes durable cancellation reservations before
  provider/task reactors start, skips checkpointed phases, does not resurrect missing provider sessions,
  and retries transient failures with bounded backoff.
- Final `ORCH-LC-03` verification passed: `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and the clean root `bun run test` rerun (server 1,360 passed/1
  skipped; web 1,214 passed). One unrelated server-router bootstrap test flaked on the first root run and
  then passed 71/71 in isolation before the clean root rerun.
- `ORCH-LC-04` is complete. Restart reconciliation now durably interrupts orphaned current stages,
  settles the PM exactly once, clears the active-stage pointer, and permits a fresh same-role handoff.
  Reconciliation is serialized with worker lifecycle changes and rechecks provider liveness under the
  task lock so it cannot interrupt a worker that became live during startup.
- Final `ORCH-LC-04` verification passed on 2026-07-11: `bun fmt`, `bun lint` (existing warnings only),
  `bun typecheck`, `bun run build`, and `bun run test` (server 1,373 passed/1 skipped; web 1,215 passed).

## Immediate Sequence

1. `ORCH-LAND-01` add guarded PM/MCP landing actuation.
2. `ORCH-LAND-02` expose landing through RPC and task-detail UI.

## Repository State Notes

- Preserve existing untracked `release-dev/`, `release-local/`, and `release-local-fixed/` directories.
- Prior `.ged/work/root` plans remain recoverable from git history.
- Required checks are `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`; never use `bun test`.
