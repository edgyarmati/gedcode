# TASKS — Orchestrator Delegation and Project Context

Status values: `NEXT`, `TODO`, `BLOCKED`, `DONE`, `DEFERRED`. Only one slice is active at a time.

## P0 — Commit, Verification, and Terminal Lifecycle

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-WORK-01 | DONE | Add durable task Change review and No changes needed states plus a verification record bound to task HEAD. Preserve append-only replay and strict schemas. | Contract, decider, projector, persistence, migration, and replay tests cover all new states and legacy decoding. |
| ORCH-WORK-02 | DONE | Detect dirty tracked/untracked files when a work turn settles; re-enter the PM exactly once and prevent verify startup until resolution. Require work-agent commits in stage instructions. | Integration tests cover dirty, clean committed, clean no-change, restart, duplicate settlement, and verification rejection. |
| ORCH-WORK-03 | DONE | Add scoped PM/MCP tools to inspect task status/diff and commit, discard, or return/steer remaining changes. Invalidate prior verification after every mutation. | Tool tests reject foreign paths/tasks, preserve selected hunks, record descriptive commits, and prove discard/return outcomes. |
| ORCH-WORK-04 | DONE | Bind successful verification to exact task HEAD and require a clean worktree plus matching verified HEAD before land approval/landing. | Decider and landing integration reject stale verification after commit/discard/rework and accept only current clean HEAD. |
| ORCH-WORK-05 | DONE | Settle accepted empty work as No changes needed, auto-archive it, and auto-archive successful landed tasks. Add an append-only reconciler for inert landed-without-PR records while preserving genuine PR failures. | Restart/replay tests repair only eligible legacy tasks; board/history tests hide success and retain retryable failures. |
| ORCH-WORK-06 | DONE | Surface Change review actions/status and No changes needed outcomes in PM/task UI, including safe diff preview and destructive confirmation. | Chromium covers commit, revise, discard, verify-after-resolution, no-change disappearance, and archived history. |

## P0 — PM Direct Work

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-PMDIRECT-01 | DONE | Give Codex PM sessions workspace-write/auto-review and retain provider-native Claude/OpenCode full access; forward unresolved escalations to the user. Remove prompt prohibitions on mutation. | Provider/runtime tests pin exact PM permission parameters and unchanged worker/manual approval routing. |
| ORCH-PMDIRECT-02 | DONE | Teach the PM to classify bounded low-risk work for direct checkout execution, review overlapping dirty hunks, run proportional checks, commit intended hunks, and record rationale/commit. | PM prompt/runtime tests distinguish trivial from task work and prove direct commits exclude unintended hunks while allowing overlap. |

## P1 — Capability Presets and Migration

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-TIER-01 | DONE | Replace backend-by-role configuration with Cheap/Smart/Genius preset schemas at global and project levels. Keep semantic roles/prompt prefixes and record tier plus resolved backend per attempt. | Contract and resolution tests cover inheritance, project overrides, immutable attempt history, and rejection of incomplete presets. |
| ORCH-TIER-02 | DONE | Persist a one-time manual preset-migration requirement for legacy global/project role selections and block every Orchestrator entry/API until complete. | Migration/state tests enumerate legacy selections, reject partial mappings, persist completion, and prove no bypass after restart. |
| ORCH-TIER-03 | DONE | Build the non-skippable Orchestrator migration wizard with harness/model/thinking pickers for all three presets and project overrides. | Chromium proves direct-route/deep-link blocking, validation, completion, restart persistence, and restored access. |
| ORCH-TIER-04 | DONE | Replace per-role backend settings with polished preset cards showing harness logo, model, and thinking; retain advanced role prompt prefixes separately. | Settings logic/Chromium cover global defaults, project inheritance/override/reset, logos, and option reconciliation. |
| ORCH-TIER-05 | DONE | Replace task backend selection with tier selection and implement PM routing: simple plans remain PM-owned; delegated plans default Genius; work/verify choose Cheap or Smart; escalation is explicit and diagnosed. | PM/MCP/runtime tests cover override, resolved backend, no automatic escalation on quota/permission/environment failure, and retry at a higher tier. |

