# State

- **Phase**: implement.
- **Active task**: `ORCH-LC-03` - reconcile a cancellation interrupted by server restart and
  finish only its remaining durable shutdown phases.
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
- Full verification passed after the final race and projection fixes: `bun fmt`, `bun lint` (existing
  warnings only), `bun typecheck`, `bun run test` (server 1,355 passed/1 skipped; web 1,214 passed), and
  `bun run build`.

## Immediate Sequence

1. `ORCH-LC-03` reconcile cancellation across restart.
2. `ORCH-LC-04` recover orphaned stages after restart.
3. `ORCH-LAND-01` and `ORCH-LAND-02` expose landing end to end.

## Repository State Notes

- Preserve existing untracked `release-dev/`, `release-local/`, and `release-local-fixed/` directories.
- Prior `.ged/work/root` plans remain recoverable from git history.
- Required checks are `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test`; never use `bun test`.
