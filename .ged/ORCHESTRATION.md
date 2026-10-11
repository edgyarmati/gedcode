# Orchestration Design

> How the Ged plan / implement / verify discipline is expressed on top of T3 Code's
> V2 orchestrator. Supersedes the v0 durable stage pipeline.

- Status: accepted, unimplemented
- Date: 2026-10-11
- Base: T3 Code `main` @ `9afde1c6d` (#17848)

## 1. What changed

The v0 Orchestrator owned a durable `plan → work → verify` state machine in its own
decider and projector. That machine is being dropped — not because the stages were
wrong, but because encoding them as server-enforced states was.

The stage machine enforced _sequence_. What we actually care about is _outcome_: that
nothing lands without an independent, unbiased verdict. Sequence enforcement made
trivial work expensive (a typo fix paid for a planning stage) and gave no additional
guarantee at the only point that matters.

The new model keeps the three activities, drops the state machine, and moves the
guarantee to the land boundary.

## 2. Mechanism inventory

What the V2 orchestrator provides, and what each fact implies for us. These are
load-bearing; re-verify after any large upstream merge.

| Mechanism            | Fact                                                                                                                                                                                                                                                                                                                                                                         | Implication                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Child context        | A delegated child receives only the task prompt plus the role prefix. Parent conversation history is **not** copied.                                                                                                                                                                                                                                                         | A verifier is structurally blind to the implementer's reasoning. Isolation is free.                                 |
| Review rounds        | Each round is a new `delegate_task`. `childThreadId` is backing storage, not a `t3_thread_send` target. There is no task-level follow-up API preserving a reviewer session.                                                                                                                                                                                                  | Upstream deliberately prevents arguing a reviewer into agreement across rounds. Anti-sycophancy by construction.    |
| Privilege ceiling    | `DispatchModeLimit` caps the broadest modes an MCP-sent command may touch, re-checked inside the thread's command lock so the target's user cannot raise them mid-flight. Runtime rank: `approval-required`(0) < `auto-accept-edits`(1) < `auto`(2) < `full-access`(3); interaction rank: `plan`(0) < `default`(1). Escalation is denied (`runtime_mode_escalation_denied`). | A verifier pinned to `approval-required` — the narrowest rank — provably cannot edit.                               |
| Target selection     | `target: { providerInstanceId?, driverKind?, model? }` per call.                                                                                                                                                                                                                                                                                                             | Per-role model and cross-vendor routing, with no code of ours.                                                      |
| Plan mode            | `interactionMode: "plan"` is server-enforced; proposed plans are first-class in `t3_thread_read`'s `messages` view.                                                                                                                                                                                                                                                          | Native plan artifact and native approval UI.                                                                        |
| Worktree inheritance | `makeSubagentChildThread` spreads `...parentThread`, overriding only id/title/lineage/provider/model.                                                                                                                                                                                                                                                                        | **All delegated children share the parent's checkout.** Isolation requires `t3_thread_launch`.                      |
| Workspace binding    | `t3_thread_launch` takes `workspaceStrategy: worktree \| existing_worktree \| root`, bound before the agent starts. Creating a worktree in the prompt does not rebind.                                                                                                                                                                                                       | The only way to get a private checkout — but it yields an _ordinary_ thread: no subagent lineage, no `task_status`. |
| Nesting              | `task_cancel` stops every task the child delegated; `hasPendingChildRuns` tracks nested work.                                                                                                                                                                                                                                                                                | An ordinary thread can itself delegate. Multi-level topology is supported.                                          |
| `role` param         | Implemented in `OrchestratorMcpService.ts:646` as a prompt prefix: `Act as the ${role} sub-agent for this task.`                                                                                                                                                                                                                                                             | **Vestigial.** Real role definition must come from the brief. Do not hang discipline on it.                         |

## 3. Topology

Three levels. The middle one exists to resolve the tension between worktree
isolation and the durable task lifecycle — we want both, and they live at
different levels.

```
PM thread                 project root checkout, no code edits
  │                       talks to the human, owns the backlog
  │  t3_thread_launch(workspaceStrategy: "worktree", baseRef)
  ▼
Task lead                 private checkout, one per unit of work
  │                       ordinary thread, so it has its own run + MCP credential
  │  delegate_task(...)
  ▼
Role children             share the lead's checkout
                          durable task records: task_status / wait / cancel
```

- **Leads run concurrently** without stepping on each other, because each owns a
  worktree.
- **Children are cheap and durable** within a lead, because they are real delegated
  tasks with result context transfers and parent projection UI.
- **Approval gates** sit at PM level (which work starts) and at land (what merges).
  Nothing in between is gated.

## 4. Stage discipline

The stages are what a lead _chooses to delegate_, not states anything enforces. A
typo fix delegates nothing. A refactor delegates a planner, two implementers in
sequence, and three verification rounds. The lead decides, guided by a playbook.

The obvious objection is that a lazy model skips verification. The answer is not to
re-add the state machine, but to gate the outcome:

> **Nothing merges without a verdict record in project memory keyed to the head SHA.**

That check runs as a git hook / PR gate — outside the model's control. A structural
guard, consistent with the rest of the Ged model.

This is strictly stronger than the v0 pipeline. v0 could be satisfied by passing
through a stage. The gate can only be satisfied by producing evidence.

## 5. Verification

### Rules

1. **The lead spawns the verifier, never the implementer.** An implementer-spawned
   verifier inherits the implementer's provider and model by default and is
   contextually its own creature.
2. **Never pass the implementer's summary.** `DelegateTaskResult.summary` is the
   implementer's self-assessment — precisely the artifact that transmits bias. The
   verifier's brief contains the **original acceptance criteria** and the **diff**.
   It forms its own view of what the code does.
3. **Cross-vendor by default.** Set `target.driverKind` so the verifier runs a
   different vendor than the implementer. Shared training priors and self-consistency
   pressure are the main sources of agreement bias; a different vendor removes both.
   Strongest available lever, costs one field.
4. **`runtimeMode: "approval-required"` on the verifier.** It reports; it cannot fix.
   Separating find from fix stops a verifier from quietly patching and then declaring
   success.
5. **Structured verdicts, never prose.** Prose invites "looks good overall."

### Verdict shape

Per acceptance criterion: `met | not_met | unverifiable`, each with evidence — a test
name, a `file:line`, or command output. `unverifiable` is a first-class outcome and
**must not count as a pass**; it means the criterion was not written to be checkable,
which is a planning defect worth surfacing.

### Rounds

A fresh `delegate_task` per round, carrying the original brief plus prior findings,
responses, and unresolved objections. Each round gets its own `taskId` and a distinct
`clientRequestId`, stable across retries of that round. This is upstream's documented
pattern and the one we want regardless.

### Breadth

Run dimensions in parallel — correctness, tests, security — as separate
`mode: "async"` delegations, then poll `task_status`. Nothing in the orchestrator
bounds fan-out or nesting depth, so the lead's own playbook must; see §8.

## 6. Model policy

The role → model mapping lives in **project memory**, read by the lead at startup.
Not hardcoded in prompts, so it versions, diffs, and improves like everything else.

| Role        | Model                                              | runtimeMode         | interactionMode |
| ----------- | -------------------------------------------------- | ------------------- | --------------- |
| Planner     | most capable available                             | `approval-required` | `plan`          |
| Implementer | cheap / fast                                       | `auto-accept-edits` | `default`       |
| Verifier    | capable, **different vendor than the implementer** | `approval-required` | `default`       |

The lead calls `orchestrator_capabilities` first: it returns registered provider
instances, advertised models, whether each can run a child task, and model-visible
reasons for unavailability.

**On unavailability:** a requested model must be advertised by the selected provider,
else `model_unavailable`. When the premium planner model is absent the lead **blocks
and asks the operator** — it does not silently downgrade. Consistent with the standing
rule against unapproved degraded paths, and a silent planner downgrade is exactly the
regression nobody notices.

## 7. Components to build

All additive. None modifies an upstream file — which is the condition for staying
mergeable against ~800 upstream commits a month.

| #   | Component                                                                         | Where                                  | Status                            |
| --- | --------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------- |
| 1   | **Role briefs** — the real role definitions, since `role` is only a prompt prefix | `.ged/roles/`                          | built                             |
| 2   | **Lead playbook** — the delegation policy, as a skill rather than server code     | `.agents/skills/ged-lead/`             | built                             |
| 3   | **Verdict records** — branch-keyed, with SHA provenance inside                    | `.ged/verdicts/`                       | built (format + gate enforcement) |
| 4   | **Land gate** — refuses to land without a current, passing, independent verdict   | `.ged/bin/land-gate.sh`                | built, tested                     |
| 5   | **Memory MCP toolkit** — serves the above to every provider                       | `apps/server/src/mcp/toolkits/memory/` | built, tested                     |
| 6   | **`ProjectMemory` service** — resolves, reads and writes the `.ged/` tree         | `apps/server/src/ged/`                 | built, tested                     |

All six are built. The toolkit exposes `ged_memory_list`, `ged_memory_read`, `ged_role_brief`,
`ged_verdict_write` and `ged_land_check`; `ged_land_check` runs component 4 rather than
reimplementing it, so the tool and the pre-push hook cannot give different answers.

One upstream file is modified: `apps/server/src/mcp/McpHttpServer.ts`, 10 lines, to import the
toolkit, provide `ProjectMemory.layer`, and add one entry to the layer merge. That exception is
recorded in [DECISIONS.md](./DECISIONS.md).

## 8. Failure modes to watch

- **Lead worktree drift.** The lead binds a worktree at launch; children inherit it.
  If a child creates another worktree in-prompt, the binding does not follow, and
  subsequent children will not see that work.
- **Wait blocking.** `mode: "wait"` blocks the lead's turn. A wait timeout does not
  cancel the child — it sets `waitTimedOut: true` and the lead must continue via
  `task_status`.
- **Verdict staleness.** A verdict keyed to a SHA is invalidated by any amend or
  rebase. The gate compares against the _current_ head rather than merely finding a record.
- **Slug drift.** `ProjectMemory.verdictSlug` and the slug rule in `land-gate.sh` must map a
  branch to the same filename. If they diverge, an agent writes a record the gate never looks for
  and the gate fails open. A test pins this; keep it pinned.
- **Forged verdicts.** The record is unsigned and self-asserted. The gate stops omission, not
  dishonesty — see [DECISIONS.md](./DECISIONS.md).
- **`role` drift.** If upstream gives `role` real semantics later, re-check that our
  briefs do not conflict with injected role text.
- **Unbounded fan-out.** The orchestrator imposes no delegation depth limit and no
  fan-out cap — `task_cancel` recursing through child tasks is the only nesting-aware
  machinery. A lead that delegates leads is financially unbounded. The playbook must
  cap both depth (leads do not spawn leads) and parallel dimensions per round, and the
  PM must own a per-task budget.

## 9. Open decisions

- ~~**Verdict scope**~~ — **resolved.** Branch-keyed record with `headSha` recorded inside.
  Per-SHA filenames churn on every amend and leave orphans, while a branch-keyed record still
  lets the gate detect staleness by comparing against the live head — which is the property that
  actually matters. Implemented in `.ged/verdicts/`.
- **Plan approval** — defaulting to land-gate-only, with `interactionMode: "plan"`
  approval opt-in per task. Making it mandatory re-introduces the rigidity being
  removed here.
