# Decision Spike: Ged Role-Invocation Subsystem (Plan 014)

- Status: proposed (decision spike — no code change)
- Date: 2026-06-13
- Tracking: Closes #18
- Scope: decide the fate of the Gedcode-managed Ged role-invocation path versus the harness-native subagent path.

## Context

Gedcode ships two related but distinct mechanisms for the Ged roles
(`ged-explorer`, `ged-planner`, `ged-verifier`, plus `ged-plan-reviewer` and
`ged-worker`):

1. A **role-invocation path** — a `GedRoleInvocationService` whose `invoke()`
   was once meant to spawn Gedcode-managed child threads (one per role) and
   dispatch them through the orchestration engine.
2. A **prompt/preset path** — `buildWorkflowPromptSuffix` injects role-mode
   instructions into the main agent's prompt so the agent uses
   **harness-native** subagents (or falls back to running the role in the main
   thread), plus an optional per-role model/reasoning **preset** block.

A prior change (`cf89ee50` "fix: use harness-native ged workflow") deliberately
moved the product toward harness-native subagents. That commit gutted the
invocation implementation (`GedRoleInvocationServiceLive.ts` shrank from ~279
lines to a stub; `GedRoleInvocationService.test.ts` lost ~309 lines) while
keeping the prompt path in place. The result is two artifacts that look related
but pull in opposite directions: a dead invocation service and a live
prompt/preset path. This spike resolves which to keep.

The two paths are easy to conflate. They are **not** the same:

- The **dead invocation path** is server code that never runs — there is no
  production caller, and even if called it refuses unconditionally.
- The **Codex-only preset path** is live and shipping, but the Codex-specific
  part is only the per-role model/reasoning **preset** block. The role _mode_
  surfacing (native vs main-thread fallback) is already provider-agnostic.

## Evidence

### The invocation path is dead and self-disabling

`apps/server/src/gedWorkflow/Layers/GedRoleInvocationServiceLive.ts:41` defines
`invoke()`. It validates input, reads settings, then **always fails** without
ever invoking a role:

- `GedRoleInvocationServiceLive.ts:45` — if `!settings.gedSubagentsEnabled`,
  fail with `"Ged subagents are disabled"`.
- `GedRoleInvocationServiceLive.ts:50-52` — otherwise, fail with
  `"Ged role child threads are disabled; use harness-native subagents"`.

There is no code path that returns a `GedRoleInvocationResult`. The success
type (`GedRoleInvocationResult` with a `childThreadId`,
`GedRoleInvocationService.ts:17-22`) is unreachable.

### No production caller

```
git grep -n "GedRoleInvocationService" apps/server/src
```

returns only:

- the service definition —
  `apps/server/src/gedWorkflow/Services/GedRoleInvocationService.ts:49,55-58`
- the disabled Live layer —
  `apps/server/src/gedWorkflow/Layers/GedRoleInvocationServiceLive.ts:7-10,41,55,58`
- a test —
  `apps/server/src/gedWorkflow/Layers/GedRoleInvocationService.test.ts:14-17,38,49,61`

Nothing in `apps/server/src` (orchestration, provider, ws, server bootstrap)
constructs or calls `GedRoleInvocationService`. The test itself only asserts the
two refusal branches and that no orchestration command is dispatched
(`GedRoleInvocationService.test.ts:62-86`). It documents the dead end rather
than exercising behavior.

The test still wires in `OrchestrationEngineService` and
`ProjectionSnapshotQuery` (`GedRoleInvocationService.test.ts:8-11,50-53`),
artifacts of the deleted dispatch implementation — the seam the old `invoke()`
used to push role child-thread commands through.

### The role prompts exist and are tested (independent of invocation)

`apps/server/src/gedWorkflow/GedRolePrompts.ts` defines
`GED_ROLE_PROMPT_DEFINITIONS` for all five roles, including `ged-explorer`
(`:59`), `ged-planner` (`:78`), and `ged-verifier` (`:106`), plus
`buildGedRolePrompt` (`:141`) and `getGedRoleOutputSections` (`:138`). These are
covered by `apps/server/src/gedWorkflow/GedRolePrompts.test.ts`. Importantly
these prompts were authored as the _child-thread role brief_ (the prompt text
literally says "Gedcode launched you as a separate child thread",
`GedRolePrompts.ts:147,151`) — i.e. they belong to the dead invocation path, not
to the harness-native prompt suffix, which builds its own role text in
`buildWorkflowPromptSuffix`.

### The Codex-only limitation is the PRESET, not the role surfacing

`apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.ts:109`
(`resolveCodexGedSubagentPreset`) returns `undefined` unless
`context.provider === CODEX_PROVIDER` (`GedWorkflowServiceLive.ts:113`). It is
called from `getWorkflowPromptSuffix` (`GedWorkflowServiceLive.ts:295`).

But the live prompt path already surfaces explorer/planner/verifier to **every**
provider. In `packages/ged-workflow/src/WorkflowPrompt.ts`:

