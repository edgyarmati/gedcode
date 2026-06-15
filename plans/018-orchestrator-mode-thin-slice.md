# Plan 018: Orchestrator mode — thin vertical slice (PM agent on pi, one detached Codex handoff, plan gate, durable)

> **Executor instructions**: This is the executable master plan for the
> Orchestrator-mode thin slice designed in `plans/orchestrator-mode-design.md`
> (§11). It is **gated on plan 017** — do not start any work package below until
> `docs/decisions/2026-06-pi-agent-core-api.md` exists and its recommendation is
> **GO** or **GO-WITH-CHANGES** (if GO-WITH-CHANGES, apply its "Divergences &
> impact on plan 018" deltas to the affected work packages _before_ building
> them). The work packages are dependency-ordered; build them in order, run every
> **Verify** before moving on, and honor STOP conditions. Update this plan's row
> in `plans/README.md` and tick the tracking issue's slice checkboxes as packages
> land. This plan is large by design (a full vertical slice); each work package is
> independently verifiable and can be a separate commit.
>
> **Drift check (run first)**: `git diff --stat 1787e621..HEAD -- packages/contracts/src/orchestration.ts apps/server/src/orchestration/decider.ts apps/server/src/orchestration/projector.ts apps/server/src/persistence/Migrations`
> If any changed, re-confirm the "Current state" anchors below before editing; on
> a material mismatch (e.g. the aggregate-kind literal moved, a migration past 032
> landed), treat as a STOP condition and re-derive the affected package.

## Status

- **Priority**: P1 (the Orchestrator-mode feature; Phase 1 of a 5-phase roadmap)
- **Effort**: XL (multi-package vertical slice; build as ordered work packages)
- **Risk**: HIGH (new aggregate touching ~6–8 closed-union switch sites; first
  integration of a pre-1.0 external agent runtime; fully-LLM-driven control whose
  reliability rests on decider invariants + durability discipline)
- **Depends on**: **017 (hard gate)** — pi API verified + dependency pinned.
- **Blocks**: Phases 2–5 (durability hardening, multi-stage roles, playbooks,
  sandboxing) — all build on this slice's aggregate, runtime, and UI.
- **Category**: feature / direction
- **Planned at**: commit `1787e621`, 2026-06-14
- **Design**: `plans/orchestrator-mode-design.md` (locked decisions §2; slice §11;
  risks §13)
