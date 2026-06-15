# Orchestrator Mode — Initial Design

> **Status:** Initial design (brainstorm + pressure-tested). Not yet an execution plan.
> **Date:** 2026-06-14.
> **Scope:** A new operating mode for GedCode in which a per-project **PM agent**
> chats with the user, classifies requests, and orchestrates the existing coding
> agents (Codex / Claude Code / OpenCode) through configurable, multi-stage work.
> **Method:** Decisions locked via a `/grill-me` interview; design then validated by
> a 10-agent workflow (4 deep-dives over the real codebase + pi packages, 5
> adversarial red-team passes, 1 synthesis). Corrections from that pass are folded in.

---

## 1. Vision

GedCode today is a direct, one-session-per-thread GUI over coding agents. **Orchestrator
mode** is a second "shell" on top of the _same_ engine: you open a project, talk to a
**PM agent**, and it does the project-management work — sorting what you want into
chores / fixes / features, then delegating the actual coding to worker agents (Codex,
Claude Code, OpenCode), getting plans written and reviewed, work done, and results
verified, surfacing approvals to you inline. The PM is the only thing you talk to; it
fans work out and reports back.

The key realization from the codebase audit: **most of "the work" already exists.** GedCode
is not Codex-only — there are three provider drivers (`CodexDriver`, `ClaudeDriver`,
`OpenCodeDriver` in `apps/server/src/provider/builtInDrivers.ts`), first-class Projects
(with `workspaceRoot`, `scripts`, `defaultModelSelection`, **and an existing
`roleModelSelections` field**), Threads / Sessions / Turns / Messages, worktree
provisioning, proposed-plans as a first-class entity, an event-sourced core (SQLite
append-only log → projections), and an Effect-RPC WebSocket. Orchestrator mode is
mostly **a PM brain wired above machinery we already have.**

---

## 2. Locked decisions

| #   | Decision          | Choice                                                                                                                                                                                                                                                                               |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Foundation**    | Build _on top_ of the existing engine; a UI **"Orchestrator mode"** switch. Reuse, don't duplicate.                                                                                                                                                                                  |
| 2   | **Control model** | **Fully LLM-driven.** The PM (pi-agent-core) decides each next step at runtime via tool calls. Reliability comes from guardrails + durability, not deterministic control flow.                                                                                                       |
| 3   | **PM state**      | One **persistent PM per project.** pi-agent-core's session is source of truth for the _conversation_; gedcode's event log records the _actions_.                                                                                                                                     |
| 4   | **Task model**    | A **Task** is a new event-sourced aggregate. It owns one worktree+branch, groups per-stage worker threads, carries a configurable type, links to the PM message that spawned it. Stage-threads share the worktree; each can use a different backend/model via `roleModelSelections`. |
| 5   | **Handoff**       | **Detached + event-driven.** The handoff tool dispatches a worker turn and returns a handle immediately; the PM is re-entered when the worker settles.                                                                                                                               |
| 6   | **Config**        | **Two layers:** HARD typed config (enforced by code/decider invariants) + SOFT natural-language playbooks (pi skills). Config binds the machine; playbooks advise the model; **config wins.**                                                                                        |
| 7   | **Autonomy**      | Configurable, safe defaults, **every gate individually flippable.** Default gates: confirm classification, approve plan before code, never auto-merge. Per-task-type + per-task override.                                                                                            |
| 8   | **UI**            | **Home → Project (PM chat + task board) → Task detail.** Reuse existing conversation + diff rendering.                                                                                                                                                                               |
| 9   | **First slice**   | Thin vertical slice: one project, PM chat on pi, classify → one detached Codex handoff in a task worktree → plan gate → plan/work/done, across all three surfaces, durable across restart.                                                                                           |
| 10  | **Isolation**     | **Phased:** software guardrails (clamped runtime mode, env-strip, push-block) now; OS sandbox + per-task clone in Phase 5.                                                                                                                                                           |

---

## 3. Package choice: `pi-agent-core` on `pi-ai`

Both `@earendil-works/pi-agent-core` (the `agent` package) and `@earendil-works/pi-ai`
(the `ai` package) are standalone, MIT-licensed, ESM, Node ≥22, TypeBox-based. **Use both,
layered:**

- **`pi-ai`** — provider-agnostic transport (Anthropic, OpenAI, Google, Bedrock, …),
  serializable multi-turn `Context`, tool calling, streaming, and cross-provider handoff.
  Powers the PM's model selection and lets the PM brain run on any model.
- **`pi-agent-core`** — the agent loop _on top of_ `pi-ai`: the `Agent`/`AgentHarness`,
  tool **execution**, a rich event stream for the UI, session persistence + compaction,
  and `SKILL.md` skills. This is the PM brain.

**Workers are NOT pi agents.** They stay as ordinary `OrchestrationThread`s on the
existing Codex/Claude/OpenCode drivers. pi is _only_ the PM's reasoning loop. "Delegate to
codex/claude/opencode" is implemented as **pi tools** whose `execute()` dispatches a
gedcode orchestration command.