- `buildWorkflowPromptSuffix` emits the "Ged Role Execution" section with
  per-role mode (`native subagent` vs `main-thread fallback`) for all providers
  (`WorkflowPrompt.ts:115-133`), driven by `roleSettings` and
  `subagentsEnabled` (`WorkflowPrompt.ts:20-31`).
- Only the optional "Codex Ged Subagent Preset" block is gated on
  `provider === "codex"` (`WorkflowPrompt.ts:135-152`). That block carries the
  per-role `model`/`reasoning` overrides formatted by
  `formatCodexGedSubagentPreset` (`packages/shared/src/gedSubagentPreset.ts:33`).

So the gap is narrow and intentional: Claude and OpenCode get the role-mode
instructions, but they do not get a per-role model/reasoning preset. This is
already documented as deliberate in `docs/ged-workflow.md:63-71` ("GedCode
formats and injects this preset only into Codex workflow prompts").

### README markets three providers as first-class

`README.md:3` and `README.md:22` state the current release supports Codex,
Claude, and OpenCode, with per-provider setup docs
(`README.md:26-27`, `docs/providers/claude.md`, `docs/providers/opencode.md`).
The marketing is accurate for _provider sessions_ and for _role-mode surfacing_;
the only asymmetry is the Codex-only per-role preset, which the docs already
disclose.

### Settings surface

`gedSubagentsEnabled` is defined in `packages/contracts/src/settings.ts:474`
(and the patch struct `:594`). Its only non-test readers are:

- `GedRoleInvocationServiceLive.ts:45` — the dead path's first refusal branch.
- `GedWorkflowServiceLive.ts:298` — feeds `buildWorkflowPromptSuffix`'s
  `subagentsEnabled`, which decides native vs main-thread fallback per role
  (`WorkflowPrompt.ts:20-22`).

`gedRoleSettings` (`settings.ts:463-466,484`) is the live per-role enable
toggle. So `gedSubagentsEnabled` carries real meaning for the **live** path; it
is only the _first refusal branch_ of the dead path that is redundant.

### Stale architecture references (affects Option A)

`AGENTS.md`/`CLAUDE.md` describe flat files `codexAppServerManager.ts`,
`providerManager.ts`, and `wsServer.ts`. Those files no longer exist. The
current seams are `apps/server/src/provider/` (e.g.
`provider/Services/ProviderDriver.ts`) and `apps/server/src/orchestration/`
(e.g. `orchestration/Services/OrchestrationEngine.ts`, `ws.ts`). Any plan that
says "wire `invoke()` through `providerManager`" is pointing at a file that was
already refactored away.

## Option A — Finish a provider-agnostic role-invocation path

Revive `invoke()` so Gedcode itself launches role child threads through any
provider adapter, rather than relying on harness-native subagent tools.

Work required:

- **Rename the Codex-specific preset types** so they are not Codex-bound:
  `CodexGedSubagentPreset` / `CodexGedSubagentPresetRole`
  (`packages/contracts/src/settings.ts:136-258`),
  `formatCodexGedSubagentPreset` / `normalizeCodexGedSubagentPreset`
  (`packages/shared/src/gedSubagentPreset.ts`), and
  `resolveCodexGedSubagentPreset` (`GedWorkflowServiceLive.ts:109`). Generalize
  to a `GedSubagentPreset` keyed by provider, or a per-role preset that each
  adapter maps onto its own model/reasoning vocabulary.
- **Define how each adapter surfaces explorer/planner/verifier** as a managed
  child thread: Codex (`provider/` drivers), Claude, and OpenCode
  (`provider/Services/opencodeRuntime.ts`, `provider/Services/ProviderDriver.ts`).
  Each adapter must map a role brief (from `GedRolePrompts.ts`) and a model
  selection onto a real session.
- **Wire `invoke()` through the current provider dispatch seam.** The seam is
  `provider/Services/ProviderDriver.ts` and the orchestration command bus
  (`orchestration/Services/OrchestrationEngine.ts`) — **not** the long-gone
  `providerManager.ts`. The dead test's use of `OrchestrationEngineService`
  hints at the original dispatch shape, but it must be re-validated against the
  refactored orchestration pipeline.
- **Restore the success path**: produce real `childThreadId`s
  (`GedRoleInvocationResult`, `GedRoleInvocationService.ts:17-22`), stream their
  events, and return structured evidence to the parent thread.
- **Reconcile prompt guidance**: `WorkflowPrompt.ts:116,130` and
  `GedRolePrompts.ts:152` currently tell the agent the opposite ("Do not expect
  Gedcode to launch separate role child threads", "Do not use provider-native
  subagent tools"). Option A inverts that contract.

Hard open questions (each is a real subsystem, not a detail):

- **Session budgeting** — N concurrent role child threads multiply token,
  rate-limit, and process cost. Codex `app-server`, Claude, and OpenCode each
  have different concurrency and cost models. There is no budget/quota mechanism
  today.
- **Cancellation / lifecycle** — if the parent turn is cancelled, reconnects, or
  the server restarts, child threads must be cancelled and reconciled. This
  intersects the reconnect/partial-stream robustness priorities in `AGENTS.md`.
  No child-thread lifecycle exists post-`cf89ee50`.
- **Per-harness subagent expression** — Codex exposes native subagent tooling
  with model/reasoning overrides; Claude and OpenCode express delegation
  differently. A provider-agnostic invocation must define a common contract and
  a per-adapter mapping, including the case where a provider has no native
  subagent concept and a separate session must be spun up instead.

## Option B — Remove the dead invocation path, keep harness-native subagents

Delete the unreachable path and the redundant toggle branch; keep the live
harness-native prompt/preset path that already ships.

Work required:

- Delete `apps/server/src/gedWorkflow/Services/GedRoleInvocationService.ts`,
  `apps/server/src/gedWorkflow/Layers/GedRoleInvocationServiceLive.ts`, and
  `apps/server/src/gedWorkflow/Layers/GedRoleInvocationService.test.ts`.
- Decide the fate of `GedRolePrompts.ts` + its test. These prompts are the
  child-thread role brief and are only consumed by the dead invocation path
  (`GedRoleInvocationServiceLive.ts:11,17` references
  `GED_ROLE_PROMPT_DEFINITIONS`). With the invocation path gone they become
  dead too and should be removed in the same change — unless we want to retain
  them as a documented future-use artifact (not recommended; keep the tree
  honest).
- Evaluate `gedSubagentsEnabled`'s first refusal branch
  (`GedRoleInvocationServiceLive.ts:45`). The **setting stays** — it is live and
  meaningful for `WorkflowPrompt.ts` (`GedWorkflowServiceLive.ts:298`). Only the
  dead refusal branch is removed by deleting the file. No contract change to
  `settings.ts` is required.
- Docs to update:
  - `AGENTS.md` / `CLAUDE.md` — fix the stale file references
    (`codexAppServerManager.ts` / `providerManager.ts` / `wsServer.ts`) while in
    the area; optionally state that Ged roles are harness-native only.
  - `docs/ged-workflow.md:57-71` already describes harness-native subagents and
    the Codex-only preset accurately — confirm it still reads correctly with the
    invocation path gone.
  - `CHANGELOG.md` — record the removal under `## Unreleased`.
- This is consistent with the branch direction (`cleanup/drop-upstream-features`)
  and the `cf89ee50` decision; it lowers tech debt with no behavior change.

## Recommendation: Option B

Remove the dead invocation path (and the now-orphaned `GedRolePrompts.ts`) and
keep the harness-native subagent path.

Reasoning:

- **The product already chose harness-native.** Commit `cf89ee50` explicitly
  moved this way and removed the dispatch implementation; the residue is the
  stub `invoke()` and child-thread prompts. The live path
  (`WorkflowPrompt.ts:115-152`) is the intended design and is tested.
- **The "Codex-only" gap is narrow and already disclosed.** Claude and OpenCode
  receive provider-agnostic role-mode instructions today; only the per-role
  model/reasoning preset is Codex-specific, and `docs/ged-workflow.md:63-71`
  says so. The README's first-class claim holds for provider sessions and role
  surfacing. There is no user-facing breakage to fix by reviving invocation.
- **Option A is a large, risky subsystem, not a finish-the-wiring task.** It
  requires new budgeting, cancellation/lifecycle, and per-harness delegation
  contracts, and it would invert prompt guidance the agent currently relies on.
  It also targets a `providerManager.ts` that no longer exists, so the plan
  would need re-grounding before any code is written. That conflicts with the
  branch's cleanup goal and the "reliability/predictability under failure"
  priorities in `AGENTS.md`.
- **Keeping the dead path is a maintenance liability.** It implies a capability
  the server does not have, carries a test that only asserts "this does
  nothing", and forces every reader to disambiguate it from the live preset
  path.

If provider-agnostic per-role model/reasoning presets become a real product
requirement later, that is a _prompt/preset_ enhancement on the live path
(generalize the preset block in `WorkflowPrompt.ts:135-152` and the types named
above) — it does **not** require resurrecting Gedcode-managed child threads.

## Next Steps (Option B)

1. Remove the three invocation files listed under Option B and the orphaned
   `GedRolePrompts.ts` + `GedRolePrompts.test.ts`; confirm via
   `git grep -n "GedRoleInvocationService\|GED_ROLE_PROMPT_DEFINITIONS\|buildGedRolePrompt"`
   that no live references remain.
2. Confirm `gedSubagentsEnabled` and `gedRoleSettings` are untouched in
   `packages/contracts/src/settings.ts` and still flow into
   `WorkflowPrompt.ts` via `GedWorkflowServiceLive.ts:298`.
3. Fix the stale architecture references in `AGENTS.md` / `CLAUDE.md`
   (`codexAppServerManager.ts` / `providerManager.ts` / `wsServer.ts` →
   `provider/` and `orchestration/` seams) since the spike surfaced them.
4. Re-read `docs/ged-workflow.md:57-71` and adjust only if removing the
   invocation path changes any claim (expected: no change).
5. Add a `## Unreleased` `CHANGELOG.md` entry recording the removal of the dead
   Ged role-invocation path.
6. Run `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` before
   landing.
