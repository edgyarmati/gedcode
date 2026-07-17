# SPEC — Orchestrator Delegation and Project Context

## Goal

Make the PM capable of safely completing trivial work itself while reliable task workers own proper
implementation. Replace stage-specific backend configuration with Cheap, Smart, and Genius presets;
make worker changes commit-safe before verification and landing; remove terminal task clutter; and add
project-context onboarding plus practical worktree launch actions.

## Domain Language

- **Stage role**: lifecycle responsibility (`plan`, `work`, or `verify`). Roles remain independent of
  model intelligence.
- **Capability preset**: a complete harness, model, and thinking selection named Cheap, Smart, or
  Genius.
- **Helper run**: a persisted read-only exploration run attached to a PM thread or task. It is not a
  task stage and never owns a gate, commit, PR, or landing outcome.
- **Direct PM change**: a bounded low-risk edit made, verified, and committed by the PM in the primary
  project checkout without creating a task.
- **Change review**: PM inspection and resolution of tracked or untracked changes left by a work agent
  before verification may start.
- **No changes needed**: a terminal successful outcome for a task whose accepted work produces no
  commit relative to its base.
- **Project context run**: an opt-in agent run that creates or reviews durable project guidance outside
  the task lifecycle.

## Decisions and Constraints

### PM direct work

- The PM decides whether work is trivial. Direct work must be one bounded, low-risk change requiring no
  design decision, migration, public contract change, security-sensitive logic, or broad verification.
- A direct change uses the primary checkout. Existing dirty files do not block it, and the PM may edit
  overlapping files and select intended hunks; the PM is responsible for reviewing the final diff.
- Codex PM sessions use workspace-write with auto-review. Unresolved or denied escalations reach the
  user. Claude and OpenCode retain their normal full-access behavior.
- The PM runs proportional checks, commits intended hunks with a descriptive message, and records its
  rationale and commit in the PM thread. Direct work has no task, gate, worktree, or PR.
- Proper work remains task-based and isolated in an Orchestrator worktree.

### Work completion, verification, and landing

- Work-agent instructions require meaningful commits, but correctness is server-enforced rather than
  prompt-only.
- A successful work turn with tracked or untracked changes enters durable Change review. Verification
  cannot start while Change review is unresolved.
- The PM can inspect status and diff, commit selected changes, return/steer the worker, or discard
  selected changes. Destructive actions are scoped to the task worktree.
- Any commit, discard, or renewed work invalidates earlier verification. A fresh verify attempt runs
  only after the PM accepts a clean worktree.
- Landing requires a clean worktree and a successful verification bound to the exact current task HEAD.
- If accepted work has no commit relative to its base, settle as No changes needed instead of requesting
  a land gate or PR.
- Successful landed and No changes needed tasks auto-archive. They remain inspectable in history and
  eligible for permanent deletion.
- Existing inert `landed` tasks with no PR and no genuine PR-opening failure are repaired to No changes
  needed and archived through append-only lifecycle events. Genuine PR failures retain Retry.

### Capability presets and routing

- Global settings define Cheap, Smart, and Genius as complete model selections. Projects may override
  any preset. Attempts record both tier and resolved backend so settings changes do not rewrite history.
- Role-specific prompt prefixes remain keyed by Plan, Work, and Verify.
- Upgrade presents a non-skippable migration wizard on entering Orchestrator. The user manually maps
  old role selections to all three presets; Orchestrator is entirely inaccessible until completion.
- The PM handles simple planning itself and gives the work agent a concrete plan. Delegated planning
  defaults Genius. Work and verification default Cheap or Smart based on scope and risk. The PM may
  override any choice.
- Escalation is PM-controlled and advances only after diagnosis. Permission, environment, and quota
  failures never automatically spend a more capable model.

### Helper runs

- A PM or task can start persisted, read-only helper runs for bounded context gathering. Cheap is the
  normal default, but the PM can choose another preset.
- Task helpers read the task worktree; PM helpers read the project checkout. Results are bounded and
  automatically available to the requesting PM or subsequent stage prompt.
- Helpers appear in timeline/history but not the task board. Provider-native subagents remain allowed
  and are not managed or duplicated by GedCode.

### Project-context onboarding and skills

- Replace the project `grill-me` skill with an integrated `grill-with-docs`, vendoring its `grilling`
  and `domain-modeling` dependencies while retaining GED clarification/planning state transitions.
- Canonical project context is `AGENTS.md`, `.ged/PROJECT.md`, `.ged/ARCHITECTURE.md`, root
  `CONTEXT.md`, and sparse `docs/adr/*.md`. `.ged/DECISIONS.md` is not created. Task files under
  `.ged/work/root/` remain task-specific, and `.gedcode/` remains runtime-only.
- On project add or first open in Chat or Orchestrator, inspect canonical files. Missing, whitespace-only,
  or template-only stubs offer Populate; substantive files offer Review.
- Dismissal/completion is remembered per project and content fingerprint. Prompt again only after
  material file changes or an onboarding schema upgrade.
- Chat and Orchestrator share one project-context operation. It offers Cheap/Smart/Genius cards with
  the configured harness logo plus model/thinking summary. Smart is the factory choice; the selected
  preset becomes the global default for later context runs.
- A context run edits the primary checkout but is not a task. Its result enters a mandatory diff review
  with Commit, Revise, and Discard; nothing commits automatically.

### Worktree access and branch names

- PM headers expose the configured editor button for the project root. Worker headers use the exact
  task worktree. An adjacent menu offers Reveal in Finder/Explorer, Open terminal here, and installed
  alternate editors.
- Launch requests validate that the target is the registered project root or owned task worktree and
  report unsupported remote/environment capabilities explicitly.
- New task branches use `ged/<task-type>/<task-title-slug>`, safely truncated and normalized. Local
  collisions use `-2`, `-3`, and so on. Existing branches are never renamed.

## Out of Scope

- Canonical pipeline-order enforcement remains deferred beyond the exact-HEAD verification invariant.
- Provider-native subagent orchestration is not intercepted or configured.
- PM direct changes do not gain a PR or task history.
- Existing branch renaming and automatic model escalation are excluded.

## Acceptance Criteria

- Dirty work cannot verify or land; PM resolution is durable, scoped, and always precedes fresh
  verification of exact HEAD.
- No-change and successfully landed work disappears from the active board without losing history.
- PMs can safely edit/test/commit trivial work under the selected provider permission policy.
- Orchestrator cannot be bypassed until legacy backend selections are mapped to valid tier presets.
- Tier routing, escalation, helper runs, and resolved backends remain inspectable after replay/restart.
- Project-context prompting behaves consistently in Chat and Orchestrator and never treats `.gedcode/`
  as authorable context.
- Editor/file-manager/terminal actions always target the correct checkout.
- New task branches are readable and collision-safe.
- `CHANGELOG.md`, `bun fmt`, `bun lint`, `bun typecheck`, and `bun run test` pass for every completed
  implementation slice.