> **Caveat that shaped the design.** pi is promise/event-based and internally mutates
> state; it is **not** Effect-native, and its "durable harness" cannot be relied on for
> _in-flight_ crash recovery. Two more sharp edges: `followUp` throws if the agent is idle,
> `prompt` throws if it is busy. The design quarantines pi behind one adapter and drives
> **all durability from gedcode's event log** (§8).

---

## 4. Architecture overview

```
                          ┌─────────────────────────── apps/web (React) ───────────────────────────┐
                          │  Orchestrator mode toggle → _orch route tree                            │
                          │  HOME (project grid)   PROJECT (PM chat + task board)   TASK DETAIL      │
                          └───────────────▲───────────────────────────▲─────────────────────────────┘
            orchestrator.subscribeProject │     orchestrator.sendMessage / resolveGate (Effect-RPC over WS)
            orchestrator.subscribeTask     │     │
┌──────────────────────────────────────────┼─────┼───────────────────────── apps/server (Node, Effect) ──┐
│                                           │     │                                                        │
│   ┌─────────────── PmRuntime (one per project) ───────────────┐                                         │
│   │  PiAgentAdapter  ── wraps one pi AgentHarness ──┐          │                                         │
│   │   (acquireRelease, Stream over subscribe(),     │          │   pi events → projected into            │
│   │    tryPromise around prompt/followUp)           │          │   thread.message.assistant.delta/...    │
│   │  PmReEntryQueue (single-writer, phase-aware) ◄──┘          │   on a role='pm' thread                 │
│   │   the ONLY caller of pi prompt()/followUp()                │                                         │
│   │  SqliteSessionStorage (pi session in gedcode DB)           │                                         │
│   │  pmTools: classify / createTask / handoffWorker / …        │                                         │
│   └───────────────────────────┬───────────────────────────────┘                                         │
│                               │ dispatch task.* commands (in-process Effect call, NOT over WS)           │
│                               ▼                                                                          │
│   ┌──────────── OrchestrationEngine (UNCHANGED single-writer core) ───────────┐                          │
│   │  command queue → decider (+ guards) → ONE sql.withTransaction:            │                          │
│   │    eventStore.append → in-memory projector → SQL ProjectionPipeline       │                          │
│   │    → command-receipt upsert  → publish to PubSub                          │                          │
│   └───────┬─────────────────────────────────────────────────────┬────────────┘                          │
│           │ task.stage.start ⇒ decideCommandSequence emits:      │ streamDomainEvents                    │
│           │  task.stage-started + thread.create + thread.meta.update + thread.turn.start                 │
│           ▼                                                       ▼                                       │
│   ProviderCommandReactor ── starts a worker session on ───►  Codex / Claude / OpenCode driver            │
│        (existing)            the EXISTING drivers, in the task worktree (shared across stages)            │
│                                                                                                          │
│   Durability layer: OrphanTurnReconciler (boot barrier) · ProjectionTasks/AwaitedStages/PendingGates ·   │
│                     pm_runtime_cursor + pm_consumed_settlements (exactly-once re-entry)                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Three additions, everything else reused:

1. **A `Task` aggregate** alongside the existing `project`/`thread` aggregates.
2. **A `PmRuntime` service** — one pi `AgentHarness` per project, behind a thin Effect
   adapter, plus the durable re-entry machinery.
3. **A UI mode toggle** routing the web app to a new `_orch` route tree.

The OrchestrationEngine core is **unchanged**: every write still serializes through one
command queue into one `sql.withTransaction` (append → in-memory project → SQL project →
receipt) then publishes to the PubSub. Task status (§5) is a **pure projection** of the
event log, so the PM's pi view and the kanban board cannot disagree by construction.

---

## 5. The Task aggregate & data model

Adding `'task'` to the closed `OrchestrationAggregateKind` literal and a `TaskId` brand to
the `aggregateId` union forces every exhaustive switch (~6–8 sites:
`commandToAggregateRef`, `toShellStreamEvent`, projector/pipeline default arms, …) to be
extended. This is **mechanically safe** — TS strict + the Effect LSP flag every site — so
it is worked typecheck-driven.

**`OrchestrationTask`** (`packages/contracts/src/orchestration.ts`):

```
id: TaskId · projectId · type: TaskTypeId · title · status: OrchestrationTaskStatus
branch · worktreePath · pmMessageId (NullOr) · stageThreadIds[] · currentStageThreadId (NullOr)
playbookVersion · createdAt · updatedAt
```

- **Status is derived, never written.** `OrchestrationTaskStatus` is a closed literal
  (`draft → classified → planning → plan-review → working → review → verifying → landed |
abandoned | blocked`). The projector derives it deterministically from events
  (`task.created → draft`, `task.classified → classified`, `task.stage-started(plan) →
