# TESTS — Full-Access Codex Workers and Dismissible Helper Results

Use only focused tests during implementation. Never run `bun test`; invoke Vitest through
`bun run test` with exact affected files. Every slice must run the narrowest relevant checks, and the
final slice must run `bun fmt`, `bun lint`, and narrow contracts/server/web typechecks.

## WORKER-FULL-01 — Removed network controls

- Decode global/project settings that omit the old field and settings payloads that still contain it;
  assert current configuration has no `workerNetworkEnabled` control or behavior.
- Start a stage through the decider, PM tool, and MCP tool without `networkAccess`; assert no effective
  network field is resolved, emitted, projected, or displayed.
- Assert the Orchestrator settings panel has no worker-network toggle, reset action, description, or
  draft dirty-state calculation.
- Assert no compatibility toggle or alternate sandbox mode is introduced.

## WORKER-FULL-02 — Worker admission and environment

- Admit a Codex thread with matching stage ownership and task linkage. Assert provider session input
  has runtime mode `full-access` and omits `sandboxMode`, `networkAccess`, and `approvalReviewer`.
- At Codex thread and turn construction, assert full access maps to approval policy `never` and
  `danger-full-access`.
- Seed representative host environment entries including `HOME`, cache/temp paths, an ordinary custom
  variable, and credential-shaped names. Assert the worker receives the normal inherited environment
  rather than a filtered override.
- Admit Claude and OpenCode stage workers and assert their existing policies are unchanged.
- Admit an unowned `ged/*` thread and a mismatched stage ownership record; assert neither receives
  orchestration worker policy.
- Assert missing task worktrees are still created, worker-start permits are still used, and the
  protected-ref pre-push hook still rejects main/master/trunk/develop/dev/release targets.
- Resume/restart a Codex worker and assert the same full-access policy is reconstructed without an
  approval round-trip.

## WORKER-FULL-03 — Prompts and capability fallback

- Snapshot PM and Plan/Work/Verify instructions; assert they do not describe workspace-write,
  auto-review, network floors, sandbox escalation, credential stripping, or PM-owned authenticated
  host operations.
- Assert instructions still require worktree/task scope, avoidance of unrelated host mutations, and
  adherence to explicit external/destructive/publishing approval gates.
- Feed an ordinary shell/network event and assert it does not create a capability pause.
- Feed a synthetic unexpected external/provider approval and assert the existing durable pause,
  lifecycle delivery, resolution, timeout, and same-session resume behavior remains intact.
- Assert capability UI/copy is provider-neutral and does not claim the worker is sandbox-blocked.

## WORKER-TRIPWIRE-01 — Optional guardrail gate

Before implementing enforcement:

- Construct a worker session with a server-owned hook plus unrelated project/user/plugin hook fixtures.
- Assert the server hook can run without review while unrelated hooks retain their normal trust state.
- Assert no process-wide `--dangerously-bypass-hook-trust` or equivalent broad trust switch is used.

Only if that proof passes:

- Deny explicit out-of-worktree targets for representative destructive delete, move, truncate/raw
  overwrite, ownership/mode, and patch operations.
- Allow equivalent operations inside the task worktree when otherwise in task scope.
- Allow `uv`, package managers, compilers, and tools to write under host cache/config/temp locations.
- Cover relative paths, normalized `..`, symlinks where the hook can resolve them safely, quoted paths,
  and platform path separators supported by the implementation.
- Assert one concise denial terminates the call without creating a permission or PM approval loop.
- Document that scripts, opaque subprocesses, and opted-out tools remain outside the guardrail.

If the trust proof fails:

- Assert no hook injection, global trust bypass, alternate sandbox, or degraded enforcement path was
  added. Record the exact limitation in this file and the changelog/implementation report as relevant.

## HELPER-CARD-01 — Single latest card

- Seed multiple PM helpers in non-chronological object order and assert only the newest by canonical
  creation/id ordering is pinned.
- Add a newer helper and assert it replaces the card immediately without stacking, even while an older
  run remains active.
- Assert task-attached helpers never enter the PM pinned-card selector.
- Assert pending/running cards have no X; completed/failed/interrupted cards expose an accessible
  close action and retain result/failure details before dismissal.

## HELPER-HISTORY-01 — Dismissal and project history

- Close a terminal pinned card and assert it disappears from the top while remaining in project Helper
  history with prompt, backend/model, timing, status, and result/failure details.
