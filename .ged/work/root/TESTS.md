# TESTS

## Focused Tests

### Contracts (schema-only)

- `OrchestrationStageRole` decode accepts `review`/`verify`; `OrchestrationTaskStatus`
  accepts `reviewing`.
- Role-selection map decode **rejects** a typo'd / non-role key (e.g. `verfiy`) — no silent
  default.
- `task.role-selections.set` command + `task.role-selections-updated` event round-trip;
  origin restricted to `human`/`client`.
- Per-role prompt-prefix config + durable stage-history snapshot shape decode.

### Decider / projector / stageResolution

- `stage.start` maps `review`→`reviewing`, `verify`→`verifying`;
  `activeStageRoleForTaskStatus` inverse holds for the new statuses.
- `review`/`verify` `stage.complete` holds status + clears `currentStageThreadId` (parity
  with `classify`/`plan`); settlement re-prompts the PM with the bounded result.
- Model-selection precedence: task override → project per-role → project default (all three
  layers exercised).
- **Adversarial**: a `task.role-selections.set` with origin `pm-runtime`/`system` is
  rejected; single-active-stage invariant still holds with the new roles.

### Persistence

- Migration creates the stage-history table; repository upserts rows on
  `stage-started`/`-completed`/`-blocked`; per-task override persists.
- **Restart replay**: stage history + task overrides reconstruct identically after a
  projector rebuild.

### Prompt-prefix idempotency (regression)

- A normal `stage.start` prepends the role prefix once.
- A **quota-resumed** `stage.start` (reusing the original stage user message) does **not**
  double-prefix.
- Restart-recovered re-dispatch does not double-prefix.

### PM tools

- `handoffWorker` accepts `review`/`verify`; `StageResultBuilder` serializes a `verify`
  result; PM settlement consumes it exactly once.

### Web

- Store applies durable stage-history snapshot + streamed updates; selector returns ordered
  stages per task.
- Stage-timeline logic renders 5 stages with role + backend + status.
- Config editors dispatch human-origin updates; role pickers are enum-bound (typo
  impossible).

### E2E / durability

- `classify→plan→review→work→verify→land` end-to-end with a per-task backend override and
  exactly-once prefixing.
- Server restart mid-stage: pipeline + stage history + overrides survive.

## Required Checks

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test` (never `bun test`)
- `bun run build`

## Evidence

- 2026-06-22: `cd apps/server && bun run test integration/orchestratorPipeline.integration.test.ts`
  passed (1 file, 2 tests; 22.23s), covering the full
  `classify→plan→review→work→verify→land` pipeline, backend precedence,
  non-human role-selection rejection, exactly-once prefixes across quota
  block/resume, and restart durability.
- 2026-06-22: `cd apps/server && bun run test integration/orchestratorPipeline.integration.test.ts integration/providerService.integration.test.ts integration/orchestrationEngine.integration.test.ts`
  passed (3 files, 17 passed, 1 skipped), covering the fake provider adapter
  and provider-instance alias harness changes.
- 2026-06-22: `bun run test src/orchestration.test.ts` in `packages/contracts`
  passed (1 file, 43 tests).
- 2026-06-22: focused server regression suite passed:
  `src/orchestration/decider.task.test.ts`,
  `src/orchestration/Layers/ProjectionPipeline.test.ts`,
  `src/persistence/Migrations/041_ProjectionStageHistoryAndRoleOverrides.test.ts`,
  `src/orchestration/pi/pmTools.test.ts`, and
  `src/orchestration/StageResultBuilder.test.ts` (5 files, 61 tests).
- 2026-06-22: `bun fmt` passed.
- 2026-06-22: `bun lint` passed with existing warnings only.
- 2026-06-22: `bun typecheck` passed across all 13 packages.
- 2026-06-22: root `bun run test` passed (13 successful Turbo tasks; server
  package reported 155 files passed, 1238 tests passed, 1 skipped; 7m18s).
- 2026-06-22: root `bun run build` passed (3 successful Turbo tasks, 2 cached;
  existing Vite chunk-size and module deprecation warnings only).