planning`, `task.gate-requested(plan) → plan-review`, …). There is **no
  `task.status.set` command** — so the PM influences status only by emitting domain
  events through the same engine the projection reads.
- **One worktree per task, shared across stages.** `task.create` reuses the existing
  `createWorktree` / setup-script path pinned to the task branch. Reviewer/verifier
  stage-threads share it so they see the worker's uncommitted diff. `task.landed` /
  `task.abandoned` → `removeWorktree` + `git worktree prune`.
- **Stages are ordinary threads.** Each stage is an `OrchestrationThread` grouped under
  the task, routed to a backend/model via the existing project `roleModelSelections`
  keyed by stage role.

No event-store storage change is needed — the existing `append`/`readFromSequence` is
aggregate-agnostic.

---

## 6. Domain commands & events

All added to the existing command/event unions; each new command type forces a new
decider `case` (the default arm does `command satisfies never`).

| Command                            | Event                               | Notes                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `task.create`                      | `task.created`                      | Guards: project present, task absent, orchestrator enabled, under `maxParallelTasks` + max-worktrees. Dispatches worktree creation.                                                                                                                                                                    |
| `task.classify`                    | `task.classified`                   | Snapshots the selected **playbook version** onto the task for determinism.                                                                                                                                                                                                                             |
| `task.stage.start`                 | `task.stage-started`                | **The handoff.** Internal/PM-dispatchable. Via `decideCommandSequence`, atomically emits `task.stage-started` + `thread.create` + `thread.meta.update(branch/worktreePath)` + `thread.turn.start`. `runtimeMode` and `modelSelection` are derived from **config**, never from tool params. Guards: §7. |
| —                                  | `task.stage-completed`              | Emitted **exactly once** (commandId dedup) when a stage turn settles **and** its result is complete (final message + diff captured). Sole event-sourced re-entry trigger.                                                                                                                              |
| `task.gate.request`                | `task.gate-requested`               | PM requests a gate; **detached** — returns immediately, PM turn ends. Records the gate bound to a content hash of the exact artifact. If `mode=auto`, auto-resolves (except `land`).                                                                                                                   |
| `task.gate.resolve`                | `task.gate-resolved`                | **Human/client-origin ONLY** — the decider rejects PM-runtime origin. Requires `approvedHash === current artifact hash` and gate still open (no replay/forgery). Single-use.                                                                                                                           |
| `task.land`                        | `task.landed`                       | The **only** sanctioned land path → `GitWorkflowService.openPullRequest`. Requires an approved `land` gate (hard-pinned `require-approval`). **No auto-merge-to-main command exists.**                                                                                                                 |
| `task.abandon`                     | `task.abandoned`                    | Terminal; triggers worktree cleanup.                                                                                                                                                                                                                                                                   |
| `project.meta.update` _(existing)_ | `project.meta-updated` _(existing)_ | HARD orchestrator config rides this path (whole-object replacement). No PM tool maps to it, so the LLM **cannot relax its own guardrails.**                                                                                                                                                            |

---

## 7. Config, guardrails & autonomy

**Two layers. Config binds the machine; playbooks advise the model; config wins.**

### HARD config (typed, enforced)

`OrchestratorProjectConfig` (schema-only, in a new `contracts/src/orchestrator/config.ts`),
event-sourced on the project via the existing `project.meta.update` path; global defaults
nested on `ServerSettings` (`OrchestratorGlobalDefaults`). Resolution order (in a pure
`ConfigResolver`): **per-task override > task-type > project > ServerSettings > safe
constant.**

```
enabled · pmModelSelection
taskTypes: [{ id, stages[], gatePolicy, … }]          // configurable taxonomy
roleModelSelections (reuses existing project field)    // stage role → backend/model
gatePolicy: per gate ∈ {classify, plan, work, review, land} → auto | require-approval
resourceLimits: { maxParallelTasks, maxParallelWorkers, perTaskTokenBudget,
                  perTaskCostBudgetUsd, maxStageHandoffs, allowedCommands[],
                  allowFullAccessWorkers: false }      // human-only opt-in