- **Issue**: [#32](https://github.com/edgyarmati/gedcode/issues/32) (Epic: Orchestrator mode)

## Why this matters

This is the first executable slice of Orchestrator mode (design doc §1, §11): a
per-project **PM agent** (a `pi-agent-core` loop) that chats with the user,
classifies a request, hands one unit of work off to a **Codex** worker in a task
worktree (detached), surfaces a **plan-approval gate** inline, and — once the
human approves and the worker completes — re-prompts the idle PM with the bounded
worker result, all **durable across a server restart mid-handoff**. It proves the
hard parts end-to-end on the smallest possible surface, while deferring
multi-stage roles, multi-backend routing, rich playbooks, and board polish to
later phases.

The design is **fully LLM-driven** (Decision 2): the PM decides each next step at
runtime. Reliability therefore cannot come from deterministic control flow — it
comes from two things this plan must implement faithfully:

1. **Hard decider invariants** the PM physically cannot bypass, because the
   event-sourced engine is the only write path (design §7). A hallucinated or
   prompt-injected PM still cannot relax a gate, self-approve, escalate runtime
   mode, or exceed worker limits.
2. **Durability driven by gedcode's event log**, not pi's in-memory state
   (design §8). pi owns only the _conversation_; every _action_ and every
   re-entry decision is reconstructed from durable projections.

If those two are weak, the slice is a liability, not a feature. Treat the guards
(WP-E) and durability barrier (WP-H) as the load-bearing packages.

## Hard prerequisite gate (017)

Before WP-A:

- [x] `docs/decisions/2026-06-pi-agent-core-api.md` exists.
- [x] Its recommendation is **GO** or **GO-WITH-CHANGES** → **GO (with changes)** (commit `43768f2b`).
- [x] If **GO-WITH-CHANGES**: every divergence is mapped to its work package(s)
      (see "017 deltas" below) and those packages updated to match the _real_ API.
- [x] `@earendil-works/pi-agent-core@0.79.3` + `@earendil-works/pi-ai@0.79.3` are
      pinned (exact) in `apps/server/package.json`.

If the recommendation is **STOP**, do not start this plan — report and await a
decision.

### 017 deltas (GO-with-changes — fold into the named WPs)

All confirmed against the real `.d.ts`; none is a STOP. From the decision doc's
"Divergences & impact on plan 018":

1. **No synchronous phase getter (A3 soft-diverges)** → **WP-G**: the
   `PiAgentAdapter` maintains its **own** idle/busy flag updated from the
   `subscribe()` stream (`turn_start`/`agent_start` → busy; `settled`/`agent_end`
   → idle), reconciled with `waitForIdle()`. `PmReEntryQueue` reads that
   adapter-owned flag — **not** a harness getter. Harness internal queues
   (`followUp`/`steer`/`nextTurn`, `QueueMode`) are the correctness backstop.
2. **Locked-down `ExecutionEnv`** → **WP-G** (+ guardrails in **WP-E/WP-F**): the
   PM brain gets a custom `DenyingExecutionEnv` whose `exec`/write/remove/temp
   methods fail-closed; it exposes only read-only metadata. Never hand the PM a
   `NodeExecutionEnv` (full FS+Shell). Reinforces "no PM tool maps to
   `project.meta.update`/`task.gate.resolve`".
3. **PM-brain credentials, separate from worker CLI auth** → **WP-B** (+ **WP-G**):
   the PM is a real `pi-ai` model call, so it needs `AgentHarnessOptions.model`
   (via `getModel(provider, modelId)`) and `getApiKeyAndHeaders`.
   `OrchestratorProjectConfig.pmModelSelection` (B1) already carries provider +
   modelId; WP-G resolves the PM API key (via `pi-ai` `getEnvApiKey(provider)` or
   explicit config) at adapter construction. **No PM key → orchestrator mode
   disabled for that project** (fail-closed; `requireOrchestratorEnabled` covers
   the surface).

Confirmations that **simplify** the build: compaction is built in
(`AgentHarness.compact()` + `shouldCompact`) — WP-G needs no hand-rolled
summarizer; `Usage` already includes a full cost breakdown — token _and_ dollar
accounting are feasible (turn-count cap stays the fail-closed default for the
slice); streaming events (`message_update`/`tool_execution_*`) feed WP-I directly.

## Current state (reused machinery — file:line evidence)

The slice builds **on top of** the existing engine (Decision 1). Confirmed anchors
at `1787e621`:

- **Aggregate-kind literal is closed**: `packages/contracts/src/orchestration.ts:813`
  — `OrchestrationAggregateKind = Schema.Literals(["project", "thread"])`. Adding
  `"task"` forces every exhaustive switch to be extended (design §5; ~6–8 sites —
  TS strict + Effect LSP flag each).
- **`roleModelSelections` already exists** on projects (`orchestration.ts:211,380`;
  projector `projector.ts:205,238`; migration `032_ProjectionProjectRoleModelSelections.ts`).
  Stage→backend/model routing reuses this field (slice uses a single role).
- **Latest migration is `032`** (`apps/server/src/persistence/Migrations/`), so the
  slice's new migrations are **033–037** (design §11 step 4).
- **Decider / projector / engine**: `apps/server/src/orchestration/decider.ts`,
  `projector.ts`, `Layers/OrchestrationEngine.ts`,
  `Layers/ProjectionPipeline.ts`, `Layers/ProviderCommandReactor.ts`. Reactors are
  composed in `Layers/OrchestrationReactor.ts` and wired in `server.ts`.
- **Worktree provisioning** exists: `createWorktree` in `apps/server/src/git/GitManager.ts`
  - `GitWorkflowService.ts`.
- **WS RPC group**: `WsRpcGroup` at `packages/contracts/src/rpc.ts:485`; existing
  `subscribeThread` method/schema at `orchestration.ts:32,1251` and `rpc.ts:451`.
  The four new orchestrator methods follow this exact shape.
- **CONFIRMED security hole** (design §13, risk row 4): `DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access"`
  at `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:87`, plus
  `?? "full-access"` fallbacks in `ProviderService.ts:386`,
  `ProviderSessionDirectory.ts:137`, `ProviderRuntimeIngestion.ts:1367,1617`.
  Worker stages MUST NOT inherit this default — WP-E clamps and WP-F strips the env.

## Commands you will need

| Purpose                  | Command                                           | Expected on success                                 |
| ------------------------ | ------------------------------------------------- | --------------------------------------------------- |
| Typecheck (gate)         | `bun typecheck`                                   | exit 0 (tsgo strict + Effect LSP)                   |
| Test (gate)              | `bun run test`                                    | all pass (**never** `bun test`)                     |
| Test (scoped, server)    | `cd apps/server && bunx vitest run <path>`        | scoped pass                                         |
| Test (scoped, contracts) | `cd packages/contracts && bunx vitest run <path>` | scoped pass                                         |
| Lint                     | `bun lint`                                        | exit 0 (oxlint + `t3code/no-inline-schema-compile`) |
| Format check             | `bun run fmt:check`                               | clean                                               |
| Format write             | `bun fmt`                                         | rewrites                                            |
| Build (gate)             | `bun run build`                                   | exit 0                                              |
| Regen routes (web)       | `cd apps/web && bun run <route-gen script>`       | `routeTree.gen.ts` updated                          |

> **Flaky-typecheck note** (memory): under turbo concurrency the patched tsgo can
> spuriously report `Cannot find module effect/X`. If `bun typecheck` fails only
> with such an error, re-run it standalone before treating it as real.

## Scope

**In scope** — the design §11 slice, decomposed into WP-A…WP-N below:

- contracts: `task` aggregate kind + `TaskId`, `OrchestrationTask`/status/type,
  the slice `task.*` command/event set, minimal `OrchestratorProjectConfig` +
  `OrchestratorGlobalDefaults`, the four `orchestrator.*` WS methods.
- persistence: migrations 033–037.
- server: projections (`ProjectionTasks` + awaited-stages + pending-gates), decider
  cases + the five slice guards, worktree+safety bootstrap, the PM runtime
  (`PiAgentAdapter`, `SqliteSessionStorage`, slice tool set, `PmReEntryQueue`,
  `PmRuntime`), the durability barrier (`OrphanTurnReconciler` + reconciliation
  on boot), the PM-message projection, and the WS handlers.
- web: `orchestratorMode` toggle, `_orch` route tree, HOME grid, project workspace
  (PM chat + minimal status board), task detail (single Codex stage + plan gate),
  the orchestrator subscription harness + store reducer/selectors.
- AGENTS.md gates: `CHANGELOG.md` Unreleased + `docs/upstream-decisions.md`.

**Out of scope** (explicitly deferred to Phases 2–5; do **not** build here):

- Multi-stage role routing (plan-review/review/verify stages), multi-backend per
  stage, reviewer/verifier sharing the worktree (Phase 3).
- `task.land → openPullRequest`, auto-merge, forge branch protection (Phase 5) —
  the slice ends at **a branch with a diff**, no PR.
- Rich playbooks / `PlaybookLoader` / configurable taxonomy editor (Phase 4).
- OS-level worker sandbox, per-task clone, scoped worker credentials (Phase 5).
- `ProjectionTaskSpend` USD budgets — the slice's budget mechanism is the
  **fail-closed turn-count cap** (`maxStageHandoffs`); full spend tracking is
  Phase 3. (Confirm 017 §A8 before relying on token usage at all.)
- Auto-compaction wiring beyond a stub at idle (Phase 4) — unless 017 §A7 shows
  compaction is trivially available.

## Git workflow

- Branch: `feat/orchestrator-mode` (already created; 017 lands its spike here).
- One commit per work package is encouraged (each is independently verifiable).
  Suggested final-commit subjects per package are noted in each WP.
- Do **NOT** push or open a PR unless instructed. (The tracking issue is the
  coordination surface until then.)
- Keep `packages/contracts` schema-only — **no runtime logic** (CLAUDE.md). Shared
  runtime helpers (deepMerge/budget) go to `@t3tools/shared/orchestrator`, not
  contracts.

## Dependency graph

```
017 (gate) ──▶ WP-A ──▶ WP-B ──▶ WP-C ──▶ WP-D ──┬─▶ WP-E ──▶ WP-F
                                                  │            │
                       WP-A,C ───────────────────┴─▶ WP-G ────┼─▶ WP-H ──▶ WP-I
                                                               │            │
                                                  WP-A,I ──────┴─▶ WP-J ──▶ WP-K ──▶ WP-L ──▶ WP-M ──▶ WP-N
```

- WP-A (contracts aggregate+domain) unblocks everything.
- WP-E (decider+guards) needs A+B+D. WP-G (PM runtime) needs A+C and the pi facts
  from 017. WP-H (durability) needs E+G. WP-J (WS) needs A+I. WP-K→L→M are web.
  WP-N is the AGENTS.md gate, last.

---

## WP-A — Contracts: `task` aggregate + slice domain commands/events

**Goal**: Add `"task"` to the closed aggregate union and the `TaskId` brand; add
`OrchestrationTask` + derived `OrchestrationTaskStatus` + `TaskTypeId`; add the
slice command/event variants. Then fix **every** exhaustive switch the closed-union
change breaks, typecheck-driven (design §5, §6).

**Files**: `packages/contracts/src/orchestration.ts` (+ any switch sites the
compiler flags across `packages/contracts` and `apps/server`).

**Domain set for the slice** (design §6, slice subset):
`task.create/created`, `task.classify/classified`, `task.stage.start/stage-started`,
`task.stage-completed` (no command — internal), `task.gate.request/gate-requested`,
`task.gate.resolve/gate-resolved`. (`task.land`/`task.abandon` may be stubbed as
events for status completeness, but the slice does not land PRs — see scope.)

### Step A1: Extend the aggregate union + `TaskId`

Add `"task"` to `OrchestrationAggregateKind` (`orchestration.ts:813`) and a
`TaskId` brand to the `aggregateId` union. Build and let the compiler enumerate the
break sites.

**Verify**: `bun typecheck` now FAILS, and the failures are exhaustiveness errors
at the expected switch sites (`commandToAggregateRef`, `toShellStreamEvent`,
projector/pipeline default arms, etc. — design §5 estimates ~6–8). Record the exact
list in the commit body.

### Step A2: Add the Task schema + derived status + type id

Add `OrchestrationTask` (fields per design §5: `id, projectId, type, title, status,
branch, worktreePath, pmMessageId, stageThreadIds[], currentStageThreadId,
playbookVersion, createdAt, updatedAt`), `OrchestrationTaskStatus` as a **closed
literal** (`draft → classified → planning → plan-review → working → review →
verifying → landed | abandoned | blocked`), and `TaskTypeId`. Schema-only — no
derivation logic in contracts (the projector derives status; WP-D).

**Verify**: `cd packages/contracts && bunx vitest run` passes; `bun lint` clean
(no `no-inline-schema-compile` violation).

### Step A3: Add the slice command/event variants

Add each command/event from the slice set to the existing command/event unions.
Each new command type must force a decider `case` (the default arm does
`command satisfies never`) — that break is expected and handled in WP-E.

**Verify**: `bun typecheck` failures are now only the _decider_ exhaustiveness gaps
(WP-E) + any projector gaps (WP-D) — i.e. contracts itself compiles; the remaining
errors are in `apps/server` switch arms you will fill in later packages.

### Step A4: Fix the non-decider/non-projector switch sites

Resolve every remaining exhaustiveness break that is **not** the decider (WP-E) or
the projector (WP-D) — e.g. `commandToAggregateRef`, `toShellStreamEvent`, any
ipc/rpc mapping. For sites that legitimately don't handle tasks yet, the arm must be
explicit (not a silent fallthrough).

**Verify**: the only remaining `bun typecheck` errors are in `decider.ts` and
`projector.ts` (deferred to WP-E/WP-D). Everything else is green.

**Done check**: aggregate union includes `"task"`; Task schema + status + domain
variants exist; all non-decider/non-projector switches handle `task`.
**Commit**: `feat(contracts): add task aggregate + slice domain commands/events`.

---

## WP-B — Contracts: minimal orchestrator config

**Goal**: The smallest typed config that lets the decider enforce the slice's
guardrails (design §7, slice subset §11 step 3).

**Files**: new `packages/contracts/src/orchestrator/config.ts`; extend
`ServerSettings` with `OrchestratorGlobalDefaults`.

### Step B1: `OrchestratorProjectConfig` (slice subset)

Fields: `enabled: boolean`, `pmModelSelection`, one task type `feature` with stages
`[classify, plan, work]`, `gatePolicy: { plan: 'require-approval', land: 'require-approval' }`,
`resourceLimits: { maxParallelWorkers, maxStageHandoffs, allowFullAccessWorkers: false }`.
Schema-only.

### Step B2: `OrchestratorGlobalDefaults` on `ServerSettings`

Nest global defaults so the resolution order (per-task > task-type > project >
ServerSettings > safe constant) has a floor. Config rides the existing
`project.meta.update → project.meta-updated` path (design §14) — **no new config
event type, and no PM tool maps to it** (so the LLM cannot relax its own
guardrails).

**Verify**: `cd packages/contracts && bunx vitest run` passes; `bun typecheck`
exit 0 for contracts; a schema round-trip test for `OrchestratorProjectConfig`
passes. **Add a contracts invariant test asserting `allowFullAccessWorkers`
defaults to `false`** (design §7; this is the structural anchor for the runtime-mode
clamp).
**Commit**: `feat(contracts): minimal orchestrator project config + global defaults`.

---

## WP-C — Persistence: migrations 033–037

**Goal**: The durable tables the slice needs (design §11 step 4). Each migration is
transactional; **DDL is separate from any backfill** (follow the existing
`NNN_*.ts` + paired `NNN_*.test.ts` convention, e.g. `024_Backfill*`).

**Files**: `apps/server/src/persistence/Migrations/033_*.ts` … `037_*.ts` (+ tests).

| #   | Migration                                            | Holds                                             |
| --- | ---------------------------------------------------- | ------------------------------------------------- |
| 033 | `ProjectionTasks`                                    | task rows (status derived, never written by hand) |
| 034 | `ProjectionAwaitedStages` + `ProjectionPendingGates` | reconciliation sources for re-entry               |
| 035 | `pm_session_entries`                                 | pi session tree/leaf/parentId (per 017 §A2)       |
| 036 | `pm_runtime_cursor` + `pm_consumed_settlements`      | exactly-once PM re-entry                          |
| 037 | `orchestrator_config_json` column                    | HARD config on the project projection             |

> The `pm_session_entries` shape (035) is **dictated by 017 §A2** — build it to the
> verified `SessionStorage` contract, not the design's assumption. If 017 marked A2
> as DIVERGES/UNKNOWN, STOP and resolve before writing 035.

**Verify**: `cd apps/server && bunx vitest run src/persistence` passes; each
migration applies cleanly on a fresh DB and is idempotent on re-run; `bun typecheck`
exit 0.
**Commit**: `feat(server): migrations 033-037 for orchestrator task + PM runtime tables`.

---

## WP-D — Projections (status derived purely from events)

**Goal**: `ProjectionTasks` projector deriving `OrchestrationTaskStatus`
**deterministically from events** (`task.created→draft`,
`task.classified→classified`, `task.stage-started(plan)→planning`,
`task.gate-requested(plan)→plan-review`, `task.stage-started(work)→working`, …),
plus awaited-stages and pending-gates projectors. Extend the in-memory `projector.ts`
with `task.*` cases and a `tasks` array on `OrchestrationReadModel`. **No
`task.status.set` exists** — status is a pure function of the log (design §5).

**Files**: `apps/server/src/orchestration/projector.ts` (+ `projector.test.ts`);
new `ProjectionTasks` / `ProjectionAwaitedStages` / `ProjectionPendingGates`
projectors under `Layers/` + repos; wire into `ProjectionPipeline.ts`.

### Step D1: in-memory projector cases

Add `task.*` arms to `projector.ts` (closing the WP-A exhaustiveness gap there) and
a `tasks` array to `OrchestrationReadModel`.

### Step D2: SQL projectors + repos

Add the three SQL projectors writing to the 033/034 tables, registered in
`ProjectionPipeline.ts`. Status is computed from the event being projected + current
row, never accepted from a command field.

**Verify**: `cd apps/server && bunx vitest run src/orchestration/projector.test.ts`
passes with a new case driving `created→classified→stage-started(plan)→gate-requested(plan)`
and asserting the derived status at each step; `bun typecheck` for projector is now
green (WP-A projector gap closed).
**Commit**: `feat(server): task projections with purely-derived status`.

---

## WP-E — Decider cases + the five slice guards (load-bearing)

**Goal**: A decider `case` per `task.*` command; `task.stage.start` uses
`decideCommandSequence` to **atomically** emit `task.stage-started` + the existing
`thread.create` + `thread.meta.update(branch/worktreePath)` + `thread.turn.start`
chain, with `runtimeMode` **pinned in the decider** (never from tool params) and the
model from `ConfigResolver`. Implement the five slice guards as decider invariants
(design §7, §11 step 6).

**Files**: `apps/server/src/orchestration/decider.ts`; new
`apps/server/src/orchestration/guards.ts`; `ConfigResolver` (server-side, reads the
037 config column); reuse `@t3tools/shared/orchestrator` for pure resolution/merge.

**The five guards** (each an invariant the engine enforces — the PM cannot bypass):

1. `requireOrchestratorEnabled`
2. `requireNoActiveStageForTask` — one active stage turn per shared worktree.
3. `requireUnderParallelWorkerLimit` — per-project fast-reject (host-wide semaphore
   is WP-F).
4. `requireGateSatisfied(plan, contentHash, human-origin)` — approval bound to a
   **content hash** of the exact plan artifact + a **human/client-origin** actor;
   single-use; no replay. The decider **rejects PM-runtime origin** on
   `task.gate.resolve`.
5. `requireStageRuntimeModeAllowed` — runtime mode derived from config, default
   approval-required, **clamped to ≤ `auto-accept-edits`**, `full-access` forbidden
   unless a human set `allowFullAccessWorkers`. This closes the
   `ProviderCommandReactor.ts:87` default-`full-access` hole for worker stages.

### Step E1: decider cases + atomic stage sequence

Add the `task.*` cases (closing the WP-A decider gap). Implement `task.stage.start`
via `decideCommandSequence`. The gedcode event is the commit point; the PM tool's
result is derived from the returned `(sequence, threadId)` — never independent
(design §8).

### Step E2: guards.ts + ConfigResolver

Implement the five guards as pure functions over (command, current projection,
resolved config). Wire them into the relevant decider cases.

**Verify**: `cd apps/server && bunx vitest run src/orchestration/decider*.test.ts`
passes, **including new adversarial cases**:

- a `task.gate.resolve` with PM-runtime origin is **rejected**;
- a `task.gate.resolve` with a stale/forged `approvedHash` is **rejected**;
- a `task.stage.start` requesting `full-access` with `allowFullAccessWorkers:false`
  is **clamped/rejected** (assert the emitted `runtimeMode` is ≤ `auto-accept-edits`);
- a second `task.stage.start` while one stage is active is **rejected**;
- exceeding `maxStageHandoffs` is **rejected** (fail-closed turn-count cap).
  `bun typecheck` exit 0 (decider exhaustiveness satisfied).
  **Commit**: `feat(server): task decider cases + orchestrator decider invariants`.

> **This is the package a reviewer must scrutinize hardest.** A weak guard here
> means a hallucinated/injected PM can escalate. Every guard needs a red-team test.

---

## WP-F — Worktree + worker safety bootstrap

**Goal**: `task.create` provisions one worktree on the task branch (reuse
`createWorktree` + setup script); `task.landed/abandoned` → `removeWorktree`.
Worker sessions spawn with an **allowlisted env (secrets stripped)** and a
**pre-push hook blocking protected refs**, behind a **global `startSession`
semaphore** (design §7, §11 step 7).

**Files**: decider `task.create` reactions + a worktree-cleanup reaction;
worker-spawn admission (global `Effect.makeSemaphore` in front of
`providerService.startSession`); env-allowlist + secret-scrubber helper; pre-push
hook bootstrap.

### Step F1: worktree lifecycle tied to the task

`task.create` reuses the existing worktree path pinned to the task branch;
terminal task events trigger `removeWorktree` + `git worktree prune`. Add a
`maxParallelTasks`/max-worktrees guard on `task.create`.

### Step F2: worker env strip + push block + semaphore

Strip `*_KEY` / `*_TOKEN` / `*_SECRET` from the worker's env (allowlist minimal
vars). Install a pre-push hook in the task worktree that blocks protected refs.
Put a host-wide semaphore (sized from `ServerSettings`) in front of
`startSession` — the single capacity backstop the LLM cannot exceed.

