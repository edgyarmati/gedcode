# SPEC — Full-Access Codex Workers and Dismissible Helper Results

## Goal

Remove Codex worker sandbox, network, environment, and ordinary approval friction so Plan, Work, and
Verify stages can complete autonomously inside their task worktrees. Preserve worktree/task isolation
and protected-branch push blocking. Make the latest PM helper result easy to inspect and explicitly
dismiss into durable project history.

## Domain Language

- **Worker**: an orchestration-owned Plan, Work, or Verify stage thread with a task worktree.
- **Full-access worker**: a Codex worker launched with `danger-full-access`, approval policy `never`,
  unrestricted network, and the host environment inherited without GedCode credential filtering.
- **Capability pause**: the existing durable path for an unexpected external/provider approval. It is
  not part of ordinary shell, filesystem, network, or credential use after this change.
- **Destructive-operation tripwire**: an optional Codex `PreToolUse` guardrail that rejects clearly
  destructive commands whose explicit target resolves outside the worker worktree. It is not a
  security boundary.
- **Pinned helper card**: the single newest PM-attached helper shown above the PM conversation.
- **Helper history**: durable project-level access to PM-attached helper runs after a pinned terminal
  card is dismissed or replaced. Task-attached helpers continue to use Task history.

## Contract

### Codex worker access

- Only threads with valid persisted stage ownership and a matching task receive worker policy.
- Every Codex worker stage uses runtime mode `full-access`, which maps to approval policy `never` and
  `danger-full-access` for both thread and turn startup.
- Codex workers receive no worker-specific `sandboxMode`, `networkAccess`, or auto-review override.
- Codex workers inherit the normal host process environment. Remove the worker environment allowlist
  and credential-name filtering from worker session admission.
- Remove global `workerNetworkEnabled` settings UI/config and per-handoff `networkAccess` inputs,
  resolution, persistence, projections, copy, and tests.
- Existing persisted settings/events may contain removed fields. Decoding must remain safe through the
  repository's normal unknown-field behavior; no runtime compatibility behavior or UI facade remains.
- Claude and OpenCode worker policies remain unchanged.
- PM and helper policies remain unchanged. Helpers continue to be provider-enforced read-only runs.

### Retained worker safeguards

- Keep task worktrees, explicit orchestration ownership, worker-start admission, task concurrency
  limits, scoped stage instructions, and the worktree-local protected-ref pre-push hook.
- Prompts must stop describing workers as sandboxed, network-limited, or unable to use authenticated
  host operations. They must still instruct workers to remain within task scope, avoid unrelated host
  changes, and leave external/destructive/publishing actions to existing human gates where applicable.
- Keep capability-pause persistence and PM delivery for unexpected external/provider approval
  requests. Remove sandbox/network/credential-specific assumptions and ordinary worker approval copy.

### Optional Codex tripwire

- First prove that a server-owned worker hook can be injected and trusted narrowly without trusting
  project, user, or plugin hooks and without generating a review prompt.
- If narrow trust cannot be proven, do not install a hook and do not bypass trust globally. Record the
  limitation in implementation evidence; prompt guidance remains the only added guardrail.
- If feasible, inspect Codex shell and patch calls before execution. Reject only clearly destructive
  operations with explicit out-of-worktree targets, such as deletion, destructive moves, truncation,
  raw overwrites, ownership/mode changes, or direct patches.
- The tripwire must allow normal external cache, package-manager, compiler, configuration, and temp
  writes, including `uv` cache use. It must return one concise denial, not start an approval loop.
- Treat the tripwire as best-effort accident prevention, never as filesystem isolation.

### Latest helper result

- The project PM route shows at most one pinned helper card: the newest PM-attached helper.
- Starting a newer PM helper replaces the prior pinned card immediately. The prior run remains live
  and visible in Helper history even if it has not settled.
- Pending/running cards cannot be dismissed.
- Completed, failed, or interrupted cards show an accessible X control.
- Dismissal is client-local UI state keyed by environment, project, and helper ID. It survives reloads
  and reconnects but need not synchronize to another browser/device.
- A dismissed helper remains in project-level Helper history with prompt, backend, status, result or
  failure, and timing. A newer helper is not hidden by an older dismissal.
- Task-attached helpers remain in Task history and do not appear in the project pinned card.

## Compatibility Decision

This is an unreleased product. Do not retain old sandbox/network behavior, a settings fallback, or
dual worker modes. Historical unknown fields may decode harmlessly, but they have no behavioral effect.
The capability-pause path is retained only because it also handles non-sandbox provider approvals.

## Constraints

- Performance, reliability, restart behavior, and ownership checks remain first-class.
- Do not weaken protected-branch push blocking or task/worktree resolution.
- Do not change PM access or read-only helper execution.
- Do not broaden Codex hook trust to implement the optional tripwire.
- Ordinary implementation uses focused tests only. Never run `bun test`; use `bun run test`.
- Before completion, `bun fmt`, `bun lint`, narrow contracts/server/web typechecks, focused tests, and
  a relevant `CHANGELOG.md` entry under `## Unreleased` must pass.
- Implementation should use Terra subagents with high reasoning. Parallelize only independent slices;
  serialize shared contract, prompt, planning-state, and changelog edits to avoid collisions.

## Acceptance Criteria

- A valid Codex Plan, Work, or Verify stage starts and resumes as full access with no sandbox,
  auto-review, network toggle, environment filtering, or ordinary approval round-trip.
- Codex workers can use external caches and credential-backed CLI operations while remaining rooted in
  the task worktree and unable to push protected refs through the installed Git hook.
- Claude, OpenCode, PM, helper, ownership, concurrency, and worktree behaviors do not regress.
- Unexpected external/provider approvals still enter the durable capability-pause path.
- The network setting and handoff option are absent from contracts, server behavior, prompts, and UI.
- At most one latest PM helper is pinned; terminal dismissal survives reload/reconnect; replaced or
  dismissed helpers remain easy to inspect in project Helper history.
- Any tripwire implementation proves narrow trust and cache compatibility. Otherwise it is omitted
  without an unsafe fallback and the limitation is documented.
