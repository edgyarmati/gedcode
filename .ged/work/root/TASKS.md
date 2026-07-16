# TASKS - Orchestrator Completion Roadmap

## Worker Auto-Review and PM Approval Control

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-APPROVAL-01 | DONE | Add an explicit provider approval-reviewer selection and start only Codex orchestration workers in workspace-write/on-request `auto_review`; retain full access for Claude/OpenCode workers and read-only/user-reviewed PM sessions. | Contract, Codex runtime, adapter, and provider-reactor tests pin the exact thread/turn parameters and provider-specific worker policy. |
| ORCH-APPROVAL-02 | DONE | Bridge Codex granular permission requests and denied auto-review notifications into the existing provider approval lifecycle; accepting a denied review calls `thread/approveGuardianDeniedAction` with the original event. | Runtime/adapter tests cover request details, accept/session/decline mapping, denied-review override, cleanup, and fail-closed stale requests. |
| ORCH-APPROVAL-03 | DONE | Add durable exactly-once PM re-entry for stage approval attention plus scoped PM/MCP tools to inspect and resolve a task's pending worker approvals. | PM runtime restart tests prove one wake-up; PM/MCP tests reject foreign/stale requests and forward valid decisions; prompt tests require least-privilege review. |

## Codex PM Trusted-Tool Permission Repair

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-PMBOOT-03 | DONE | Prevent Codex PM requests to the private `t3_orchestrator` MCP server from being rejected by the invisible approval gate while retaining the PM's read-only sandbox and approval controls for every other tool surface. | Focused config/adapter/runtime tests pin the trusted-server exception and unchanged global PM sandbox; the provider-log reproduction is resolved by Codex's server-scoped `default_tools_approval_mode`. |

## Startup Compatibility Repair

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-ROLES-03 | DONE | Add a one-time projection migration that removes obsolete `classify`/`review` role settings from projects and tasks without weakening current schemas or rewriting events; normalize those keys only when immutable historical events are decoded. | Migration tests reproduce the installed-app crash, preserve retained values, reject malformed JSON, and prove current projection decoding succeeds; contract tests prove replay compatibility without weakening current commands. |
| ORCH-ROLES-04 | DONE | Remove retired `classify`/`review` rows from the derived stage-history projection after desktop smoke testing reproduced a strict-decode startup crash missed by migration 54. Preserve tasks, threads, and the append-only event store. | Migration coverage retains all current stage roles, removes only retired rows, and a dev-desktop restart reaches backend-ready against the migrated development database. |

Status values: `NEXT`, `TODO`, `BLOCKED`, `DONE`, `DEFERRED`.

Only the first `NEXT` slice is active. Promote another slice only after the current slice is verified
or explicitly blocked.

## Phase 0 - Lifecycle Safety

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-LC-01 | DONE | Make active task cancellation safe: characterize the race, stop/interrupt the active provider session and close its terminals before dispatching abandonment, then allow existing terminal worktree cleanup. | Integration tests keep the task non-terminal while shutdown is pending, record cancellation failure without cleanup, and abandon only after successful shutdown. |
| ORCH-LC-02 | DONE | Add durable intermediate task/stage cancellation states and clear `currentStageThreadId` only after provider stop acknowledgement or a recorded failure. | Decider/projector/SQL/web replay tests cover requested, phase-completed, failed, retried, and terminal cancellation. |
| ORCH-LC-03 | DONE | Reconcile cancellation interrupted by server restart: skip durably completed phases, retry unfinished idempotent phases, and never recover a missing provider session just to interrupt it. | Persistence-backed A/B/C restart integration emits one abandonment; focused tests cover phase skipping, transient retry, terminal cleanup, and a second no-op reconciliation. |
| ORCH-LC-04 | DONE | Add restart reconciliation for interrupted/orphaned active stages and permit a clean retry. | Restart test leaves no stale active stage and a new handoff succeeds. |
| ORCH-LAND-01 | DONE | Add guarded `landTask` executor to PM tools and MCP using the existing `task.land` decider invariant. | PM/MCP tests dispatch `task.land` only after approved land gate. |
| ORCH-LAND-02 | DONE | Expose landing through RPC and task-detail UI; show pending, PR-opening, failed, and landed states. | Browser/integration test drives approve -> land -> PR URL. |
| ORCH-WT-01 | DONE | Close TaskWorktreeReactor startup subscription race using sequence-aware replay or periodic pending-land reconciliation. | Event emitted during startup is processed exactly once. |
| ORCH-LAND-03 | DONE | Add a first-class durable landing substate to the task aggregate/projections so PR-opening, exhausted failure, and completion survive task-only replay without depending on a stage-thread activity. | Restart/rebuild tests reconstruct opening, failed, and completed landing state even when no stage thread exists. |
| ORCH-LAND-04 | DONE | Add an idempotent PM/MCP/RPC/UI retry actuator for a landed task whose PR-opening attempts were exhausted. | Retry after failure opens or reuses one PR, clears the failure state, and preserves the worktree until success. |
| ORCH-LAND-05 | DONE | Enforce one narrow landing invariant: the latest successfully completed `verify` attempt must be newer than the latest successfully completed `work` attempt. Keep every other stage ordering permissive and add no legacy fallback. | Decider/actuator tests reject absent, failed, or stale verification and accept fresh verification with unrelated later non-work stages. |
| ORCH-WT-02 | DONE | Add durable worktree ownership/lease metadata and a grace period before orphan reaping. | A second runtime/database cannot reap an actively owned worktree. |