**Verify**: `cd apps/server && bunx vitest run` for the new env-strip + admission
tests passes (assert no `*_KEY/_TOKEN/_SECRET` reaches the worker env; assert the
semaphore caps concurrent `startSession`); a worktree is created on `task.create`
and removed on `task.abandoned`. `bun typecheck` exit 0.
**Commit**: `feat(server): task worktree lifecycle + worker env-strip/push-block/semaphore`.

---

## WP-G — PM runtime (pi adapter, session store, tools, re-entry queue)

**Goal**: One `pi-agent-core` `AgentHarness` per project behind a thin Effect
adapter; the slice tool set; the single-writer phase-aware `PmReEntryQueue` (design
§8, §11 step 8). **Build strictly against the verified API in
`docs/decisions/2026-06-pi-agent-core-api.md`** — if any of A1/A2/A3/A4/A5 is
UNKNOWN there, resolve it (a tiny runtime probe is acceptable here, unlike the spike)
before writing the dependent piece.

**Files**: new `apps/server/src/orchestration/pi/PiAgentAdapter.ts`,
`SqliteSessionStorage.ts`, `pmTools.ts`, `PmReEntryQueue.ts`, `PmRuntime.ts` (+
tests). pi types **never leak past `PiAgentAdapter`**.

### Step G1: `SqliteSessionStorage` over `pm_session_entries`

