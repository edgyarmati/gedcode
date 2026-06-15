# Plan 014 [SPIKE]: Decide and document the fate of the Ged role-invocation subsystem (finish provider-agnostic, or remove)

> **Executor instructions**: This is a DESIGN SPIKE, not a build-everything task.
> Your deliverable is a written decision document + a small, reversible proof
> step — NOT a full feature. Do the investigation, write the design doc, and
> stop at the decision gate. If a STOP condition occurs, stop and report.
> Update this plan's row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 65e913c7..HEAD -- apps/server/src/gedWorkflow`
> If the gedWorkflow tree changed, re-confirm the excerpts below.

## Status

- **Priority**: P2
- **Effort**: L (decision spike is M; implementing the chosen path is separate)
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `65e913c7`, 2026-06-13
- **Issue**: https://github.com/edgyarmati/gedcode/issues/18

## Why this matters

The Ged workflow (clarify → plan → implement → verify) is the product's reason
for existing, and `docs/ged-workflow.md` sells role-specific subagents
(exploration, planning critique, verification review) as a core capability. But
server-managed role invocation is **dead code**: `GedRoleInvocationServiceLive`
always rejects, no production code calls it, and the role _presets_ that shape
the workflow prompt only reach **Codex** sessions — Claude and OpenCode users,
which the README markets as first-class, get a degraded version of the headline
feature. This is two coupled problems (a disabled invocation path + a Codex-only
preset path) around one subsystem. The right move is a deliberate decision, not
drift: either finish a provider-agnostic role system or remove the dead toggle.

## Current state (evidence — read these before deciding)

- **Invocation is a permanent stub** —
  `apps/server/src/gedWorkflow/Layers/GedRoleInvocationServiceLive.ts:41-53`:
  ```ts
  const invoke = (rawInput) =>
    Effect.gen(function* () {
      yield* validateInput(rawInput);
      const settings = yield* settingsService.getSettings;
      if (!settings.gedSubagentsEnabled) {
        return yield* new GedRoleInvocationInputError({ detail: "Ged subagents are disabled" });
      }
      return yield* new GedRoleInvocationInputError({
        detail: "Ged role child threads are disabled; use harness-native subagents",
      }); // <-- never actually invokes a role
    });
  ```
- **No production caller** — `grep -rn "GedRoleInvocationService" apps/server/src`
  finds only the Service definition (`Services/GedRoleInvocationService.ts`) and
  the disabled Live layer. The interface is fully specified though:
  `invoke(input: { role, invocationId, parentThreadId, request }) =>
Effect<GedRoleInvocationResult, GedRoleInvocationError>` with dispatch/context
  error types defined (`Services/GedRoleInvocationService.ts:9-58`).
- **Prompts exist and are tested** — `apps/server/src/gedWorkflow/GedRolePrompts.ts`
  defines `GED_ROLE_PROMPT_DEFINITIONS` for `ged-explorer`, `ged-planner`,
  `ged-verifier` (roles, boundaries, output sections, `buildGedRolePrompt`).
- **Presets are Codex-only** —
  `apps/server/src/gedWorkflow/Layers/GedWorkflowServiceLive.ts:110-126`:
  ```ts
  const resolveCodexGedSubagentPreset = (current, context) => {
    if (context?.provider !== CODEX_PROVIDER) return undefined; // <-- Codex gate
    // ... returns formatCodexGedSubagentPreset(...) ...
  };
  ```
  and it is injected into the prompt suffix only via this resolver
  (`getWorkflowPromptSuffix`, lines 291-300):
  ```ts
  buildWorkflowPromptSuffix({
    codexGedSubagentPreset: resolveCodexGedSubagentPreset(current, context),
    provider: context?.provider,
    roleSettings: current.gedRoleSettings,
    subagentsEnabled: current.gedSubagentsEnabled,
  });
  ```
  The data model is Codex-shaped: `packages/shared/src/gedSubagentPreset.ts`
  exposes only `formatCodexGedSubagentPreset` / `CodexGedSubagentPreset`.
- **Marketing claim** — `README.md:3` lists Codex, Claude, and OpenCode as
  supported provider sessions equally; `docs/ged-workflow.md` describes role
  subagents as part of the workflow.

## Commands you will need

| Purpose        | Command                                                                                                                               | Expected on success                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Find callers   | `git grep -n "GedRoleInvocationService\|gedSubagentsEnabled\|resolveCodexGedSubagentPreset\|getWorkflowPromptSuffix" apps/server/src` | maps the subsystem's wiring             |
| Find tests     | `git grep -ln "GedRole\|gedSubagent" apps/server/src packages/shared`                                                                 | the tests that constrain a change       |
| Typecheck/test | `bun typecheck` ; `bun run test`                                                                                                      | exit 0 / pass (for the proof step only) |

## Scope

**In scope** (spike deliverables):

- A new design doc: `docs/decisions/2026-06-ged-role-invocation.md` (create the
  `docs/decisions/` dir if absent) capturing the decision, evidence, and plan.
