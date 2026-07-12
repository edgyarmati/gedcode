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
| ORCH-LAND-04 | NEXT | Add an idempotent PM/MCP/RPC/UI retry actuator for a landed task whose PR-opening attempts were exhausted. | Retry after failure opens or reuses one PR, clears the failure state, and preserves the worktree until success. |
| ORCH-WT-02 | TODO | Add durable worktree ownership/lease metadata and a grace period before orphan reaping. | A second runtime/database cannot reap an actively owned worktree. |

## Phase 1 - Task Control and Worker Defaults

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-TASK-01 | TODO | Define task archive, restore, and permanent-delete commands/events without erasing the append-only event log. | Contract and replay tests preserve history while excluding archived/deleted tasks from active queries. |
| ORCH-TASK-02 | TODO | Add PM/MCP/RPC/UI task archive/delete actions and rich task-card context menus. | Terminal tasks disappear from active board and can be restored where supported. |
| ORCH-TASK-03 | TODO | Add stable create-task idempotency keys tied to the originating PM request. | Repeated identical tool calls return one task and one worktree. |
| ORCH-TASK-04 | TODO | Add explicit supersedes/superseded-by relationships for intentional replacement tasks. | Replacement task links to prior task and board presents one active successor. |
| ORCH-ACCESS-01 | TODO | Change orchestration worker runtime default to full write access while preserving PM read-only enforcement. | New worker stages resolve to full access by default; PM remains read-only. |
| ORCH-ACCESS-02 | TODO | Remove global/project full-access opt-in settings and migrate persisted sparse config safely. | Settings UI has no opt-in; legacy config decodes without changing worker result. |
| ORCH-ACCESS-03 | TODO | Show effective runtime permissions in stage history/task detail. | Browser test displays the actual resolved worker mode. |

## Phase 2 - PM Efficiency and Control

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-POLL-01 | TODO | Instrument PM calls to `inspectStage` and establish a token/call-count baseline for an idle long-running worker. | Test/diagnostic records current poll count and prompt growth. |
| ORCH-POLL-02 | TODO | Make worker stage settlements, gate resolutions, quota changes, and interrupt outcomes the only automatic PM wake-ups. | Idle worker causes zero recurring PM turns; settlement wakes PM exactly once. |
| ORCH-POLL-03 | TODO | Keep `inspectStage` as an explicit on-demand action and add a cheap structured status digest for operator requests. | Status request returns bounded data without full thread transcript. |
| ORCH-PMTH-01 | TODO | Document and test PM thread reuse policy: one persistent PM thread per project; one thread per stage attempt; steering reuses the active attempt; retry creates a linked attempt. | Thread-count tests pin reuse and retry behavior. |
| ORCH-PMTH-02 | TODO | Add bounded task summaries and last-action cursors so PM re-entry does not repeatedly ingest full task/stage histories. | Re-entry prompt size remains bounded as stage history grows. |
| ORCH-BACKEND-01 | TODO | Extend project role defaults and `setTaskBackend` to carry validated reasoning effort, then apply Terra/high to medium work and Sol/high to difficult or cross-cutting work. | Ledger and stage-start tests prove both model and reasoning effort reach the provider; PM can inspect the effective selection. |
| ORCH-INT-01 | TODO | Add first-class `interruptStage` PM/MCP/RPC action with immediate requested acknowledgement and durable outcome. | Codex integration observes `turn/interrupt` before the original turn completes. |
| ORCH-INT-02 | TODO | Define steer semantics while a provider is busy: immediate provider steer when supported; otherwise explicit queue or interrupt-and-restart, never silent delay. | Provider-specific tests cover accepted, queued, rejected, and interrupted outcomes. |

## Phase 3 - Large Task Splitting

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-SPLIT-01 | TODO | Add parent task ID, child order, and aggregate progress to contracts/projection/persistence. | Replay reconstructs parent/children and deterministic order. |
| ORCH-SPLIT-02 | TODO | Add atomic `splitTask` PM tool that creates bounded children with acceptance criteria and dependencies. | Partial failure creates no orphan child set; retry is idempotent. |
| ORCH-SPLIT-03 | TODO | Teach PM policy to split work when scope exceeds one focused work stage; include the child structure in the normal plan so the existing plan gate covers it. | PM test produces bounded children and the plan gate covers their structure without a new gate type. |
| ORCH-SPLIT-04 | TODO | Group child tasks under their parent in the board with progress and next-unblocked child. | Browser test covers collapsed/expanded parent and ordered children. |

## Phase 4 - Chat and Orchestrator UX

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| CHAT-FORK-01 | TODO | Define server/RPC thread-fork semantics, including copied message boundary, checkpoint/worktree behavior, and provider resume cursor policy. | Contract/integration tests fork at a selected message without mutating source thread. |
| CHAT-FORK-02 | TODO | Add normal-chat Fork action to message/thread context menus and navigate to the fork. | Browser test creates and opens a fork. |
| ORCH-EMPTY-01 | TODO | In active task detail, hide the Plan section until a proposed plan exists; hide the gates section when there are no gates. | Browser test omits both empty-state cards and renders each section when content appears. |
| UI-DRAFT-01 | TODO | Persist composer drafts by environment + project/thread + surface (`chat` or `orchestrator`) outside component lifetime. | Draft survives Chat -> Orchestrator -> Chat and route changes. |
| UI-SIDEBAR-01 | TODO | Reuse Chat project sorting/manual-order infrastructure in the Orchestrator project sidebar. | Sort setting and drag reorder produce identical persisted order. |
| UI-SIDEBAR-02 | TODO | Add rich native project and task context menus, including open, copy, settings, archive/delete, cancel/interrupt, and land when valid. | Browser tests assert status-sensitive menu items and no native edit menu. |

## Phase 5 - Workflow Specialization

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| ORCH-TYPE-01 | TODO | Replace the single literal `feature` task-type config with a validated registry while preserving existing feature events. | Legacy `feature` config replays; unknown task type is rejected instead of silently using feature stages. |
| ORCH-REL-01 | TODO | Add a release task type/playbook with version decision, changelog, required gates, clean-main requirement, dispatch, and workflow monitoring. | Release task receives a non-null release playbook and cannot dispatch from an unlanded feature worktree. |
| ORCH-REL-02 | TODO | Add a guarded release-dispatch operation with idempotency and workflow URL/status capture. | Duplicate dispatch is prevented; UI/PM receives authoritative workflow state. |

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