Port pi's tree/leaf/parentId semantics (per 017 §A2) onto `NodeSqliteClient`
(table from migration 035). PM conversation lives in gedcode's DB; pi reduces its
own log.

### Step G2: `PiAgentAdapter` (the only pi boundary)

`Effect.acquireRelease` around `new AgentHarness(...)` (release = `abort()` +
wait-for-idle); one harness per project in a `Map<ProjectId, harness>`;
`harness.subscribe()` → `Stream.asyncScoped`; `Effect.tryPromise` around
`prompt`/`followUp`/`compact`/`abort`/`setResources` mapping pi errors to tagged
gedcode errors.

### Step G3: slice tool set

`classifyRequest`, `createTask`, `handoffWorker`, `requestApproval`, `inspectStage`,
`getTaskLedger`. **No guard logic in tools** — each tool's `execute()` dispatches a
gedcode command **in-process** (Effect call, not over WS) and the **decider
re-validates** (WP-E). `handoffWorker` resolves immediately with
`{ stageThreadId, awaitedTurnId }` (detached — design §8); `requestApproval`
dispatches `task.gate.request` and **ends the PM turn**.

### Step G4: `PmReEntryQueue` + `PmRuntime`

`PmReEntryQueue` is the **only** caller of `prompt`/`followUp`: `prompt` when idle,
**buffer otherwise (never `followUp` into idle)**, batch ready results into one
re-entry. `PmRuntime` owns one harness per project. The worker output entering PM
context goes through a bounded, secret-scrubbed **untrusted-content envelope**
(`StageResultBuilder`) — never interpolated into the system prompt.