## P1 — Nested Helper Runs

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-HELPER-01 | DONE | Add persisted read-only helper-run contracts/projections linked to a PM thread or task, with tier, resolved backend, status, bounded result, and restart-safe identity. | Contract, decider, SQL, replay, and retention tests cover lifecycle without task/stage/gate fields. |
| ORCH-HELPER-02 | DONE | Run helpers against project root or task worktree under read-only provider policy; feed bounded results to the requester/subsequent stage without creating a worktree or lifecycle stage. | Provider/runtime integration proves path selection, read-only enforcement, bounded context injection, quotas, interruption, and restart. |
| ORCH-HELPER-03 | DONE | Add PM/MCP helper tools and timeline UI; default to Cheap while allowing another preset. Keep helpers off the task board. | Tool and Chromium tests cover start/status/result, task/PM attachment, tier choice, and absence from gates/board/landing. |

## P1 — Project Context and Skill Workflow

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| GED-SKILL-01 | DONE | Replace project `grill-me` with integrated `grill-with-docs`; vendor `grilling` and `domain-modeling`, preserve upstream glossary/ADR rules, and update GED prompts/docs/state transitions. | Skill fixture tests and prompt snapshots prove one-question interviews, environment lookup, inline context capture, sparse ADRs, and transition to planning. |
| PROJECT-CTX-01 | DONE | Define canonical project-context files and a scanner for missing, whitespace-only, template-only, and substantive content. Persist per-project schema version, fingerprint, dismissal, and completion. | Filesystem/persistence tests cover every classification, material changes, schema upgrades, and `.gedcode/` exclusion. |
| PROJECT-CTX-02 | DONE | Add a shared project-context run using a selectable capability preset, primary checkout access, and durable Populate/Review lifecycle ending in pending diff review. | Runtime tests cover Smart factory default, resolved backend, file scope, restart, failure, and no task/stage/PR creation. |
| PROJECT-CTX-03 | DONE | Prompt state-aware onboarding from Chat and Orchestrator and add Cheap/Smart/Genius picker cards with harness logo/model/thinking. Persist the chosen tier globally. | Chromium covers new/missing/stub/existing files, cross-surface dedupe, dismissal, fingerprint re-prompt, and sticky tier selection. |
| PROJECT-CTX-04 | DONE | Add context-run diff review with Commit, Revise, and Discard; commit only after explicit review and record the resulting context fingerprint. | Integration/Chromium covers iterative revision, safe discard, commit metadata, overlapping checkout changes, and prompt completion. |
| PROJECT-CTX-05 | DONE | Keep a successfully dismissed or started project-context prompt closed when the post-action refetch races the server projection and returns the stale fingerprint. | Focused browser coverage leaves the server response stale after successful dismissal and proves the exact prompt closes while a new fingerprint can prompt again. |

## P2 — Worktree Access and Readable Branches

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-OPEN-01 | DONE | Add typed launch operations for configured editor, file manager reveal, terminal, and installed alternate editors. Validate project/worktree ownership and environment capability. | Server/RPC tests reject arbitrary paths, target owned roots, and return explicit unsupported/launcher failures. |
| ORCH-OPEN-02 | DONE | Add configured-editor primary button and adjacent launch menu to PM/project and worker headers, using project root or exact task worktree respectively. | Desktop/Chromium tests cover icons, target paths, menu actions, compact layout, and disabled remote capabilities. |
| ORCH-BRANCH-01 | DONE | Generate new task branches as `ged/<task-type>/<title-slug>` with sanitization, length bounds, deterministic numeric collisions, and no existing-branch migration. | Git/worktree tests cover Unicode/punctuation, empty titles, collisions, concurrent provisioning, replay, and protected-branch safety. |

## Deferred

| ID | Status | Slice |
| --- | --- | --- |
| ORCH-ORDER-01 | DEFERRED | Enforce a canonical stage order beyond exact-HEAD verification. Intentional stage skipping remains allowed. |