- Reload client state and reconnect through an authoritative project snapshot; assert the same helper
  remains dismissed.
- Assert dismissal keys are isolated by environment, project, and helper ID.
- Start a newer helper after dismissal and assert it pins normally; the old dismissal cannot hide it.
- Assert replaced active/terminal PM helpers remain live in Helper history.
- Assert Task history continues to show task-attached helpers exactly once.
- Use focused Chromium coverage for keyboard-accessible close behavior, latest-card replacement,
  persistence, and history disclosure.

## WORKER-TRIPWIRE-02 — Recorded evidence (2026-07-26)

Trust proof and runtime mechanics are in `NOTES.md`; this section records what the implementation
verifies and what it deliberately does not.

- **Rule coverage** — `apps/server/src/orchestration/workerTripwire.test.ts` (133 tests) executes the
  exact materialized script (`WORKER_TRIPWIRE_HOOK_SCRIPT`) as a child process. It denies out-of-worktree
  `rm`/`rm -rf`, `mv` destinations and sources, `> file` truncation and `tee`, `chown`/`chmod`,
  `cp`/`install`/`ln`/`rsync`/`scp` destinations, `sed -i`, `find -delete` and `find -exec rm`,
  `git clean`/`git rm` against another checkout, and `git apply`/`patch`/`apply_patch`; allows the same
  operations inside the task worktree; and allows writes under `$HOME/.cache`, `$HOME/.local`,
  `$HOME/Library/Caches`, `$TMPDIR`, `node_modules`, and `uv`/package-manager and compiler cache paths.
  Also covered: relative paths, normalized `..`, quoted and escaped paths, symlinked roots
  (`/tmp` → `/private/tmp`, resolved through the nearest existing ancestor), `--` argument terminators,
  `>/dev/null` and the rest of the `/dev` discard family, every line of a multi-line command, the tool's
  own `workdir`, `cd` scoped to the subshell or pipeline stage that ran it, clustered and separate
  `bash -lc`/`sh -c` recursion, `xargs`/`env`/`nohup`/`time`/`sudo` wrappers, `~` and `$VAR`/`${VAR}`
  expansion, flag values that look like paths, and the credential/CLI-state roots (`~/.ssh`, `~/.aws`,
  `~/.gnupg`, `~/.config/gh`, `~/.codex`, `~/.claude`, …) which are denied wherever the command runs and
  whose refusal names the path and says "credential".
- **Deny protocol / no approval loop** — the script emits one
  `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
  "permissionDecisionReason":"…"}}` object on stdout and exits `0`. A non-zero exit would surface as a
  hook failure and an approval request would stall an unattended worker, so neither is used. Pinned by
  `workerTripwire.test.ts` and by the live A/B in `NOTES.md`, where the trusted hook produced
  `hook: PreToolUse Blocked` once with no permission request re-entering the PM.
- **Narrow trust only** — `apps/server/src/provider/Layers/codexTripwireHook.test.ts` (9 tests) and
  `codexTripwireHook.script.test.ts` (2 tests) pin the definition override shape
  (`hooks.PreToolUse=[…]`), the trust override built from the hash Codex itself reports
  (`hooks.state={ "<key>" = { trusted_hash = "sha256:…", enabled = true } }`, observed
  `sha256:6a35caff…` for the proof script), selection of the `sessionFlags`/`preToolUse` entry only, and
  that `-c` overrides precede the `app-server` subcommand. No `--dangerously-bypass-hook-trust` or any
  process-wide trust switch exists anywhere in the tree.
- **Runtime wiring** — `apps/server/src/provider/Layers/CodexAdapter.test.ts` proves two
  `destructiveTripwire` sessions share one hook probe (`configOverrides` on both runtime calls, probe
  count `1`) and that a session without the flag gets `configOverrides: undefined` and triggers no probe.
  `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts` proves a stage worker's provider
  input carries `destructiveTripwire: true` while a chat thread's input has no such property.
- **Failure policy (explicit decision, no degraded fallback)** — probe spawn failure, malformed
  `hooks/list`, or a probe exceeding 15s logs a warning and yields no overrides: the worker starts
  without the tripwire rather than not starting. This is the spec-sanctioned best-effort behavior, not an
  alternate enforcement path.