**Verify**: `cd apps/server && bunx vitest run src/orchestration/pi` passes —
construction (no networked LLM call), the session store round-trips a tree, the
re-entry queue prompts-when-idle and buffers-when-busy (assert it never calls
`followUp` into idle), and `handoffWorker` returns a handle without awaiting the
worker. `bun typecheck` + `bun lint` exit 0. **No paid/networked LLM calls in
tests** — mock the harness transport.
**Commit**: `feat(server): PM runtime — pi adapter, sqlite session store, tools, re-entry queue`.

---

## WP-H — Durability barrier + reactor wiring (load-bearing)

**Goal**: The slice survives a server restart mid-handoff (design §8, §11 step 9).
Reconciliation-driven re-entry, exactly-once markers, orphan-turn reconciler, and
PM↔log reconciliation on boot.

**Files**: new `OrphanTurnReconciler` (boot barrier); `PmRuntime.start`
(catch-up-then-live + reconciliation sweep + dangling-tool-call repair); wire
`PmRuntimeLive` into the reactor layer (`Layers/OrchestrationReactor.ts` / `server.ts`).

### Step H1: exactly-once re-entry

The durable `(stageThreadId, awaitedTurnId)` / `gateId` consumed-marker
(`pm_consumed_settlements`, migration 036) is checked-and-inserted **in the same
transaction** that advances `pm_runtime_cursor`, **before** `prompt`. This replaces
the in-memory dedup that a restart would lose.

