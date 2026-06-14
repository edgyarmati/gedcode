# Changelog

Release notes are grouped by released version. Add a `## X.Y.Z` section before running
`./release.sh stable ...` or `./release.sh nightly ...`.

## Unreleased

- Internal: Pin `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` (both `0.79.3`, exact) in the server and add a decision spike (`docs/decisions/2026-06-pi-agent-core-api.md`) verifying the PM-runtime API ahead of Orchestrator mode. No user-facing or runtime behavior change.
- Internal: Add server persistence migrations 033–037 for Orchestrator mode — task projection (`projection_tasks`), PM re-entry reconciliation sources (`projection_awaited_stages`, `projection_pending_gates`), the pi PM-brain session store (`pm_sessions`, `pm_session_entries`), exactly-once PM re-entry bookkeeping (`pm_runtime_cursor`, `pm_consumed_settlements`), and an `orchestrator_config_json` column on the project projection. Additive DDL only; no backfill, no event-log mutation, and no user-facing behavior until the feature is wired up.

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
