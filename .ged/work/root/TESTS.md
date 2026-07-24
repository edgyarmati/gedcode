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