### Step H2: orphan-turn reconciler (boot barrier)

Before reactors go live, find stage-threads with `activeTurnId != null` whose
provider session isn't live and dispatch a synthetic
`thread.session.set { status:'interrupted', activeTurnId:null }` — manufacturing the
settled signal a dead provider stream can no longer emit.

### Step H3: catch-up-then-live + PM↔log reconcile

`PmRuntime.start` replays from the cursor, drains, **then** subscribes to live
PubSub; reconciles settled-but-unconsumed stages/gates from
`ProjectionAwaitedStages`/`ProjectionPendingGates` + a periodic sweep; diffs live
stage-threads against the rehydrated pi transcript's outstanding handoff tool-calls
and **injects synthetic tool-results** for orphans (re-adopt) and phantoms (unblock
as "lost"), and **repairs dangling tool-calls** so pi doesn't reject the rehydrated
context. Writes a reconciliation report into the PM's next prompt.

**Verify**: a server-restart simulation test (`cd apps/server && bunx vitest run`)
where a worker settles **during the restart window** results in **exactly one** PM
re-entry after boot (assert the consumed-marker prevents a double-fire), and a
dangling tool-call in the rehydrated transcript is repaired (pi accepts the context).
`bun typecheck` exit 0.
**Commit**: `feat(server): orchestrator durability barrier — orphan reconcile + exactly-once re-entry`.

> **This package + WP-E are what make "fully LLM-driven" safe.** The restart test
> is the proof the design's durability story holds; do not mark the slice done
> without it (WP-M depends on it).

---

## WP-I — PM message projection (one-direction, durable)

**Goal**: pi assistant deltas → the **existing** `thread.message.assistant.delta/.complete`
shape on a `role='pm'` thread; PM tool-call activity → `thread.activity.append`
(design §8, §11 step 10). This is what lets the PM stream into `MessagesTimeline`
with zero new render code.

**Files**: a projector in `PiAgentAdapter`'s event path (events out) that maps pi
events → gedcode `OrchestrationEvent`s on the PM thread.

**Verify**: `cd apps/server && bunx vitest run` — a mocked pi assistant-delta
stream produces the existing assistant-delta/complete events on a `role='pm'`
thread, and tool-call events produce `thread.activity.append`. No pi object reaches
downstream. `bun typecheck` exit 0.
**Commit**: `feat(server): project PM pi events onto a role='pm' thread`.

---

## WP-J — WebSocket methods

**Goal**: Add `ORCHESTRATOR_WS_METHODS` + the four RPCs to `WsRpcGroup`, register
handlers, route them (design §9, §11 step 11). Follow the existing `subscribeThread`
shape exactly (`rpc.ts:485`, `orchestration.ts:1251`).

**Files**: `packages/contracts/src/orchestration.ts` (+ `rpc.ts`) for method
constants + schemas; `apps/server/src/ws.ts` (`makeWsRpcLayer`) for handlers.

Methods: `orchestrator.sendMessage`, `orchestrator.subscribeProject` (stream),
`orchestrator.subscribeTask` (stream), `orchestrator.resolveGate`. Subscriptions
yield the same `{ kind: 'snapshot' | 'event' }` union as `subscribeThread`, filtered
on `aggregateKind === 'task'` (or the PM thread for the project stream).
`resolveGate` dispatches `task.gate.resolve` **stamped human-origin** (the decider
rejects PM origin — WP-E).

