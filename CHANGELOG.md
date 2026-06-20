# Changelog

Release notes are grouped by released version. Add a `## X.Y.Z` section before running
`./release.sh stable ...` or `./release.sh nightly ...`.

## Unreleased

- Internal: Capture the worker's code diff in the Orchestrator mode PM re-entry envelope via a new bounded, secret-scrubbed `StageResultBuilder`. A completed worker stage previously fed the PM only flat assistant text; the PM now also receives a structured, clearly-delimited diff section so it can reason over the actual code changes. The diff is read from the checkpoint/projection (`CheckpointDiffQuery.getFullThreadDiff` keyed off `ProjectionSnapshotQuery.getFullThreadDiffContext.latestCheckpointTurnCount`), never from the worker agent directly, and is treated as untrusted: the assistant text and the diff patch each ride the one shared `boundUntrustedContent` scrub+cap helper (now extracted to `orchestration/untrustedContent.ts` so the builder and `PmRuntime` share a single redaction implementation), and the assembled envelope is bounded once more so the combined message cannot exceed the documented limit. A one-line "N files changed" summary is derived from the patch. A diff that is missing, empty, or fails to read (`CheckpointServiceError`) degrades to a no-diff section and logs a warning — it never fails the settlement, and the human gate-resolution re-entry path is unchanged. Builder runs as a pure read-only step before the consume+cursor transaction, so exactly-once PM re-entry is preserved.
- Internal: Add Orchestrator mode command-queue contention measurement (instrumentation only — no change to the engine's single-queue dispatch serialization or any runtime behavior). A pure `classifyOrchestrationCommand` classifier labels each dispatched command (`streaming`/`turn`/`thread-control`/`project`/`task`), and two new histograms — `t3_orchestration_command_queue_depth` (queue depth sampled at offer time) and `t3_orchestration_command_queue_wait_duration` (milliseconds an envelope waited before the serialized worker picked it up) — are emitted around the existing dispatch path. The data is intended to inform a future lane-split decision; it does not split lanes or alter dispatch ordering today.
- Internal: Add Effect Metrics observability to the Orchestrator mode durability paths (instrumentation only, no control-flow or semantics change): the PM reconciliation sweep (run count, duration, and settlements re-driven), PM re-entry turn latency, the SQLite busy/locked write retry (attempts and budget exhaustions), and the worktree reaper (worktrees removed, labeled by `terminal`/`orphaned` cleanup reason). New `t3_orchestration_*` metrics are defined alongside the existing orchestration metrics in `observability/Metrics.ts`.
- Fix: Close the Orchestrator mode PM re-entry liveness gap by adding a two-phase `pending` -> `acted` settlement marker, migration 038, and a configurable PM reconciliation sweep that re-drives stalled settlements through the existing single-writer PM re-entry queue.
- Fix: Add a configurable Orchestrator mode task-worktree reaper (`worktreeReaperIntervalMinutes`) that periodically scans deterministic task worktree directories and removes leaked worktrees with no live task owner.
- Internal: Pin `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` (both `0.79.3`, exact) in the server and add a decision spike (`docs/decisions/2026-06-pi-agent-core-api.md`) verifying the PM-runtime API ahead of Orchestrator mode. No user-facing or runtime behavior change.
- Internal: Add server persistence migrations 033–037 for Orchestrator mode — task projection (`projection_tasks`), PM re-entry reconciliation sources (`projection_awaited_stages`, `projection_pending_gates`), the pi PM-brain session store (`pm_sessions`, `pm_session_entries`), exactly-once PM re-entry bookkeeping (`pm_runtime_cursor`, `pm_consumed_settlements`), and an `orchestrator_config_json` column on the project projection. Additive DDL only; no backfill, no event-log mutation, and no user-facing behavior until the feature is wired up.
- Internal: Advance Orchestrator mode server foundations with derived task/pending-gate projections, task command invariants, human-only gate resolution checks, max active task-worktree guards, terminal task worktree cleanup/pruning, worker runtime-mode clamping, task worktree/push-hook bootstrap, secret-stripped worker session environments, host-wide worker start admission, startup reconciliation for orphaned task-stage turns, internal worker stage-completion events, a locked-down pi PM execution environment, SQLite-backed pi session storage with dangling tool-call repair, PM command tools that dispatch through the decider, deterministic PM-thread projection for pi user/assistant/tool events, orchestrator WebSocket RPCs for PM messages, project/task subscriptions, and human gate resolution, an exactly-once PM cursor/settlement repository, and a restart-replay PM runtime that uses durable project cursors, buffers live settlements behind historical catch-up, and feeds bounded redacted worker/gate settlements back to the PM queue exactly once.
- Internal: Add a mocked Orchestrator mode thin-slice E2E proof covering task creation/classification, one detached work-stage handoff, human-only plan and land gates, exactly-once PM re-entry across a restart-window replay, secret redaction in the PM worker-result envelope, and terminal task landing.
- UI: Add the first Orchestrator mode web surfaces: a persisted Chat/Orchestrator mode switch, `/orch` project grid, project PM workspace with task board, task detail with shared timeline rendering, the shared PM composer, proposed-plan and diff panels, gate approval controls, orchestrator RPC pass-throughs, and ref-counted project/task subscriptions feeding task and pending-gate store selectors.
- Fix: Honor the `allowFullAccessWorkers` opt-in for Orchestrator mode worker stages. The flag was previously dead config — a `full-access` worker was always clamped to `auto-accept-edits` regardless of it. The provider command reactor now resolves the flag (per-project `resourceLimits` OR the global default, both still defaulting to `false`) and feeds it to a pure `clampWorkerRuntimeMode` helper, so an operator who deliberately opts in can keep a `full-access` worker while the safe clamp still fires by default. The opt-in only rides the human/client write path, so a prompt-injected PM cannot raise its own workers.
- Internal: Move all `@earendil-works/pi-*` access for PM model/provider/API-key resolution behind a new `orchestration/pi/PmModelResolver.ts` helper so the pi dependency no longer leaks into `orchestration/Layers/PmRuntime.ts`, keeping the pi boundary confined to `orchestration/pi/`. No runtime behavior change.
- Fix: Scrub secrets and length-bound the Orchestrator mode gate-resolution settlement before it reaches the prompt-injectable PM. The human-gate re-entry envelope — which embeds the human-controlled, unbounded `task.title` (and the free-form `approvedHash`/`gateId`) — previously bypassed the `boundUntrustedContent` redaction/length cap that the worker-stage envelope already used; both PM re-entry settlement messages now ride the same bounded, redacted path.
- Docs: Document the Orchestrator mode PM re-entry durability ordering as a deliberate at-most-once design. The consumed-settlement marker and project cursor commit in one transaction _before_ the side-effecting PM turn, which guarantees a crash can never replay a settlement into a second PM turn (no double-dispatch) at the cost of a recoverable liveness gap — a crash in the post-commit/pre-act window stalls the owning task until an operator re-issues the human action. Automatic reconciliation is deferred pending a durable two-phase (pending → acted) record the single-marker schema cannot express.
- Docs: Correct the `orchestratorDefaults.maxParallelWorkers` comment to describe it accurately as the host-wide worker _start-admission_ throttle. The permit is released the moment `startSession` returns, so it bounds concurrent worker _starts_ (smoothing the startup/replay thundering herd), not the number of workers _running_ concurrently. The running-worker ceiling is the pure decider — `maxParallelTasks` (active task worktrees) plus the single-active-stage-per-task invariant — which a prompt-injected PM cannot exceed.
- Internal: Pin the Orchestrator mode PM re-entry queue serialization invariant with a regression test and a clarifying comment. Because the pi adapter's blocking `prompt` holds the single drain permit for the whole turn, a settlement that arrives mid-turn is buffered and rides the next batched `prompt` rather than racing into the busy-adapter `follow-up` fallback (review finding L2).
- Fix: Gate Orchestrator mode stage completion on a real captured diff. A worker stage previously completed the instant `turn.completed` arrived, before the worktree diff was captured, so the PM could re-enter with a not-yet-persisted diff. The stage now completes only once `CheckpointReactor` confirms a real captured diff (any `status !== "missing"` checkpoint, including an empty-but-captured `files: []` diff; genuine no-op turns no longer block), with a hard-coded 30s fail-loud diff-wait timeout in the runtime ingestion path so a stage can never stall (e.g. a non-git workspace) — the timeout completes with `diffComplete: false`. Both paths dispatch the same deterministic command id, so the engine's command-receipt dedup makes PM re-entry exactly-once (whichever path commits first wins, the other dedups) with no in-memory latch, surviving restarts.
- Fix: Harden SQLite against concurrent-writer contention now that Orchestrator mode runs multiple persistence writers (PM runtime, projection pipeline, session/task/checkpoint stores) against one database. Every connection now sets `PRAGMA busy_timeout` so SQLite blocks for a bounded window before surfacing a lock error, and each write transaction is wrapped in a jittered, bounded retry that fires _strictly_ on `SQLITE_BUSY`/`SQLITE_LOCKED` — never on constraint, syntax, or any other failure, since retrying a non-transient error is unsafe. The retry re-runs the whole rolled-back transaction, preserving atomicity; reads are intentionally left unwrapped. The busy window, initial/maximum backoff, and attempt count are tunable via `T3CODE_SQLITE_BUSY_TIMEOUT_MS`, `T3CODE_SQLITE_RETRY_INITIAL_BACKOFF_MS`, `T3CODE_SQLITE_RETRY_MAX_BACKOFF_MS`, and `T3CODE_SQLITE_RETRY_MAX_ATTEMPTS` (each floored to 1 so a stray value can never disable the handler). Critically, the retry predicate also recovers the busy/locked signal from the raw `node:sqlite` cause: the driver reports the SQLite primary result code on `errcode`, which Effect's `classifySqliteError` does not read, so a _real_ busy/locked error arrives classified as `UnknownError` rather than `LockTimeoutError` — gating on the reason tag alone would have left the retry silently dead in production. Covered by a live two-connection contention test that proves an actual `SQLITE_BUSY` retries to the bound and recovers once the lock is released.

## 0.1.3-nightly.20260614.1

- Improve: Derive orchestration shell-stream events once per domain event in the engine and fan the mapped result out to all shell subscribers, removing the prior per-event per-subscriber projection re-query.
- Remove: Drop the bundled marketing site (`apps/marketing`).
- Remove: Drop PostHog usage telemetry from the server.
- Remove: Drop the Cursor agent provider; Codex, Claude, and OpenCode remain.
- Remove: Drop Bitbucket and Azure DevOps source-control integrations; GitHub and GitLab remain.
- Improve: Rework chat message metadata, timestamps, and tool work-log rows for denser timelines.
- Improve: Virtualize and polish the provider model picker for large model catalogs.
- Fix: Sync Codex app-server protocol handling and provider startup behavior, including service-tier model options.
- Fix: Improve source-control provider detection for self-hosted GitLab and multi-account GitHub auth.
- Fix: Reduce repeated macOS permission prompts by avoiding eager protected-directory and Tailscale status probes.
- Fix: Include standard Linux desktop icon sizes in AppImage packaging.
- Fix: Preserve forwarded SSH HTTP status markers in desktop remote API errors.
- Fix: Surface redacted stdout diagnostics when SSH commands fail without stderr output.
- Provider support: Gate Claude Fable 5 behind supported Claude Code versions and expose its reasoning/context options.
- Fix: Handle Claude SDK system messages as structured tool-denied events or clearer diagnostics instead of generic runtime-warning floods.
- Fix: Deny pending Claude AskUserQuestion requests when a session stops instead of auto-approving them with empty answers, and emit a single resolved event.
- Fix: Spawn the server build's Node subprocess directly instead of routing it through the Windows shell.
- Fix: Spawn Windows PowerShell environment probes directly instead of routing them through the shell.
- Fix: Spawn trusted system executables directly instead of routing them through the Windows shell.
- Fix: Keep running turns open until the provider session ends or is superseded, including live store updates, provider steer handling, and completion duration formatting.
- Performance: Reduce VCS remote status polling churn by using a remote-only Git status path and delaying automatic refreshes when cached remote snapshots are available.
- Docs: Add upstream decision tracking for pending upstream-only work and record the initial implementation categories.
- Fix: Repair the desktop `dev`, `start`, and `smoke-test` turbo tasks, which still depended on the pre-rebrand `t3#build` package and failed to resolve; they now depend on `gedcode#build` so the desktop app builds and launches locally.

## 0.1.2

- Pin the desktop release builder to the ad-hoc-signing-compatible version and verify macOS artifacts before upload so unsigned builds can still be manually opened without Gatekeeper reporting them as damaged.

## 0.1.1

- Desktop
  - Fix in-app desktop update installation by preserving the updater-owned quit flow and using silent installs only on Windows.
  - Add packaged desktop identity metadata and keep packaged development builds out of live update mode.
- Release and packaging
  - Add release wrapper scripts and packaged-dev desktop identity metadata.
  - Keep packaged dev out of live mode and allow nightly releases after a stable release.
  - Resolve previous release notes tags with the nightly channel for nightly releases.
  - Ignore `docs/research` in format/lint checks and allow hosted web pairing deployments to use fork-owned router and channel domains.
- Ged workflow
  - Scope runtime checkpoints to each thread and guard checkpoint ownership.
  - Enforce auto-escalation and surface more accurate workflow status phases.
  - Clarify runtime escalation, Codex Ged subagent presets, and sequential role gates with main-thread fallback.
  - Show the workflow badge only while the latest turn is running and hide it while chat is idle.
- Provider support
  - Expose the Claude Fable model.
- UI
  - Fix light-mode contrast for destructive outline buttons such as connectivity Revoke actions.
- CI
  - Fix `tsgo` typechecking after Effect's `Sink` export moved behind the package root.

## 0.1.1-nightly.20260610.1

- Ged workflow
  - Scope runtime checkpoints to each thread and guard checkpoint ownership.
  - Enforce auto-escalation and surface more accurate workflow status phases.
  - Clarify in the workflow prompt that the harness/runtime may upgrade initially trivial tasks to non-trivial after observing scope.
  - Require native Codex Ged subagents to use the configured role model and reasoning presets when subagent tools are available.
  - Clarify runtime escalation, Codex Ged subagent presets, and sequential role gates with main-thread fallback.
  - Show the workflow badge only while the latest turn is running and hide it while chat is idle.
- Release and packaging
  - Add release wrapper scripts and packaged-dev desktop identity metadata.
  - Keep packaged dev out of live mode and allow nightly releases after a stable release.
  - Ignore `docs/research` in format and lint checks.
  - Allow hosted web pairing deployments to use fork-owned router and channel domains.
- Provider support
  - Expose the Claude Fable model.
- UI
  - Fix light-mode contrast for destructive outline buttons such as connectivity Revoke actions.