## Phase 1 - Task Control and Worker Defaults

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-TASK-01 | DONE | Define task archive, restore, and permanent-delete commands/events without erasing the append-only event log. | Contract and replay tests preserve history while excluding archived/deleted tasks from active queries. |
| ORCH-TASK-02 | DONE | Add PM/MCP/RPC/UI task archive/delete actions and rich task-card context menus. | Terminal tasks disappear from active board and can be restored where supported. |
| ORCH-TASK-03 | DONE | Add stable create-task idempotency keys tied to the originating PM request. | Repeated identical tool calls return one task and one worktree. |
| ORCH-TASK-04 | DONE | Add explicit supersedes/superseded-by relationships for intentional replacement tasks. | Replacement task links to prior task and board presents one active successor. |
| ORCH-ACCESS-01 | DONE | Change orchestration worker runtime default to full write access while preserving PM read-only enforcement. Coupled atomically with ACCESS-02 because the old opt-in clamp would otherwise undo the default. | New worker stages and provider sessions resolve to full access unconditionally; PM uses approval-required/read-only sandbox policy. |
| ORCH-ACCESS-02 | DONE | Remove global/project full-access opt-in settings and migrate persisted sparse config safely. Coupled atomically with ACCESS-01. | Settings UI has no opt-in; legacy config decodes but the key is inert and omitted on save. |
| ORCH-ACCESS-03 | DONE | Show effective runtime permissions in stage history/task detail. | Browser test displays the actual resolved worker mode. |

## Phase 2 - PM Efficiency and Control

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-PMBOOT-01 | DONE | Prevent PM startup deadlock by applying the provider's explicit read-only session policy and aligning the PM prompt with its actually available exploration tools. | Claude adapter/runtime tests prove PM sessions auto-allow read/search tools, deny mutating tools without opening approval requests, and still expose orchestration MCP tools. |
| ORCH-PMBOOT-02 | DONE | Expose Claude's read-only Skill loader to PM sessions and replace impossible native-subagent guidance with bounded orchestration worker handoffs. | Provider policy tests allow Skill while continuing to deny Task/Agent and mutation tools; prompt tests require worker handoff guidance. |
| ORCH-POLL-01 | DONE | Instrument PM calls to `inspectStage` and establish a token/call-count baseline for an idle long-running worker. | Characterization found no server timer; the PM prompt explicitly instructed repeated inspection, making each model decision an unbounded source of another call and prompt tail. |
| ORCH-POLL-02 | DONE | Make worker stage settlements, gate resolutions, quota changes, and interrupt outcomes the only automatic PM wake-ups. | PM prompt forbids polling and identifies the existing authoritative event-driven re-entry paths; runtime prompt tests pin the policy. |
| ORCH-POLL-03 | DONE | Keep `inspectStage` as an explicit on-demand action and add a cheap structured status digest for operator requests. | Existing focused tests prove status returns fixed message/activity tails, truncated text, elapsed turn state, and latest token usage without a full transcript. |
| ORCH-PMTH-01 | DONE | Document and test PM thread reuse policy: one persistent PM thread per project; one thread per stage attempt; steering reuses the active attempt; retry creates a linked attempt. | Thread-count tests pin reuse and retry behavior. |
| ORCH-PMTH-02 | DONE | Add bounded task summaries and last-action cursors so PM re-entry does not repeatedly ingest full task/stage histories. | Re-entry prompt size remains bounded as stage history grows. |
| ORCH-BACKEND-01 | DONE | Extend project role defaults and `setTaskBackend` to carry validated reasoning effort, then apply Terra/high to medium work and Sol/high to difficult or cross-cutting work. | Ledger and stage-start tests prove both model and reasoning effort reach the provider; PM can inspect the effective selection. |
| ORCH-INT-01 | DONE | Add first-class `interruptStage` PM/MCP/RPC action with immediate requested acknowledgement and durable outcome. | Shared actuator, provider reactor, ingestion, router, client, and browser tests cover immediate durable request plus provider-confirmed interrupted settlement without normal completion. |
| ORCH-INT-02 | DONE | Define steer semantics while a provider is busy: immediate provider steer when supported; otherwise explicit queue or rejection, never silent delay. | Codex uses `turn/steer`, OpenCode reports live steering, Claude reports active-turn queuing, and durable activity records started/steered/queued/rejected outcomes without fallback. |