**Verify**: `bun typecheck` exit 0 (contracts + server); `cd apps/server && bunx
vitest run` for a WS handler test: `resolveGate` dispatches a human-origin
`task.gate.resolve`; `subscribeTask` emits a snapshot then live events for a task.
`bun lint` clean.
**Commit**: `feat: orchestrator WebSocket methods (sendMessage/subscribe*/resolveGate)`.

---

## WP-K — Web: mode toggle, routes, and the three surfaces

**Goal**: `orchestratorMode` toggle routing to a new `_orch` route tree; HOME grid;
project workspace (PM chat + minimal status board); task detail (single Codex stage +
plan gate) — all **reusing existing rendering** (design §9, §11 step 12).

**Files**: `apps/web/src` — `orchestratorMode` UI state (`uiStateStore`) +
Sidebar/CommandPalette toggle; `_orch` route tree (regenerate `routeTree.gen.ts`);
`ProjectGrid`/`ProjectGridCard`; `ProjectWorkspace` (PM chat = `MessagesTimeline` +
`ChatComposer` on the `role='pm'` thread; minimal one-column-per-status board);
`TaskDetailView` (single Codex stage `MessagesTimeline` + `ProposedPlanCard` +
`DiffPanel` via `getFullThreadDiff` + inline gate panel carrying
`taskId + gateId + contentHash`).

**Verify**: `cd apps/web && bunx vitest run` for new component logic tests passes;
`bun typecheck` exit 0; the route tree regenerates cleanly (no manual edits to
`routeTree.gen.ts`); `bun run build` exit 0. Toggling the mode renders the `_orch`
tree; toggling off returns to the normal experience.
**Commit**: `feat(web): orchestrator mode toggle + home/project/task surfaces`.

---

## WP-L — Web: streaming wiring

**Goal**: Extend `wsRpcClient` with the orchestrator namespace; generalize the
thread-detail retain harness into `retainProjectSubscription`/`retainTaskSubscription`;
reduce `task.*` events in the store + add selectors (design §9, §11 step 13).

**Files**: `apps/web/src` — `wsRpcClient` orchestrator namespace; the generalized
subscription/reconnect/ref-count harness; store `task` reducer + selectors
(`selectTasksForProject`, etc.); gate round-trip via `orchestrator.resolveGate`
(human-origin stamped client-side).

**Verify**: `cd apps/web && bunx vitest run` for the store reducer/selector tests
(a `task.*` event sequence reduces to the expected board state; status matches the
server's derived status); PM tokens stream into `MessagesTimeline` via the projected
assistant-delta shape (no new render code). `bun typecheck` + `bun run build` exit 0.
**Commit**: `feat(web): orchestrator subscription harness + task store reducer/selectors`.

---

## WP-M — End-to-end + restart-durability proof

**Goal**: Prove the full slice path and its durability claim (design §11 step 14).
This is the acceptance test for the whole plan.

**Path**: enable mode → open project → chat the PM → it classifies → hands off **one**
Codex worker in the task worktree (detached handle returned immediately) → plan gate
surfaces inline → human approves (`resolveGate`, human-origin) → worker completes →
durable `task.stage-completed` (gated on the completeness predicate) →
`PmReEntryQueue` prompts the idle PM with a bounded `StageResult` → task reaches a
terminal slice state (branch + diff). All three surfaces reflect it live **and
survive a server restart mid-handoff**.

**Verify**: an integration test (server-side, mocked Codex worker + mocked pi
transport — **no paid/networked LLM calls**) drives the full path and asserts:

- the handoff tool resolved before the worker settled (detached);
- the plan gate could **not** be resolved with PM origin, only human origin;
- after a simulated restart with the worker settling in the gap, the PM is
  re-entered **exactly once** (reuses WP-H markers);
- final task status is the terminal slice state and the worktree holds the diff.
  Full gate: `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check`,
  `bun run build` all exit 0.
  **Commit**: `test(server): orchestrator slice end-to-end + restart-durability`.

---

## WP-N — AGENTS.md gates (last)

**Goal**: Satisfy the repo's task-completion requirements (AGENTS.md).

**Files**: `CHANGELOG.md` (Unreleased), `docs/upstream-decisions.md` (note this is
fork-original work, not upstream cherry-pick), `plans/README.md` (status rows for
017/018), and the tracking issue checkboxes.

**Verify**: `CHANGELOG.md` Unreleased documents Orchestrator-mode Phase 1;
`docs/upstream-decisions.md` updated; `plans/README.md` rows for 017/018 reflect
final status; the full gate (`bun fmt` · `bun lint` · `bun typecheck` ·
`bun run test`) is green.
**Commit**: `docs: changelog + upstream-decisions + plan index for orchestrator slice`.

---

## Test plan

- **Contracts** (WP-A/B): schema round-trips for `OrchestrationTask` and
  `OrchestratorProjectConfig`; the `allowFullAccessWorkers=false` default invariant
  test; exhaustiveness is enforced by `bun typecheck` (the closed-union change makes
  omissions compile errors).
- **Persistence** (WP-C): each migration applies on a fresh DB and is idempotent;
  DDL/backfill separated.
- **Projections** (WP-D): a representative event sequence derives the exact
  `OrchestrationTaskStatus` at each transition; status is never read from a command.
- **Decider/guards** (WP-E): the **adversarial** suite — PM-origin gate-resolve
  rejected; stale/forged hash rejected; `full-access` clamp; single-active-stage;
  `maxStageHandoffs` cap. These are the security acceptance tests.
- **PM runtime** (WP-G): construction without network; session-store tree
  round-trip; re-entry queue prompt-when-idle / buffer-when-busy (never `followUp`
  into idle); detached `handoffWorker`.
- **Durability** (WP-H): restart simulation → exactly-once re-entry; dangling
  tool-call repair; orphan-turn synthetic interrupt.
- **PM projection** (WP-I): pi deltas → existing assistant-delta/complete shape on a
  `role='pm'` thread.
- **WS** (WP-J): `resolveGate` human-origin dispatch; `subscribeTask` snapshot+live.
- **Web** (WP-K/L): route toggle; store reducer/selectors match server-derived
  status; PM streaming via reused timeline.
- **E2E** (WP-M): the full path + restart proof — the plan's acceptance gate.
- **No paid or networked LLM calls anywhere** in the test suite — mock the pi
  transport and the Codex worker.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] 017's decision doc recommends GO/GO-WITH-CHANGES and all its deltas are applied.
