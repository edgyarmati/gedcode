# TASKS — Full-Access Codex Workers and Dismissible Helper Results

Status values: `NEXT`, `TODO`, `BLOCKED`, `DONE`. Complete each slice in one focused 2–15 minute
session. Use Terra subagents with high reasoning for implementation; parallelize only slices that do
not edit the same files.

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| WORKER-FULL-01 | DONE | Remove global `workerNetworkEnabled` and handoff `networkAccess` from current contracts, defaults, and command/event schemas. Rely on normal unknown-field decoding for historical payloads; add no compatibility mode. | Focused contract/config decoding tests prove current types omit both controls while old extra fields do not reactivate behavior. |
| WORKER-FULL-02 | DONE | Remove worker-network resolution and persistence from the decider, projector, SQL projection mapping, and snapshot hydration. Do not add a migration solely to erase inert historical values. | Focused decider, projector, projection-pipeline, and snapshot tests prove new attempts emit/hydrate no network policy and replay remains valid. |
| WORKER-FULL-03 | DONE | Remove `networkAccess` from PM and orchestration MCP handoff tools, schemas, labels, and result copy. | Focused PM-tool and MCP tests reject/ignore no legacy behavior and prove current handoffs dispatch without a network field. |
| WORKER-FULL-04 | DONE | Remove the worker-network setting from settings draft logic and UI, including dirty/reset behavior and explanatory copy. | Focused settings logic and browser tests prove the control is absent and neighboring settings still save/reset correctly. |
| WORKER-FULL-05 | DONE | Change matching Codex stage-owned sessions to runtime mode `full-access`, removing worker `sandboxMode`, `networkAccess`, and auto-review overrides while preserving ownership checks, worktree resolution, and start permits. | Provider reactor/runtime tests pin `full-access` → `never`/`danger-full-access`, resume behavior, unchanged unowned threads, and unchanged Claude/OpenCode policy. |
| WORKER-FULL-06 | DONE | Remove the filtered worker-environment override so Codex workers inherit the host environment, including credential variables. Delete obsolete allowlist/filter helpers while retaining worktree creation and protected-ref pre-push installation. | Worker-safety and provider-admission tests prove normal environment inheritance, cache/credential availability, and retained push/worktree safeguards. |
| WORKER-FULL-07 | DONE | Rewrite PM/stage/project-context prompts and capability copy to remove sandbox, network, credential, and authenticated-operation handoff assumptions. Keep task scope, external/destructive/publishing gates, and generic unexpected external/provider capability pauses. | Prompt snapshots and focused capability tests show no ordinary sandbox choreography and unchanged durable handling for a synthetic external approval. |
| WORKER-TRIPWIRE-01 | DONE — narrow trust proven, see `NOTES.md` | Prove whether a server-owned Codex `PreToolUse` hook can be trusted narrowly and without prompts. If not, record the limitation and make no hook/trust change. | Runtime/config fixtures prove unrelated project/user/plugin hooks are not trusted and no global trust bypass is used. |
| WORKER-TRIPWIRE-02 | DONE — implemented, see `TESTS.md` | Only if `WORKER-TRIPWIRE-01` proves narrow trust, add explicit out-of-worktree destructive-target checks for Codex workers while allowing caches/temp/package tools. Otherwise mark this slice blocked-by-design with no degraded fallback. | Focused hook tests deny representative explicit external destruction once, allow in-worktree edits and `uv` cache use, and create no approval loop. |
| HELPER-CARD-01 | DONE | Refactor PM helper presentation to pin only the newest PM-attached run. A newer run replaces the prior card; active cards have no dismiss action; terminal cards expose an accessible X. | Pure selector/component tests cover canonical ordering, replacement, one-card maximum, task-helper exclusion, and terminal-only dismissal. |
| HELPER-HISTORY-01 | DONE | Add project-level Helper history for every PM-attached run and client-local dismissed-ID persistence scoped by environment/project/helper. | Store/persistence tests cover dismissal survival, scoping, reconnect snapshots, newest-helper precedence, and full result/failure retention. |
| HELPER-HISTORY-02 | DONE | Wire pinned-card dismissal and project Helper history into the PM route with accessible interaction and unchanged Task history. | Focused browser tests cover close, reload/reconnect, replacement without stacking, history disclosure, and unchanged task-helper rows. |
| WORKER-FULL-VERIFY-01 | DONE | Update `CHANGELOG.md` and stale operator/domain wording; run focused regressions, `bun fmt`, `bun lint`, and narrow contracts/server/web typechecks. Record exact evidence in `TESTS.md` and set `STATE.md` complete only after success. | Required focused commands and quality gates pass; unrelated pre-existing failures are documented without expanding scope. |

## Execution Coordination

- Run `WORKER-FULL-01` through `WORKER-FULL-04` in order because they remove one cross-package field.
- `WORKER-FULL-05` then `WORKER-FULL-06` complete worker admission. `WORKER-FULL-07` follows so prompt
  snapshots describe the final runtime.
- `WORKER-TRIPWIRE-01` follows `WORKER-FULL-05`. `WORKER-TRIPWIRE-02` runs only on a successful narrow
  trust proof and must not delay the required full-access behavior.
- `HELPER-CARD-01` can run in parallel with worker server slices. `HELPER-HISTORY-01` follows it, then
  `HELPER-HISTORY-02` owns route integration.
- `WORKER-FULL-VERIFY-01` runs last and owns final shared changelog, planning-state, and test-evidence
  reconciliation.