## Phase 3 - Large Task Splitting

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-SPLIT-01 | DONE | Add parent task ID, child order, and aggregate progress to contracts/projection/persistence. | Replay reconstructs parent/children and deterministic order. |
| ORCH-SPLIT-02 | DONE | Add atomic `splitTask` PM tool that creates bounded children with acceptance criteria and dependencies. | Partial failure creates no orphan child set; retry is idempotent. |
| ORCH-SPLIT-03 | DONE | Teach PM policy to split work when scope exceeds one focused work stage. | PM test produces bounded children and the plan gate covers their structure without a new gate type. |
| ORCH-SPLIT-04 | DONE | Group child tasks under their parent in the board. | Browser test covers collapsed/expanded parent and ordered children. |

## Phase 4 - Chat and Orchestrator UX

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| CHAT-GED-01 | DONE | Add a persisted per-thread lightweight Normal/GED mode and inject GED workflow instructions plus available skill guidance into GED turns. Do not restore managed role dispatch, subagent settings, or the deleted workflow package. | Contract/server tests prove the mode reaches provider turns, changes only prompt guidance, and invokes no managed child-session actuator. |
| CHAT-GED-02 | DONE | Restore the Normal/GED composer selector and draft/new-thread plumbing for normal chat using the lightweight mode contract. Add a global default-for-new-threads setting (GED on by default) and an explanatory selector tooltip. | Logic and Chromium tests cover the global default, tooltip, selection, persistence, send/new-thread propagation, and unchanged Normal prompts. |
| CHAT-FORK-01 | DONE | Add the typed server/RPC fork operation. Codex uses native `thread/fork`, then rolls back only the fork when an earlier completed turn is selected; unsupported providers or boundaries use copied visible history in a fresh session. Retain current filesystem state and never mutate the source. | Contract/provider/integration tests cover latest and earlier Codex turns, copied-history fallback, source immutability, and explicit filesystem semantics. |
| CHAT-FORK-02 | DONE | Add **Continue in new task** only to completed assistant-message actions, call the typed fork operation, and navigate to the new task. | Browser test verifies visibility boundaries, pending/error states, successful creation/navigation, and unchanged source history. |
| CHAT-QUEUE-01 | DONE | Add a persisted per-thread FIFO queue model with captured message payload, backend/options, GED/runtime context, stable command/message IDs, queueing preference, and edit/delete/reorder-safe operations. Existing persisted drafts decode with an empty queue and queueing enabled. | Store/schema tests cover hydration, scoped isolation, FIFO order, editing without identity changes, deletion, attachment round-trip, and queue preference. |
| CHAT-QUEUE-02 | DONE | Route sends during active turns into the queue; after settlement dispatch exactly one head item and remove it only after command acknowledgement. Retry an interrupted dispatch with the same command ID. When queueing is off, send through the existing provider steer path. | Logic/integration tests cover active/idle races, reconnect retry, no duplicate starts, FIFO draining one turn at a time, and direct steer delivery. |
| CHAT-QUEUE-03 | DONE | Render queued messages above the normal composer with **Steer**, **Delete**, inline **Edit message**, and **Turn off queueing** menu actions on desktop and compact layouts. Keep existing queued items when queueing is disabled. | Chromium tests reproduce queue, steer, edit, delete, menu, failure recovery, compact layout, and accessibility behavior. |
| CHAT-DRAFT-01 | DONE | Preserve the active per-project normal-chat draft when switching to Orchestrator and back; prefer it from both the global Chat toggle and project **Open in Chat** action. | Route logic tests pin draft precedence and a desktop smoke test confirms the typed composer value is restored. |
| ORCH-EMPTY-01 | DONE | In active task detail, hide the Plan section until a proposed plan exists; hide the gates section when there are no gates. | Chromium test omits both empty-state cards and renders each section when content appears. |
| UI-DRAFT-01 | DONE | Persist composer drafts across surfaces. | Draft survives Chat -> Orchestrator -> Chat and route changes. |
| UI-SIDEBAR-01 | DONE | Reuse Chat project sorting/manual-order infrastructure in the Orchestrator project sidebar. | Sort setting and drag reorder produce identical persisted order. |
| UI-SIDEBAR-02 | DONE | Complete remaining rich project/task context-menu polish. | Browser tests assert status-sensitive menu items and no native edit menu. |
| UI-COLLAPSE-01 | DONE | Make the shared left sidebar collapsible from desktop content headers and restore its existing persisted open state. | Component/browser tests cover collapse, reopen, reload persistence, and unchanged mobile behavior. |
| DOC-ARTIFACTS-01 | DONE | Audit and document `.ged/`, workspace `.gedcode/`, and user `~/.gedcode/` artifacts: creator, trigger, contents, lifetime, cleanup owner, commit/delete guidance, and relevant security/privacy notes. Link the guide from the GED settings/help surface. | Path/source audit is complete; documentation links resolve; focused UI test covers the help link; changelog records the guide. |
| ORCH-ROLES-01 | DONE | Produce and apply a worker-role responsibility decision after auditing PM-owned operations and each current classify/plan/review/work/verify handoff. Remove redundant roles without compatibility aliases because the app has no existing user task ledger to migrate. | Decision doc maps every PM and worker responsibility; registry/playbooks/tools/config tests prove only retained roles remain and every required operation still has one owner. |
| ORCH-ROLES-02 | DONE | Extend the shared per-role backend picker at project and task scope to expose provider instance (harness), model, and supported thinking/reasoning level while preserving valid model options across changes. | Logic and Chromium tests cover inheritance, custom instances, model-dependent effort choices, stale-option cleanup, persistence, effective selection, and task overrides. |

