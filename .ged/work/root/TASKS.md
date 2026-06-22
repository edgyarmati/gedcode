# TASKS

- [x] Add quota status projection persistence and query service.
  - Verify with migration/repository tests covering default `ok`, blocked-until, blocked-unknown, and clear-to-ok transitions.
- [x] Feed the quota projection from provider runtime ingestion.
  - Verify `account.rate-limits.updated` and `runtime.error` with `class: "rate_limit"` update per-instance quota status.
- [x] Add `task.stage.block` / `task.stage-blocked` contract, decider, projector, and durable projection support.
  - Verify command/event decoding, decider invariants, in-memory projector, and projection pipeline task rows.
- [x] Gate worker starts on blocked provider instances.
  - Verify `ProviderCommandReactor` dispatches a quota block and does not call `providerService.startSession` for blocked worker stages.
- [x] Add exactly-once stage resumption and `maxRetriesPerStage`.
  - Verify blocked stages redrive with deterministic command ids when quota flips to ok and retry limits reject further resumes.
- [x] Update changelog and run required verification.
  - Verify focused tests plus `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` evidence are recorded.
