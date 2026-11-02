# Orchestration Design

> How the Ged plan / implement / verify discipline is expressed on top of T3 Code's
> V2 orchestrator. Supersedes the v0.4 durable stage pipeline.

- Status: implemented
- Date: 2026-10-11
- Base: T3 Code `main` @ `30084f0018c5751a07291222e8d04e16d513700a` (2026-11-02)

## 1. What changed

The v0.4 Orchestrator owned a durable `plan → work → verify` state machine in its own
decider and projector. That machine is being dropped — not because the stages were
wrong, but because encoding them as server-enforced states was.

The stage machine enforced _sequence_. What we actually care about is _outcome_: that
independent review is required by default, with only explicit local user opt-outs. Sequence enforcement made
trivial work expensive (a typo fix paid for a planning stage) and gave no additional
guarantee at the only point that matters.

The new model keeps the three activities, drops the state machine, and moves the
guarantee to the land boundary.

## 2. Mechanism inventory

What the V2 orchestrator provides, and what each fact implies for us. These are
load-bearing; re-verify after any large upstream merge.

| Mechanism          | Constraint for Ged                                                                                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Child context      | Delegated children receive the supplied task and role prefix without the parent conversation. Pass original criteria to each reviewer; omit implementer summaries.                                   |
| Review rounds      | Each round is a new `delegate_task` with a distinct retry-stable `clientRequestId`. `childThreadId` is backing storage, never the target for another review round.                                   |
| Privilege ceiling  | Children inherit runtime and interaction modes; broader modes are denied. Verifiers inherit access and are instructed to report, not fix.                                                            |
| Workspaces         | Delegation defaults to the parent checkout. `isolation:"worktree"` prepares a separate checkout from the parent commit and excludes uncommitted changes. Do not create a checkout in a child prompt. |
| Other environments | Peer-linked targets accept environment/project IDs and enforce remote permissions. Local worktree isolation is not supported for remote delegation.                                                  |
| Completion         | Follow a running delegate's returned `next`; completion wakes its parent. A wait timeout does not cancel it. Cancel replaced or unwanted tasks with `task_cancel`.                                   |
| Instructions       | Codex receives numbered sections, each below 4,000 UTF-8 bytes. Ged's complete memory/review policy must be its own section, as well as reaching other provider channels.                            |

## 3. Topology

A lead owns a unit of work and chooses shared or isolated delegated work. Shared children need
explicit, disjoint file ownership. An isolated child has the task lifecycle and a private checkout;
its changes still need integration and independent review before landing. Use a separate top-level
thread only when the user asks for one, selecting `workspaceStrategy` in `t3_thread_launch`.

## 4. Stage discipline

The stages are what a lead _chooses to delegate_, not states anything enforces. A
typo fix delegates nothing. A refactor delegates a planner, two implementers in
sequence, and three verification rounds. The lead decides, guided by a playbook.

The obvious objection is that a lazy model skips verification. The answer is not to
re-add the state machine, but to gate the outcome:

> **Review-required changes need a passing verdict keyed to the head SHA. An explicit user
> opt-out waives independent review, never the normal checks.**

That check runs as a git hook / PR gate — outside the model's control. A structural
guard, consistent with the rest of the Ged model.

This is strictly stronger than the v0.4 pipeline. v0.4 could be satisfied by passing
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
3. **Cross-vendor preferred, not required.** Choose a capable usable foreign reviewer from
   `orchestrator_capabilities` and available catalogs/known usage. Unknown quota telemetry does not
   establish exhaustion. If no alternative can run, or a provider attempt fails for availability,
   authentication, subscription or quota, automatically delegate a strong same-provider reviewer
   in a fresh context. Announce the reason and pass it for `ged_verdict_write.selectionReason`;
   do not repeatedly retry an exhausted provider or ask the user to buy/enable another subscription
   or disable a provider. The server-derived `otherVendorAvailable` remains truthful and
   informational: installed does not mean usable. The gate accepts same-provider review with a
   warning even when another vendor is installed. Important changes (auth/security, data/migrations,
   public APIs, destructive operations, or user-designated), or a weak foreign option, still get
   two independent fresh contexts; both may use the available provider. Both must pass.
   Provider operational failure is not a passing review and never erases actual failing findings.
   If nobody can review, report pending/unavailable; only the user can explicitly opt out. Never
   shrink scope because of quota.