## Phase 5 - Workflow Specialization

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-TYPE-01 | DONE | Replace the single literal `feature` task-type config with a validated registry. | Legacy `feature` config replays; unknown task type is rejected instead of silently using feature stages. |
| ORCH-REL-01 | DONE | Add a release task type/playbook. | Release task receives a non-null release playbook and cannot dispatch from an unlanded feature worktree. |
| ORCH-REL-02 | DONE | Add guarded release dispatch. | Duplicate dispatch is prevented; UI/PM receives authoritative workflow state. |

## Deferred

| ID | Status | Slice |
| --- | --- | --- |
| ORCH-ORDER-01 | DEFERRED | Enforce canonical pipeline order in the decider. User explicitly kept this fully deferred; only fresh verification before landing is enforced by ORCH-LAND-05. |

## Phase 6 - Normal-Chat Backend Defaults

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| CHAT-DEFAULT-01 | DONE | Make GPT-5.6 Sol/medium/Standard the no-preference Codex default and preserve the user's latest explicit provider, model, reasoning, and service-tier selection for new chats. | Contract/provider/store and Chromium tests cover factory values, sticky option retention, Claude-native fallback, and new-draft inheritance. |

## Already Present

- Detached stage workers and per-task worktrees.
- PM settlement re-entry and reconciliation markers.
- Plan and land approval gate records.
- Internal `task.land` command and PR-opening reactor.
- Basic stage steering and inspection tools.
- Basic Orchestrator project sidebar and task board.
