# TASKS - Orchestrator Completion Roadmap

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
| CHAT-FORK-01 | BLOCKED | Define server/RPC thread-fork semantics. Needs an explicit compatibility decision: resume provider-native state or start a fresh provider session from copied history. | Contract/integration tests fork at a selected message without mutating source thread. |
| CHAT-FORK-02 | BLOCKED | Add normal-chat Fork action to message/thread context menus after CHAT-FORK-01 semantics are decided. | Browser test creates and opens a fork. |
| ORCH-EMPTY-01 | DONE | In active task detail, hide the Plan section until a proposed plan exists; hide the gates section when there are no gates. | Chromium test omits both empty-state cards and renders each section when content appears. |
| UI-DRAFT-01 | NEXT | Persist composer drafts across surfaces. | Draft survives Chat -> Orchestrator -> Chat and route changes. |
| UI-SIDEBAR-01 | DEFERRED | Reuse Chat project sorting/manual-order infrastructure in the Orchestrator project sidebar. Deferred until after 2026-07-13. | Sort setting and drag reorder produce identical persisted order. |
| UI-SIDEBAR-02 | DEFERRED | Complete remaining rich project/task context-menu polish. Deferred until after 2026-07-13. | Browser tests assert status-sensitive menu items and no native edit menu. |
| UI-COLLAPSE-01 | DONE | Make the shared left sidebar collapsible from desktop content headers and restore its existing persisted open state. | Component/browser tests cover collapse, reopen, reload persistence, and unchanged mobile behavior. |

## Phase 5 - Workflow Specialization

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-TYPE-01 | DEFERRED | Replace the single literal `feature` task-type config with a validated registry. Deferred until after 2026-07-13. | Legacy `feature` config replays; unknown task type is rejected instead of silently using feature stages. |
| ORCH-REL-01 | DEFERRED | Add a release task type/playbook. Deferred until after 2026-07-13. | Release task receives a non-null release playbook and cannot dispatch from an unlanded feature worktree. |
| ORCH-REL-02 | DEFERRED | Add guarded release dispatch. Deferred until after 2026-07-13. | Duplicate dispatch is prevented; UI/PM receives authoritative workflow state. |

## Deferred

| ID | Status | Slice |
| --- | --- | --- |
| ORCH-ORDER-01 | DEFERRED | Enforce canonical pipeline order in the decider. User explicitly deferred this. |

## Already Present

- Detached stage workers and per-task worktrees.
- PM settlement re-entry and reconciliation markers.
- Plan and land approval gate records.
- Internal `task.land` command and PR-opening reactor.
- Basic stage steering and inspection tools.
- Basic Orchestrator project sidebar and task board.
