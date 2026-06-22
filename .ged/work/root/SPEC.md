# SPEC

## Goal

Implement WP-Q2, WP-Q3, and WP-Q4 from GitHub issues #45, #46, and #47:

- derive durable per-provider-instance quota status from WP-Q1 provider runtime signals;
- block active worker stages on quota exhaustion without failing or abandoning the task;
- skip new worker starts on quota-blocked instances;
- resume blocked stages exactly once when quota returns or an operator re-drives the stage;
- bound quota retry loops with `maxRetriesPerStage`.

## Constraints

- WP-Q1 is present locally as commit `eef76fef`; use its structured `account.rate-limits.updated` payload and `runtime.error.payload.class === "rate_limit"`.
- Do not invent additional fallback/degraded paths beyond the quota-blocked path approved in #43.
- Keep `packages/contracts` schema-only.
- Event store remains append-only. Migrations may add derived projection tables/columns only.
- Preserve deterministic command id + persisted command receipt dedup for exactly-once resumption.
- Do not call paid/networked LLMs in tests.
- Do not run `bun test`; use `bun run test`.

## Acceptance Criteria

- Q2: Provider instance quota status query returns `ok`, `blocked-until-T`, or `blocked-unknown` per `providerInstanceId`.
- Q2: Rate-limit telemetry transitions `warning`/`exhausted` into blocked states and `ok` into clear/ok state; classified `rate_limit` runtime errors block unknown-reset instances.
- Q3: `task.stage.block` command emits `task.stage-blocked` with `{ taskId, stageThreadId, role, reason: "quota", providerInstanceId, resetAt? }`.
- Q3: Projector derives `blocked-on-quota`; the task remains resumable and non-terminal, and the blocked event is visible to PM/UI event consumers.
- Q3: Worker start admission skips a worker whose target `providerInstanceId` is quota-blocked and dispatches the stage block exactly once.
- Q4: A blocked stage is re-driven through `task.stage.start` with deterministic command ids so concurrent/manual/detected resumptions dedup.
- Q4: `maxRetriesPerStage` defaults safely, is configurable in project/global orchestrator config, and prevents quota retry loops fail-closed.
- CHANGELOG documents user/operator-visible unreleased behavior.