4. **The verifier reports; it does not fix.** It inherits the lead's mode so it can run
   the checks unattended, and its brief forbids fixes. Separating find from fix stops a
   verifier from quietly patching and then declaring success.
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
`mode: "async"` delegations, following returned `next` until completion wakes the parent.
Do not poll running delegates. The lead's own playbook bounds fan-out and nesting; see §8.

## 6. Model policy

There is no fixed role → model table. The lead picks the model for each child from
its **own family**, matched to the task, because it knows its family's strengths and
the best choice changes with every release. The verifier prefers a usable foreign vendor (§5).

The user's preferences live in `.ged/model-notes.md`. The lead reads it first, tries
what it names, and records any new preference the user states. When a named model is
unavailable the lead uses the closest one it can and **says so in the thread**. This
is a decided exception to the no-unapproved-fallbacks rule: the user asked for
autonomy here, and announcing the fallback keeps it visible.

| Role        | Model                                | runtimeMode | interactionMode |
| ----------- | ------------------------------------ | ----------- | --------------- |
| Planner     | lead's family, chosen for the task   | inherit     | `plan`          |
| Implementer | lead's family, chosen for the task   | inherit     | `default`       |
| Verifier    | usable foreign vendor preferred (§5) | inherit     | `default`       |

The lead calls `orchestrator_capabilities` first: it returns registered provider
instances, advertised models, whether each can run a child task, and model-visible
reasons for unavailability. Small changes the lead may implement itself, but every
change that lands still needs a verdict unless the user explicitly opted out.

Before verifier delegation, re-read `ged_memory_list` for effective local review policy, scope,
reason, validity and gate support. Infer project versus change scope only from an explicit user
request; ask one targeted question if unclear. Never skip automatically for cost, size, quota or
failed review. A change exemption is recorded only after checks and the final clean commit, for
that full branch and exact HEAD; it never transfers to a new commit. Project reset clears all local
exemptions; change reset clears only that branch and may inherit project skip. Keep ordinary
checks, report independent review SKIPPED separately, and obey `ged_land_check`. See the
[local review policy decision](./DECISIONS.md#2026-10-21--explicit-local-independent-review-opt-outs).

## 7. Components to build

All additive. None modifies an upstream file — which is the condition for staying
mergeable against ~800 upstream commits a month.

| #   | Component                                                                          | Where                                  | Status                            |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------- | --------------------------------- |
| 1   | **Role briefs** — the real role definitions, since `role` is only a prompt prefix  | `apps/server/src/ged/playbooks/`       | built, served by `ged_playbook`   |
| 2   | **Lead playbook** — the delegation policy, served like the briefs                  | `apps/server/src/ged/playbooks/`       | built, served by `ged_playbook`   |
| 3   | **Verdict records** — branch-keyed, with SHA provenance inside                     | `.ged/verdicts/`                       | built (format + gate enforcement) |
| 4   | **Land gate** — requires a current independent verdict unless explicitly opted out | `.ged/bin/land-gate.sh`                | built, tested                     |
| 5   | **Memory MCP toolkit** — serves the above to every provider                        | `apps/server/src/mcp/toolkits/memory/` | built, tested                     |
| 6   | **`ProjectMemory` service** — resolves, reads and writes the `.ged/` tree          | `apps/server/src/ged/`                 | built, tested                     |

All six are built. The toolkit exposes `ged_memory_list`, `ged_memory_read`, `ged_playbook`,
`ged_verdict_write`, `ged_land_check`, `ged_init`, `ged_review_policy_set` and
`ged_review_gate_update`; `ged_land_check` runs component 4 rather than
reimplementing it, so the tool and the pre-push hook cannot give different answers.

One upstream file is modified: `apps/server/src/mcp/McpHttpServer.ts`, 10 lines, to import the
toolkit, provide `ProjectMemory.layer`, and add one entry to the layer merge. That exception is
recorded in [DECISIONS.md](./DECISIONS.md).

## 8. Failure modes to watch

- **Worktree drift.** Shared children inherit the parent checkout; isolated children use the
  checkout prepared by delegation. Shell-created checkouts do not rebind either thread.
- **Wait blocking.** `mode: "wait"` blocks the lead's turn. A wait timeout does not
  cancel the child — it sets `waitTimedOut: true`. Follow the returned `next` and completion wake.
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
