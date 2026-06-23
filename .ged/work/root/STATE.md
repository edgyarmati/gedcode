# State

- **Phase**: implement
- **Epic**: #51 (Phase 3 — multi-stage roles + multi-backend); WP sub-issues #52+.
- **Active task**: WP-P6.3 (per-task override). Done so far: P4.1 + P5.1 (`0274474c9`),
  P5.2 (`2597c709b`), P7 integration proof (`faedf5003`, reviewed green), **P6.1 + P6.2**
  (`8e0ee3147`), and **P4.2**: dedicated `orchestrator.setTaskRoleSelections` WS method +
  typed web client helper for human-origin per-task role overrides.
- **Status**: WP-P1–P3 engine foundation + #55 WS/store plumbing committed as baseline
  (`22c17fe69`), reviewed green (fmt/lint/typecheck/test/build). The WP-P2.6 verification gap
  (exactly-once prefix across quota-resume) is closed by `stageResolution.test.ts` (`4b2c4fdf6`).
  Remaining UX lane: P6.3 task backend-override UI.
- **Blockers**: None.
- **Next step**: build the P6.3 task-override UI using `api.orchestrator.setTaskRoleSelections`
  (reuses the project editor's backend picker + the same draft logic, no prefixes). After that
  #51's UX lane is complete.

### Review note (other agent's foundation)

- Verdict: good job — all hard invariants correct + tested (PM-can't-set-config, no-silent-fallback,
  exactly-once prefix, append-only migration, durable stage-history, backend precedence).
- Optional engine-lane polish: (1) `task.stage-blocked` now updates `providerInstanceId` in the
  in-memory projector too (P7 parity fix); (2) stage-history model/instance are re-derived at
  projection rather than captured on `stage-started`.

### Review note (other agent's P7 — `faedf5003`)

- Verdict: good job — accepted. The integration suite drives the real engine/reactor/projection/
  persistence path (not mocks): full `classify→plan→review→work(quota-blocked)→resume→verify→land`,
  backend precedence across all three layers (task `codex_task` > project-role `codex_project` >
  default `codex`), exactly-once prefix incl. the quota-resume path, PM-origin rejection, stage
  ordering, durable stage-history, and a cold restart that replays blocked status/override/quota row
  then auto-resumes. Real `git worktree add`, fixed `iso()` timestamps (no Date.now), polling
  predicates (not just sleeps) as the determinism backstop.
- Shared-adapter `Queue→PubSub` switch is required for correctness (per-instance filtered substreams
  can't share a Queue) — verified it broke no other consumer (`providerService.integration.test.ts`).
- Gates re-run green: fmt/lint (zero hits in P7 files), typecheck 13/13, full suite 1238 passed,
  the 2 new integration tests pass in ~4s.
- Carry-forward (non-blocking): PubSub drops events published before a subscriber attaches — the
  restart-resume path relies on ingestion re-subscribing to the blocked instance's stream on replay
  before the quota-ok emit; correct today, worth a comment if that ordering ever changes.