- **Known gaps (by design, enumerated in the `workerTripwire.ts` module header)** — scripts, interpreters
  and opaque subprocesses; tools that do not report through `PreToolUse`; anything reached after the
  hook's decision; targets the command does not spell out (`xargs rm` reading stdin, `apply_patch < file`,
  paths built by command substitution); and checkout-rewriting git operations that name no path
  (`git reset --hard`, `git checkout -- .`), which are ordinary in-worktree worker work. Host
  cache/config/temp locations and `node_modules` are allowed by an allowlist, so a destructive operation
  aimed there is not denied.
- **Recovery path (closed)** — `ProviderService` persists `destructiveTripwire` in the session's
  `runtimePayload` and `recoverSessionForThread` reads it back, so a recovered worker session keeps the
  tripwire. `ProviderSessionDirectory.upsert` merges payload records, so later upserts that do not
  mention the flag preserve it. Pinned by two tests in
  `apps/server/src/provider/Layers/ProviderService.test.ts` — recovery after the adapter's sessions are
  gone, and recovery after a full service shutdown rewrites every binding.
- **Probe failure is per-session** — one transient `hooks/list` probe failure no longer disables the
  tripwire for the process. `CodexAdapter` memoizes only a successful probe behind a semaphore, so the
  next worker re-probes. Pinned by "re-probes for the tripwire after a probe that produced no overrides"
  in `apps/server/src/provider/Layers/CodexAdapter.test.ts`.

## Final Quality Gates

- Update `CHANGELOG.md` under `## Unreleased` with the user-visible full-access worker change, removed
  network control, credential/environment implication, retained safeguards, and dismissible helper UI.
- Remove stale workspace-write/network-helper copy from relevant docs and planning/domain state.
- Run focused `bun run test` targets for changed contracts, provider runtime/reactor, worker safety,
  PM/capability prompts, settings/store logic, helper components, and browser routes.
- Run `bun fmt`.
- Run `bun lint`.
- Run the narrowest contracts, server, and web typechecks.
- Do not run the full workspace suite unless the user explicitly requests release verification.

### Recorded run (2026-07-26, re-run after review fixes)

| Command | Result |
| --- | --- |
| `packages/contracts`: `bun run test --run src/provider.test.ts src/orchestration.test.ts src/orchestrator/config.test.ts src/settings.test.ts src/helperRun.test.ts src/providerRuntime.test.ts` | 6 files, 132 tests passed |
| `apps/server`: `bun run test --run src/orchestration/Layers/ProviderCommandReactor.test.ts src/provider/Layers/CodexAdapter.test.ts src/provider/Layers/CodexSessionRuntime.test.ts src/provider/Layers/codexTripwireHook.test.ts src/provider/Layers/codexTripwireHook.script.test.ts src/orchestration/workerTripwire.test.ts src/orchestration/workerSafety.test.ts src/cli/config.test.ts` | 8 files, 262 tests passed |
| `apps/server`: `bun run test --run src/orchestration/Layers/PmRuntime.test.ts src/orchestration/decider.task.test.ts src/orchestration/Layers/ProjectionPipeline.test.ts src/orchestration/mcp/orchestrationMcpTools.test.ts src/orchestration/pm/pmTools.test.ts src/provider/Layers/ProviderService.test.ts` | 6 files, 253 tests passed |
| `apps/web`: `bun run test --run src/components/orchestrator/HelperRunTimeline.logic.test.ts src/components/orchestrator/projectOrchestrationSettings.logic.test.ts src/components/settings/SettingsPanels.logic.test.ts src/helperDismissalStore.test.ts` | 4 files, 34 tests passed |
| `apps/web`: `bun run test:browser src/components/orchestrator/OrchestratorRoutes.browser.tsx src/components/settings/OrchestratorDefaultsSettingsPanel.browser.tsx` | 2 files, 24 tests passed (Chromium) |
| `bun fmt` | clean (1426 files) |
| `bun lint` | exit 0; 61 pre-existing `unicorn`/`react`/`no-unused-vars` warnings in untouched files |
| `packages/contracts`, `apps/server`, `apps/web`: `bun typecheck` | all clean |

Stale-wording sweep: no `workspace-write`, `workerNetworkEnabled`, `worker network`, or `networkAccess`
remains in shipped code, copy, or docs. Surviving matches are negative assertions in tests, historical
planning text in this directory, and `.docs/runtime-modes.md`, which documents the unrelated chat
**Supervised** runtime mode. The full workspace suite was not run.