- OPTIONAL, only if the decision is "remove": the actual removal (it is S/LOW
  risk) may be done in this plan — see Step 4.

**Out of scope**:

- Actually building provider-agnostic child-thread invocation. If the decision is
  "finish", this spike defines the API and open questions; the build is a
  follow-up plan, NOT this one (it touches provider session lifecycle and session
  budgeting and must be scoped separately).
- Changing `GedRolePrompts.ts` content.

## Git workflow

- Branch: `advisor/014-spike-ged-role-invocation`
- Commit: `docs: decide Ged role-invocation direction (spike)` (+ a second commit
  if Step 4 removal is chosen)
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Map the subsystem and its blast radius

Run the "Find callers" and "Find tests" greps. Build a precise inventory:

- every file in `apps/server/src/gedWorkflow/`
- which symbols are exported and imported where
- the settings fields involved (`gedSubagentsEnabled`, `gedRoleSettings`,
  `providers.codex.gedSubagentPreset`, per-instance `gedSubagentPreset`)
- the tests that would break under removal vs under extension

**Verify**: the inventory lists, for each gedWorkflow file, "live (has prod
caller)" vs "dead (only self/tests)".

### Step 2: Evaluate the two options against evidence

Write up both, honestly:

- **Option A — Finish provider-agnostic role invocation**: rename the
  Codex-specific preset types to a provider-agnostic abstraction, define how each
  adapter (Claude, OpenCode, Codex) surfaces explorer/planner/verifier guidance,
  and how `GedRoleInvocationService.invoke` would actually spawn a child thread
  through `providerManager`. Capture the hard open questions: session budgeting
  (a role invocation spawns a session — how is it bounded/cancelled?),
  reconnect/replay semantics for child threads, and how Claude/OpenCode express
  subagents differently from Codex (a naive prompt-suffix port may be ignored or
  mishandled by those harnesses).
- **Option B — Remove the dead path**: delete `GedRoleInvocationService` +
  `GedRoleInvocationServiceLive`, the `gedSubagentsEnabled` toggle if nothing
  else reads it, and any now-orphaned types; keep harness-native subagents as the
  only path. Note what docs (`docs/ged-workflow.md`) must change to stop
  promising server-managed roles.

**Verify**: the doc states a recommendation with reasoning grounded in the Step 1
inventory (e.g. "Claude/OpenCode adapters do/don't have a child-thread spawn
primitive at `<file:line>`").

### Step 3: Write the decision doc

Create `docs/decisions/2026-06-ged-role-invocation.md` with: context, the
evidence above (with file:line), Option A vs B, the recommendation, and — for the
recommended option — a concrete next-step plan outline (for A: the API surface +
ordered build steps + open questions; for B: the exact deletion list).

**Verify**: the doc exists and references real file:line evidence.

### Step 4: (Only if the decision is REMOVE) execute the low-risk removal

If and only if the recommendation is B and the operator has not said
"decision-only": delete the dead files/symbols identified in Step 1, update
`docs/ged-workflow.md` to stop promising server-managed roles, and run the full
gate. Keep the Codex preset path if it is still live and wanted (removal of
_invocation_ is separable from the _preset_ path — be precise).

**Verify**: `bun typecheck` → exit 0; `bun run test` → all pass; `bun lint` and
`bun run fmt:check` → exit 0; `git grep -n "GedRoleInvocationService"` returns
nothing if fully removed.

## Test plan

- For a decision-only outcome (Option A recommended, or B deferred): no code
  tests; the deliverable is the doc.
- For an executed removal (Step 4): the existing suite must stay green
  (`bun run test`), and any tests that _only_ tested the dead stub are removed
  with it. Do not delete tests that cover still-live code.

## Done criteria

- [ ] `docs/decisions/2026-06-ged-role-invocation.md` exists with evidence + a clear recommendation
- [ ] The doc distinguishes the _invocation_ path (dead) from the _preset_ path (Codex-only) and addresses both
- [ ] If removal was executed: `bun typecheck`, `bun run test`, `bun lint`, `bun run fmt:check` all exit 0, and the dead symbols are gone
- [ ] If "finish" was chosen: the doc lists the API surface and the open questions (session budget, cancellation, per-harness subagent expression) — and NO half-built invocation code was committed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (decision belongs to the maintainer) if:

- The recommendation is "finish" — STOP after writing the doc; do NOT start
  building child-thread invocation (it is a separate, larger plan touching
  session lifecycle).
- Removing the subsystem would also remove the Codex preset path that is
  currently live and useful — report the coupling; remove only the truly-dead
  invocation path.
- You find a production caller of `GedRoleInvocationService.invoke` that the
  "Current state" grep missed — the subsystem is NOT dead; report and re-scope.

## Maintenance notes

- This is the product's differentiating feature; the maintainer should make the
  build-vs-remove call. The spike's job is to make that call cheap and informed.
- If "finish" is chosen, the follow-up build plan must define the session-budget
  contract up front — an unbounded role-invocation that spawns sessions is a
  reliability/cost risk (ties to the unbounded-PubSub concern elsewhere in the
  audit).