```

**Every guardrail is a decider invariant** — because the engine is the only write path, a
hallucinated or prompt-injected PM physically cannot bypass it:

- `requireOrchestratorEnabled`
- `requireGateSatisfied` — binds approval to a **content hash** of the exact artifact + a
  human/client-origin actor; single-use; no replay.
- `requireStageRuntimeModeAllowed` — `runtimeMode` derived from config in the decider,
  default approval-required; **clamps orchestrator workers to at most `auto-accept-edits`**;
  `full-access` forbidden without an explicit human-set `allowFullAccessWorkers` flag.
  (Closes the confirmed `DEFAULT_RUNTIME_MODE='full-access'` hole, backed by a contracts
  invariant test.)
- `requireNoActiveStageForTask` — one active stage turn per shared worktree.
- `requireUnderParallelWorkerLimit` + a global `Effect.Semaphore` in front of
  `providerService.startSession` (the single host-capacity backstop the LLM cannot exceed;
  the per-project limit is the fast-reject first line).
- `requireUnderStageHandoffBudget` / `requireUnderTaskSpendBudget` — read from a new
  **monotonic `ProjectionTaskSpend`** that sums per-turn token **deltas** (never the
  resetting context-window gauge) → USD via a per-instance price table; **fail-closed** to
  a turn-count cap for backends without usage telemetry. Includes PM-brain usage as
  `role='pm'`.

### SOFT playbooks (advisory)

One `SKILL.md` per task-type (e.g. `.gedcode/orchestrator/playbooks/feature.md`),
**loaded only from a trusted committed ref (never the mutable worktree)** and
**version-snapshotted onto the Task at classification time.** Describes recommended
stages, when to review, definition of done. Reaches pi via `setResources({ skills })`.
When playbook and gate disagree, the gate (hard config) wins.

### Autonomy

Each gate is individually flippable to `auto` (with per-task override), except **`land`
is hard-pinned to `require-approval`** and tasks **never auto-merge to main** (output is a
branch / gated PR). Approvals surface **inline in the PM chat**, reusing the existing
pending-approval / pending-user-input activity rendering.

---

## 8. The detached handoff & durability discipline

This is where "fully LLM-driven" either survives the reliability requirements or fails.
The red-team drove several corrections that are now load-bearing.

### Handoff (the happy path)

1. PM calls the `handoffWorker` tool. Its `execute()` dispatches `task.stage.start`
   **in-process** (an Effect service call, _not_ over WebSocket) and **resolves
   immediately** once the dispatch is _accepted_ into the event log (sub-millisecond on the
   in-process queue) — returning a handle `{ stageThreadId, awaitedTurnId }`. The PM keeps
   chatting and can fan out parallel tasks.
2. `decideCommandSequence` atomically emits `task.stage-started` + the existing
   `thread.create` / `thread.meta.update` / `thread.turn.start` chain, pinned to the task
   worktree and the role's model. The existing `ProviderCommandReactor` starts the worker
   session on the existing driver. **The gedcode event is the commit point; pi's tool-result
   is derived from the returned `(sequence, threadId)`, never independent.**
3. When the worker turn settles, `task.stage-completed` is emitted **once** — gated on a
   **completeness predicate**: settled status **and** finalized assistant message **and**
   `turn-diff-completed` present, so the PM never reviews a half-captured diff.
4. Re-entry: a **single-writer, phase-aware, durable `PmReEntryQueue`** — the _only_ caller
   of pi `prompt()`/`followUp()` — wakes the PM. It calls `prompt()` when the harness is
   idle, **buffers otherwise (never `followUp` into idle)**, and **batches** multiple ready
   results into one re-entry. The worker's output is wrapped in a bounded, secret-scrubbed,
   **untrusted-content envelope** (`StageResultBuilder`) before it enters PM context.

### Gates are detached too

The `requestApproval` tool dispatches `task.gate.request` and **ends the PM turn** (PM goes
idle). Resolution arrives as a durable `task.gate-resolved` event consumed by the _same_
re-entry path — there is no in-tool human-await holding the PM busy across a restart.

### Durability (gedcode event log is the disaster-recovery source of truth)

- **Reconciliation-driven, not edge-driven.** `PmRuntime.start()` does
  _catch-up-then-live_: replay from `pm_runtime_cursor`, drain, **then** subscribe to the
  live PubSub. Before relying on live events, it reconciles settled-but-unconsumed stages
  and gates from durable projections (`ProjectionAwaitedStages`, `ProjectionPendingGates`) +
  a periodic sweep. **A worker that finishes during a restart window self-heals.**
- **Exactly-once re-entry.** A durable `(stageThreadId, awaitedTurnId)` / `gateId`
  consumed-marker (`pm_consumed_settlements`) is checked-and-inserted **in the same
  transaction** that advances the PM cursor, _before_ `prompt`. This replaces the
  in-memory `handledTurnStartKeys` cache (lost on restart) for the PM path.
- **Orphan-turn reconciler** (boot barrier, before reactors go live): finds stage-threads
  with `activeTurnId != null` whose provider session isn't live and dispatches a synthetic
  `thread.session.set { status:'interrupted', activeTurnId:null }` — manufacturing the
  settled signal a dead provider stream can no longer emit.
- **PM↔log reconciliation on boot:** diff live stage-threads against the rehydrated pi
  transcript's outstanding handoff tool-calls; inject synthetic tool-results for orphans
  (re-adopt) and phantoms (unblock as "lost"), and **repair dangling tool-calls** (assistant
  `tool_calls` with no `tool_result`) so pi doesn't reject the rehydrated context. Write an
  explicit reconciliation report into the PM's next prompt so the rehydrated brain is
  re-grounded.

### The pi integration boundary

pi is quarantined behind **one** thin Effect adapter — `PiAgentAdapter`
(`orchestration/pi/PiAgentAdapter.ts`); pi types never leak past it. It does four things:

1. **Lifecycle** — `Effect.acquireRelease` around `new AgentHarness(...)` (release =
   `abort()` + wait-for-idle); one harness per project in a `Map<ProjectId, harness>`.
2. **Events out** — `harness.subscribe()` → `Stream.asyncScoped`; each event is immediately
   projected into gedcode `OrchestrationEvent`s (assistant deltas → the existing
   `thread.message.assistant.delta/.complete` shape on a `role='pm'` thread; tool-call
   activity → `thread.activity.append`). Nothing downstream sees a pi object.
3. **Calls in** — `Effect.tryPromise` around `prompt`/`followUp`/`compact`/`abort`/
   `setResources`, mapping pi errors to tagged gedcode errors. The _only_ caller is
   `PmReEntryQueue`.
4. **Session truth** — a custom `SqliteSessionStorage` over `NodeSqliteClient`
   (`pm_session_entries`) faithfully porting pi's JSONL tree/leaf/parentId semantics, so the
   PM conversation lives in gedcode's DB but pi reduces its own log. The deterministic task
   ledger from `ProjectionTasks` is re-injected on **every** PM turn to re-ground after
   compaction/restart. Auto-compaction (not built into `AgentHarness`) runs as a queued
   idle-window op through the same `PmReEntryQueue`.

---

## 9. UI surfaces & streaming wiring

A persisted `orchestratorMode` flag (`uiStateStore`) + a Sidebar/CommandPalette toggle
routes the app to a new `_orch` TanStack route tree (`routeTree.gen.ts` regenerated). All
three surfaces **reuse existing rendering** — the PM chat and every stage-thread are just
`MessagesTimeline` + `DiffPanel`.

| Surface         | Route                       | Components                                                                                                                                                                                                                         | Data                            |
| --------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **HOME**        | `_orch.index`               | `ProjectGrid` / `ProjectGridCard` (reuse `ProjectFavicon`, `selectProjectsAcrossEnvironments`); card shows active-task count + pending-approval dot                                                                                | existing project list           |
| **PROJECT**     | `_orch.$env.$project`       | PM chat = `MessagesTimeline` + `ChatComposer` on the `role='pm'` thread; `TaskBoard`/`TaskCard` kanban by derived status                                                                                                           | `orchestrator.subscribeProject` |
| **TASK DETAIL** | `_orch.$env.$project.$task` | `StageTimeline` (planner→worker→reviewer→verifier) + per-stage `MessagesTimeline` + `ProposedPlanCard` + `DiffPanel` (`getFullThreadDiff` on the worker stage-thread) + inline gate panel carrying `taskId + gateId + contentHash` | `orchestrator.subscribeTask`    |

**Streaming:** PM tokens flow `pi event stream → PiAgentAdapter → projected into the
existing assistant-delta event shape → WS push → web`, so `MessagesTimeline` streams the PM
**with zero new render code.** The task board is fed purely by store selectors
(`selectTasksForProject`) reduced from `task.*` events. The existing thread-detail
subscribe/reconnect/ref-count harness is generalized into
`retainProjectSubscription` / `retainTaskSubscription`. Gate prompts round-trip via a new
`orchestrator.resolveGate` RPC (human-origin stamped).

New WS methods, following the existing `WsRpcGroup` shape:
`orchestrator.sendMessage`, `orchestrator.subscribeProject` (stream),
`orchestrator.subscribeTask` (stream), `orchestrator.resolveGate` — subscriptions yield the
same `{ kind: 'snapshot' | 'event' }` union as `subscribeThread`.

---

## 10. New components inventory

**contracts** — `TaskId`; `OrchestrationTask`/`Status`/`Type`;
`OrchestratorProjectConfig` + gate/limit schemas; `OrchestratorGlobalDefaults` (on
`ServerSettings`); `OrchestratorPlaybookFrontmatter`; the `task.*` command/event variants;
`ORCHESTRATOR_WS_METHODS` + `WsOrchestrator*Rpc`.

**server** — `PmRuntime` (service + `PmRuntimeLive` layer, mirrors `ProviderCommandReactor`,
wired into `ReactorLayerLive`); `PiAgentAdapter`; `PmReEntryQueue`; `SqliteSessionStorage`;
`pmTools` (`classifyRequest`, `createTask`, `handoffWorker`, `requestApproval`,
`inspectStage`, `getTaskLedger` — no guard logic in tools; the decider re-validates);
`ConfigResolver`; `guards.ts` (the decider invariants); `PlaybookLoader`;
`OrphanTurnReconciler`; worktree-reaper extension; `ProjectionTasks` /
`ProjectionAwaitedStages` / `ProjectionPendingGates` / `ProjectionTaskSpend` (+ repos +
migrations); `pm_runtime_cursor` + `pm_consumed_settlements` tables; worker-spawn admission
(global semaphore) + env allowlist + push-block bootstrap; `StageResultBuilder` +
secret-scrubber.

**shared** — pure `deepMerge` / budget helpers (`@t3tools/shared/orchestrator`) reused by
`ConfigResolver` and `ProjectionTaskSpend` (keeps logic out of contracts).

**web** — `orchestratorMode` state + `_orch` route tree; `ProjectGrid`/`ProjectGridCard`;
`ProjectWorkspace`/`TaskBoard`/`TaskCard`; `TaskDetailView`/`StageTimeline`/
`StageActivityPanel`; orchestrator subscription harness + `wsRpcClient` namespace; store
task reducer + selectors.

---

## 11. Thin vertical slice (Phase 1 sequence)

The first buildable slice: **one project, PM chat on pi, classify → one detached Codex
handoff in a task worktree → plan gate → plan/work/done, across all three surfaces, durable
across restart.** Defers multi-stage role routing, multi-backend, rich playbooks, board
polish.

1. **pi spike (gate).** Install `@earendil-works/pi-agent-core` + `pi-ai` in `apps/server`,
   **pinned to an exact version**; verify the real exports (`AgentHarness` construction,
   `SessionStorage` contract, `prompt`/`followUp` phase semantics, skill loading, pi-ai
   usage reporting) match the design's assumptions **before** any contract/service work.
2. **Contracts.** Add `TaskId`; extend the aggregate unions; add `OrchestrationTask`; add
   the slice command/event set (`task.create/created`, `task.classify/classified`,
   `task.stage.start/stage-started`, `task.stage-completed`, `task.gate.request/requested`,
   `task.gate.resolve/resolved`). Fix every exhaustive switch the closed-union change breaks
   (typecheck-driven).
3. **Contracts config.** Minimal `OrchestratorProjectConfig` (`enabled`, `pmModelSelection`,
   one task type `feature` with stages `[classify, plan, work]`, gate policy
   `{ plan: require-approval, land: require-approval }`, `maxParallelWorkers`) on the project
   - `OrchestratorGlobalDefaults` on `ServerSettings`.
4. **Persistence.** Migrations 033–037: `ProjectionTasks`; `ProjectionAwaitedStages` +
   `ProjectionPendingGates`; `pm_session_entries`; `pm_runtime_cursor` +
   `pm_consumed_settlements`; `orchestrator_config_json` column. Each transactional, DDL
   separate from any backfill.
5. **Projections.** `ProjectionTasks` projector (status derived purely from events) +
   awaited-stages/pending-gates projectors; extend in-memory `projector.ts` with `task.*`
   cases + a `tasks` array on `OrchestrationReadModel`.
6. **Decider.** Cases for each `task.*` command; `task.stage.start` uses
   `decideCommandSequence` to atomically emit the stage + thread chain, `runtimeMode`
   **pinned to auto-accept-edits**, model from `ConfigResolver`. Guards:
   `requireOrchestratorEnabled`, `requireNoActiveStageForTask`,
   `requireUnderParallelWorkerLimit`, `requireGateSatisfied(plan, contentHash, human-origin)`,
   `requireStageRuntimeModeAllowed`.
7. **Worktree + safety.** `task.create` reuses `createWorktree`/setup-script on the task
   branch; `task.landed/abandoned` → `removeWorktree`. Bootstrap installs a pre-push hook
   blocking protected refs + spawns the worker with an **allowlisted env (secrets
   stripped)**. Add the global `startSession` semaphore.
8. **PM runtime.** `SqliteSessionStorage`; `PiAgentAdapter` (acquireRelease harness, Stream
   over subscribe, tryPromise wrappers); the slice tool set; `PmReEntryQueue` (single-writer,
   phase-aware, prompt-when-idle); `PmRuntime` (one harness per project).
9. **Durability barrier.** `OrphanTurnReconciler` before reactors go live;
   `PmRuntime.start` = catch-up-then-live + reconciliation sweep + dangling-tool-call repair
   - pi-transcript↔`ProjectionTasks` reconcile. Wire `PmRuntimeLive` into `ReactorLayerLive`.
10. **PM message projection.** pi assistant deltas → existing
    `thread.message.assistant.delta/.complete` shape on a `role='pm'` thread (one-direction,
    durable projector); PM tool-call activity → `thread.activity.append`.
11. **WS.** Add `ORCHESTRATOR_WS_METHODS` + the four RPCs to `WsRpcGroup`; register handlers
    in `ws.ts` `makeWsRpcLayer`; `resolveGate` → dispatch `task.gate.resolve` (human-origin);
    `subscribeProject`/`subscribeTask` filter `streamDomainEvents` on `aggregateKind==='task'`.
12. **Web.** `orchestratorMode` toggle; `_orch` route tree (regenerate `routeTree.gen.ts`);
    `ProjectGrid` HOME; `ProjectWorkspace` (PM chat + minimal one-column-per-status board);
    `TaskDetailView` (single Codex stage, `ProposedPlanCard`, `DiffPanel`, plan-gate panel
    carrying `taskId + gateId + contentHash`).
13. **Web streaming.** Extend `wsRpcClient` with the orchestrator namespace; generalize the
    thread-detail retain harness; reduce `task.*` events in the store + selectors.
14. **End-to-end.** Enable mode → open project → chat the PM → it classifies → hands off ONE
    Codex worker in the task worktree (detached handle returned immediately) → plan gate
    surfaces inline → human approves → worker completes → durable `task.stage-completed` →
    `PmReEntryQueue` prompts the idle PM with a bounded `StageResult` → task done. All three
    surfaces reflect it live **and survive a server restart mid-handoff.**
15. **Gates (AGENTS.md).** Update `CHANGELOG.md` Unreleased + `docs/upstream-decisions.md`;
    `bun fmt` · `bun lint` · `bun typecheck` · `bun run test` green before "complete."

---

## 12. Phase plan

| Phase                                      | Goal                                                                                                                         | Headline deliverables                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — Thin vertical slice**                | One project, PM on pi, classify → one detached Codex handoff → plan gate → done, durable across restart, all three surfaces. | §11.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **2 — Durability & safety hardening**      | Make the slice production-robust under crash/restart/concurrency.                                                            | Reconciliation-driven re-entry fully driven by awaited-stages/pending-gates + sweep; durable `pm_consumed_settlements` everywhere on the PM path; completeness-predicate gating; bounded `StageResultBuilder` + untrusted-content envelope + secret scrubber; `requireStageRuntimeModeAllowed` + `allowFullAccessWorkers` opt-in + invariant test; `PRAGMA busy_timeout` + jittered retry; control-vs-bulk command lanes (or coalesced ingestion); worktree reaper + max-worktrees guard. |
| **3 — Multi-stage roles & multi-backend**  | Full pipeline (classify→plan→plan-review→work→review→verify) with per-stage backend/model.                                   | `roleModelSelections` per stage role wired through handoff; reviewer/verifier stage-threads sharing the worktree (single-active-turn enforced); review/verify gates; stage-timeline UI with role + backend pickers; `ProjectionTaskSpend` budgets + fail-closed turn-count cap; per-project + global rolling spend ceiling incl. PM-brain usage.                                                                                                                                          |
| **4 — Playbooks, autonomy & taxonomy**     | Soft playbooks + full hard-config editing + per-gate autonomy.                                                               | `PlaybookLoader` (SKILL.md per type from trusted ref, version-snapshot on task); configurable taxonomy + per-type stages/gate editor (human-only); every gate flippable to auto (land hard-pinned) with per-task override; auto-compaction wiring.                                                                                                                                                                                                                                        |
| **5 — Scale, sandboxing, landing, polish** | Many concurrent tasks/projects safely; production landing; full UX.                                                          | OS-level worker sandbox (seatbelt/landlock/container, per-task cpu/mem/disk/pid/time limits, read-only provider config dirs); per-task clone/bare mirror + scoped short-lived worker credentials; `task.land → openPullRequest` + forge branch protection; board drag/drop + parallel-task gate queue; snapshot pagination for busy subscriptions; cross-project concurrent-session ceiling tuning + orphan-process reconciliation.                                                       |

---

## 13. Top risks & mitigations

| Risk                                                                                                                                                                                                                  | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pi API unverified / pre-1.0 churn**; durable harness can't checkpoint in-flight, so a crash mid-PM-turn loses that turn.                                                                                            | Phase 1 step 1 is a hard **spike** to confirm the real API; pin exact version. Drive **all** durability from gedcode's event log; treat an interrupted PM turn as "mark interrupted, re-prompt with reconciled current state," not stream-resume. Only the conversation half goes through pi's `SessionStorage`.                                                                                                                                                             |
| **Re-entry double-fire / phase-coupling crash** (`followUp` throws when idle, `prompt` when busy; two near-simultaneous settlements + lost in-memory dedup across restart → fork the conversation / double-dispatch). | Single-writer, phase-aware, **durable** `PmReEntryQueue` is the only caller of prompt/followUp (prompt-when-idle, buffer otherwise). Batch ready results into one re-entry. Durable consumed-marker checked-and-inserted in the same txn that advances the cursor, before prompt. Reconciliation-driven wakes, never live-PubSub-only.                                                                                                                                       |
| **Prompt injection** from repo/worker content hijacks the fully-LLM-driven PM into escalating gates/runtime mode or exfiltrating secrets.                                                                             | Structural defense: every guardrail is a decider invariant reading only human/client-writable hard config; **no PM tool maps to `project.meta.update` or `task.gate.resolve`** (the PM can't relax its own gates or self-approve). Worker output → delimited untrusted-content envelope, stripped of tool-call-looking directives, secret-redacted, **never interpolated into the system prompt**. Playbooks loaded only from a trusted committed ref + version-snapshotted. |
| **Worker `DEFAULT_RUNTIME_MODE='full-access'`** (confirmed) voids every gate, can `git push` to main, read the server's full `process.env`, escape the worktree.                                                      | `requireStageRuntimeModeAllowed` derives runtime mode from config (default approval-required), clamps to ≤`auto-accept-edits`, forbids full-access without an explicit human-set flag (+ contracts invariant test). Allowlisted minimal env (strip `*_KEY`/`*_TOKEN`/`*_SECRET`). Pre-push hook + push-blocked remote; only land path is gated `task.land → openPullRequest`. Phase 5 adds OS sandbox + per-task clone + forge branch protection.                            |
| **Cost/budget structurally unenforceable** on existing primitives (only a resetting context-window gauge; no USD; PM brain itself untracked); a runaway/injected PM can loop handoffs unbounded.                      | New monotonic `ProjectionTaskSpend` sums per-turn token **deltas** → USD via per-instance price table; budget guards read only this; **fail-closed** to a turn-count cap when telemetry is absent. Cumulative decider invariants (`maxStageHandoffs`, `maxRetriesPerStage`, rolling rate). Per-project + global rolling spend ceilings incl. PM usage as `role='pm'`; near-ceiling degrades all new handoffs to require-approval.                                            |
| **Unbounded subprocess fan-out + single-queue head-of-line blocking** (no global session cap; one command queue serializes latency-sensitive control behind the token-ingestion firehose).                            | Global `Effect.makeSemaphore` in front of `providerService.startSession` (the single chokepoint), sized from `ServerSettings`; per-project `maxParallelWorkers` as fast-reject. Split control vs bulk command lanes (worker prefers control) and/or coalesce high-frequency deltas into batched txns; bound the bulk lane with shedding. Preserve the single-writer txn for correctness.                                                                                     |
| **State drift** (pi session vs event log diverge after a crash between dispatch and pi-persist → orphan/phantom workers; dangling tool-calls make pi reject rehydrated context; half-captured diff fed to PM).        | gedcode event is the commit point; pi tool-result derived from returned `(sequence, threadId)`. Boot reconciliation diffs live stage-threads vs pi outstanding tool-calls and injects synthetic results (orphan re-adopt / phantom unblock); pi-session **repair** appends "interrupted — not executed" results for dangling tool-calls. Wake gated on completeness predicate. Reconciliation report written into the PM's next prompt.                                      |
| **Closed-union change touches ~6–8 exhaustive switches**; worktree/disk growth unbounded (setup scripts copy `node_modules` per worktree).                                                                            | Closed-union change is compile-time-guarded (TS strict + Effect LSP flag every site) — mechanically safe though broad; work typecheck-driven. Tie worktree lifecycle to the Task (`task.landed/abandoned → removeWorktree + prune`); terminal-task reaper sweep + max-worktrees-per-project guard on `task.create`; gate setup-script forks under the same global semaphore.                                                                                                 |

---

## 14. Defaulted open questions

These were surfaced by the pressure-test and are **defaulted** in this design; flag any you
want reopened.

- **pi dependency:** spike-first + pin an exact pre-1.0 version (Phase 1 step 1). _Assumes
  you accept pinning a churning pre-1.0 dep._
- **PM conversation storage:** a dedicated `role='pm'` `OrchestrationThread` (maximizes reuse
  of `subscribeThread` + conversation rendering + message projection) rather than a bespoke
  pm-message event.
- **Cost telemetry:** fail-closed to a turn-count cap + a visible "budget unenforceable"
  banner for any backend that doesn't emit per-turn token usage; per-instance USD price table
  in config.
- **Landing UX (slice):** a task ends at a **branch with a diff** (no PR yet); the gated
  `task.land → openPullRequest` path lands in Phase 5.
- **Config event granularity:** HARD config rides the existing `project.meta.update →
project.meta-updated` path (zero new event types) rather than a dedicated config event —
  revisit later if audit granularity demands it.
- **Command-queue scaling:** keep the existing single queue for the slice; add control/bulk
  lanes in Phase 2 only when contention is measured.

---

## 15. References

- pi packages: `@earendil-works/pi-agent-core` (the `agent` package),
  `@earendil-works/pi-ai` (the `ai` package) — <https://github.com/earendil-works/pi>.
- Engine/contracts touch points: `packages/contracts/src/orchestration.ts`,
  `apps/server/src/orchestration/{decider.ts,projector.ts,Layers/*,Services/*}`,
  `apps/server/src/provider/{builtInDrivers.ts,ProviderDriver.ts}`,
  `apps/server/src/persistence/*`, `apps/server/src/ws.ts`.
- AGENTS.md priorities: performance first, reliability first, predictable under load/failure;
  reuse over duplication.
