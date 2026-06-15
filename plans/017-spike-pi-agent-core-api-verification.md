# Plan 017 [SPIKE]: Verify the `pi-agent-core` / `pi-ai` API before committing the PM runtime shape

> **Executor instructions**: This is a VERIFICATION SPIKE. The deliverable is a
> decision doc (`docs/decisions/2026-06-pi-agent-core-api.md`) that confirms or
> refutes — against the _real_ installed packages — every API assumption the
> Orchestrator-mode design (`plans/orchestrator-mode-design.md`) depends on, plus
> the pinned dependency landed in `apps/server`. Do the investigation, write the
> doc, and stop at the decision gate. Do NOT build the PM runtime here. Do NOT
> make paid/networked LLM calls. If a STOP condition occurs, stop and report.
> Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 1787e621..HEAD -- apps/server/package.json plans/orchestrator-mode-design.md`
> If either changed, re-confirm the design assumptions below before proceeding.

## Status

- **Priority**: P1 (gates the entire Orchestrator-mode slice, plan 018)
- **Effort**: M
- **Risk**: MED (external pre-1.0 dependency; API may diverge from design)
- **Depends on**: — (this is the first thing built)
- **Blocks**: 018 (thin vertical slice). 018's contracts/runtime assume this spike passed.
- **Category**: direction / spike
- **Planned at**: commit `1787e621`, 2026-06-14
- **Design**: `plans/orchestrator-mode-design.md`
- **Issue**: [#32](https://github.com/edgyarmati/gedcode/issues/32) (Epic: Orchestrator mode)

## Why this matters

The Orchestrator-mode design is **fully LLM-driven**: the per-project PM brain is a
`pi-agent-core` agent loop, and the whole `PmRuntime` shape (adapter lifecycle, the
single-writer re-entry queue, the custom SQLite session store, detached-handoff
tool semantics, cost accounting) is designed against an API that **is not yet
installed and is pre-1.0** (`@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`,
both `0.79.3`). The synthesis flagged this as the single biggest unknown. If the real
API diverges — e.g. `followUp`/`prompt` phase semantics differ, `SessionStorage` is
not pluggable, or pi-ai exposes no per-turn token usage — large parts of plan 018 must
change. This spike answers those questions cheaply, before any contracts or services
are written, and pins the dependency at an exact version.

## Assumptions to verify (from the design)

Each must end up **CONFIRMED**, **DIVERGES (with impact)**, or **UNKNOWN (needs runtime)**:

| #   | Assumption                                                                                                                                               | Where it's load-bearing                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A1  | An agent is constructed roughly as `new AgentHarness({ env, session, model, tools, systemPrompt })` (or documented equivalent).                          | `PiAgentAdapter` lifecycle (`acquireRelease`).                        |
| A2  | A **pluggable** `SessionStorage` interface exists with a small method set we can reimplement over `NodeSqliteClient` (tree/leaf/parentId semantics).     | `SqliteSessionStorage` — PM conversation living in gedcode's DB.      |
| A3  | `prompt`/`followUp` phase semantics: `followUp` throws/queues when idle; `prompt` throws when busy; there is an inspectable idle/busy state.             | `PmReEntryQueue` (single-writer, prompt-when-idle, buffer-otherwise). |
| A4  | `AgentTool.execute` may **resolve immediately** (detached) returning a handle; the agent does not require the tool to await its real-world effect.       | Detached event-driven handoff (Decision 5).                           |
| A5  | `subscribe()` yields a typed event stream (assistant deltas + tool-call activity) we can map to gedcode `OrchestrationEvent`s.                           | PM message projection → `role='pm'` thread.                           |
| A6  | Skills load from `SKILL.md` via a documented loader / `setResources({ skills })`.                                                                        | Soft playbooks layer.                                                 |
| A7  | Context **compaction** is available (or we must implement it ourselves) and can be invoked at idle.                                                      | Long-lived PM context economy.                                        |
| A8  | `pi-ai` exposes **per-turn token usage** (input/output/reasoning) we can sum into `ProjectionTaskSpend`, and a model/provider selector for the PM brain. | Cost budgets + PM model selection.                                    |
| A9  | Importing pi into `apps/server` does not break `bun typecheck` (tsgo), `bun run build`, or `bun lint` (ESM/Node 24/Effect coexistence).                  | Whole integration is viable in this toolchain.                        |

## Commands you will need

| Purpose               | Command                                                                                                                                  | Expected on success                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Pin exact deps        | `cd apps/server && bun add @earendil-works/pi-agent-core@0.79.3 @earendil-works/pi-ai@0.79.3 --exact`                                    | added to `apps/server/package.json` with exact versions   |
| Locate types          | `fd -t f -e d.ts . node_modules/@earendil-works/pi-agent-core node_modules/@earendil-works/pi-ai \| head -50`                            | the published `.d.ts` entry points                        |
| Inspect exports       | `node --input-type=module -e "import * as a from '@earendil-works/pi-agent-core'; console.log(Object.keys(a))"` (run from `apps/server`) | the runtime export names                                  |
| Read package metadata | `cat node_modules/@earendil-works/pi-agent-core/package.json` (note `exports`, `engines`, `dependencies`)                                | subpath export map                                        |
| Typecheck (gate)      | `bun typecheck`                                                                                                                          | exit 0 (importing pi in a probe file must not break tsgo) |
| Build (gate)          | `bun run build`                                                                                                                          | exit 0                                                    |
| Lint/format           | `bun lint` ; `bun run fmt:check`                                                                                                         | exit 0 / clean                                            |

## Scope

**In scope**:

- Land the pinned dependency in `apps/server/package.json` + lockfile.
- A throwaway probe file under `apps/server/src/orchestration/pi/__spike__/` that
  _imports_ and _statically introspects_ the API (types + exported symbols), and
  attempts **non-networked** construction where it does not require an LLM call.
- The decision doc `docs/decisions/2026-06-pi-agent-core-api.md`.

**Out of scope**:

- Building `PmRuntime`, `PiAgentAdapter`, `SqliteSessionStorage`, tools, or any
  contracts/persistence — that is plan 018.
- Any **paid or networked** LLM call. Verification is by reading the published
  `.d.ts` + package docs + non-network construction. (A1/A3/A4/A7 may end up
  `UNKNOWN (needs runtime)` — that is an acceptable spike outcome; record it.)
- Committing the probe file. Delete it before finishing (the doc captures findings).

## Git workflow

- Branch: `feat/orchestrator-mode` (already created; this is the first work on it).
- Commit: `chore: pin pi-agent-core/pi-ai + spike doc verifying PM-runtime API assumptions`
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Pin the dependency

Install both packages at exact `0.79.3` in `apps/server`. Confirm `package.json`
records exact versions (no `^`) and the lockfile updated.

**Verify**: `grep -A2 pi-agent-core apps/server/package.json` shows `"@earendil-works/pi-agent-core": "0.79.3"`; `bun install` is clean.

### Step 2: Confirm the toolchain tolerates pi (A9 — do this early; it can be a STOP)

Add a one-line probe import in the `__spike__` file and run the full toolchain gate.
If tsgo/build/lint break on the import (ESM interop, missing types, Node API
mismatch), that is a material finding — capture the exact errors.

**Verify**: `bun typecheck` && `bun run build` && `bun lint` all exit 0 **with the import present**, OR the failure is documented in the doc with the exact error and a proposed mitigation (e.g. an isolated CJS/ESM boundary).

### Step 3: Introspect the API surface (A1, A2, A5, A6, A7, A8)

Read the published `.d.ts` for both packages and the package `exports` map. For each
assumption A1/A2/A5/A6/A7/A8, record the **actual** exported symbol, its real
signature, and CONFIRMED / DIVERGES / UNKNOWN. Specifically capture:

- the agent/harness constructor params (A1),
- the `SessionStorage` interface methods + whether it is injectable (A2),
- the `subscribe()` event union shape (A5),
- the skill-loading entry point (A6),
- any `compact`/summarize method, or its absence (A7),
- pi-ai's model selector + the per-turn **usage** shape (A8).

**Verify**: the doc has a row per assumption with the real symbol/signature quoted from the `.d.ts`.

### Step 4: Probe phase + detached-tool semantics (A3, A4)

From the `.d.ts` and any docs, determine the agent's idle/busy state model and what
`prompt`/`followUp` do in each phase (A3), and whether a tool's `execute` may resolve
before its effect completes (A4). Where a non-networked construction can demonstrate
the state machine (e.g. reading a `state`/`status` getter without sending a turn), do
so in the probe. Where it genuinely needs a live turn, mark `UNKNOWN (needs runtime)`
and note exactly what a follow-up runtime check would do.

**Verify**: A3 and A4 each resolved to CONFIRMED/DIVERGES/UNKNOWN with the evidence (quoted type or doc) or the precise runtime check deferred.

### Step 5: Write the decision doc and translate divergences into plan-018 deltas

Create `docs/decisions/2026-06-pi-agent-core-api.md` with: the assumption table
(verdict + evidence per row), a "Divergences & impact on plan 018" section listing
every concrete change the real API forces, and a one-line **GO / GO-WITH-CHANGES /
STOP** recommendation for proceeding to 018.

**Verify**: the doc exists, every assumption A1–A9 has a verdict, and any DIVERGES row names the plan-018 component it affects.

### Step 6: Clean up + gate

Delete the `__spike__` probe file. Re-run the full gate.

**Verify**: `git status` shows no `__spike__` file; `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0. (The pinned dep remains — that is intended.)