- [ ] `OrchestrationAggregateKind` includes `"task"`; `OrchestrationTask` +
      closed-literal `OrchestrationTaskStatus` + the slice `task.*` command/event
      variants exist (`grep -n '"task"' packages/contracts/src/orchestration.ts`).
- [ ] Minimal `OrchestratorProjectConfig` + `OrchestratorGlobalDefaults` exist with
      a passing `allowFullAccessWorkers=false` default invariant test.
- [ ] Migrations `033`–`037` exist, apply on a fresh DB, and are idempotent.
- [ ] Task status is **derived purely from events** (no `task.status.set` anywhere:
      `! grep -rn "task.status.set" packages apps`).
- [ ] The five decider guards exist with passing adversarial tests (PM-origin
      gate-resolve rejected; stale-hash rejected; `full-access` clamp; single active
      stage; handoff cap).
- [ ] No PM tool maps to `project.meta.update` or `task.gate.resolve`
      (`grep` the tool set) — the LLM cannot relax its own guardrails or self-approve.
- [ ] Worker spawn strips `*_KEY`/`*_TOKEN`/`*_SECRET`, installs a push-block hook,
      and is bounded by a global `startSession` semaphore (tests assert each).
- [ ] pi is reachable **only** through `PiAgentAdapter` (no pi import outside
      `apps/server/src/orchestration/pi/`: `grep -rln "@earendil-works/pi" apps/server/src | grep -v '/pi/'` is empty).
- [ ] The restart-durability test passes: a worker settling during a restart window
      yields **exactly one** PM re-entry.
- [ ] The E2E test (WP-M) passes end-to-end.
- [ ] All three web surfaces render under the `orchestratorMode` toggle; `routeTree.gen.ts`
      regenerated (not hand-edited).
- [ ] `CHANGELOG.md` Unreleased + `docs/upstream-decisions.md` updated;
      `plans/README.md` rows for 017/018 updated; tracking issue checkboxes ticked.
- [ ] `bun fmt`/`bun run fmt:check`, `bun lint`, `bun typecheck`, `bun run test`,
      `bun run build` all exit 0.

## STOP conditions

Stop and report back if:

- **017 says STOP**, or any A-row this plan depends on (A1 construction, A2 session
  storage, A3 phase semantics, A4 detached tool, A5 event stream, A8 usage) is
  DIVERGES-hard with no in-plan mitigation — the affected package's design must
  change first.
- The closed-union change (WP-A) breaks **far more** than the ~6–8 anticipated
  switch sites, or breaks a site where tasks genuinely shouldn't be handled but the
  arm can't be made explicit — report the surprising sites.
- A decider guard (WP-E) **cannot** be expressed as an invariant over
  human/client-writable config + projections (i.e. correctness would depend on
  trusting a PM tool param) — STOP; this breaks the structural security model.
- The runtime-mode clamp cannot prevent a worker stage from inheriting
  `full-access` (the `ProviderCommandReactor.ts:87` default leaks through a path the
  clamp doesn't cover) — STOP; this is the headline security risk (design §13 row 4).
- The restart-durability test (WP-H/WP-M) **double-fires** PM re-entry and the
  consumed-marker can't make it exactly-once — STOP; the durability core is unsound.
- Building any package would require **auto-merge-to-main** or an ungated land path —
  STOP; the slice ends at a branch + diff (no such command exists, by design §6).
- A migration would need to **mutate or delete** existing event-log data — STOP;
  the event store is append-only and aggregate-agnostic (design §5).

## Maintenance notes

- **pi is pre-1.0 and pinned.** On any pi bump, re-run plan 017's assumption table
  before upgrading; if a previously-CONFIRMED row regresses, fix 017's doc — don't
  silently work around it in 018's runtime.
- **The guards (WP-E) and durability barrier (WP-H) are the reliability contract.**
  Any later change to the decider, the re-entry queue, or the consumed-marker txn
  must preserve: single-writer prompt/followUp, exactly-once re-entry, and
  human-origin-only gate resolution. A reviewer should treat changes there as
  security-sensitive.
- **Status is a pure projection.** Never add a `task.status.set` command — the PM
  influences status only by emitting domain events the projection reads, so the pi
  view and the kanban board cannot disagree by construction (design §5).
- This slice is **Phase 1 of 5** (design §12). Deferred items (multi-stage roles,
  spend budgets, playbooks, OS sandbox, PR landing) have homes in later phases —
  resist pulling them forward into the slice.