## Test plan

No unit tests (spike). The quality bar: a plan-018 executor can trust each A-row
verdict and build against the real API without re-deriving it. If A9 passed, the
pinned dependency compiles and builds in the repo toolchain — that is the executable
proof the integration is viable.

## Done criteria

Machine-checkable. ALL must hold:

- [x] `apps/server/package.json` pins `@earendil-works/pi-agent-core@0.79.3` and `@earendil-works/pi-ai@0.79.3` (exact, no caret)
- [x] `docs/decisions/2026-06-pi-agent-core-api.md` exists with a verdict (CONFIRMED/DIVERGES/UNKNOWN) + evidence for every assumption A1–A9
- [x] The doc has a "Divergences & impact on plan 018" section and a GO / GO-WITH-CHANGES / STOP recommendation (verdict: **GO with changes**; 3 deltas)
- [x] No `__spike__` probe file remains (`git status`)
- [x] `bun typecheck`, `bun run build`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0 with the dependency installed
- [x] `plans/README.md` status row updated; the tracking issue's spike checkbox ticked

## STOP conditions

Stop and report back if:

- **A9 fails**: importing pi breaks tsgo/build/lint and there is no clean isolation
  boundary — this threatens the whole approach; report the errors and options
  (CJS shim, worker process, alternative).
- **A2 diverges hard**: `SessionStorage` is not injectable, so the PM conversation
  cannot live in gedcode's DB without forking pi — report; it changes Decision 3's
  persistence story.
- **A3 diverges hard**: there is no inspectable idle/busy state, so the single-writer
  re-entry queue cannot reliably choose `prompt` vs `followUp` — report; it changes
  the durability core.
- **A8 absent**: pi-ai exposes no per-turn token usage at all — report; cost budgets
  fall back to turn-count caps only (already the fail-closed default, but confirm the
  user accepts it as the _primary_ mechanism for now).
- The pinned `0.79.3` is yanked/unavailable, or its `engines` exclude Node 24 — report.

## Maintenance notes

- Pre-1.0 dependency: record the exact version and a note to re-run this spike's
  assumption table on each pi bump before upgrading.
- This doc is the contract the plan-018 PM-runtime work builds against; if 018 finds
  reality differs from a CONFIRMED row, that is a regression in this spike — fix the
  doc, don't silently work around it.
