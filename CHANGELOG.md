# Changelog

Release notes are grouped by released version. Add a `## X.Y.Z` section before running
`./release.sh stable ...` or `./release.sh nightly ...`.

## Unreleased

- Removed the mandatory project-context onboarding and proposal-review modals. Orchestrator PM chat
  now shows a compact Ready/Updating/Needs attention indicator with an explicit manual Review action;
  active maintenance continues to lock PM delivery inline. The obsolete onboarding dismissal and
  Commit/Revise/Discard WebSocket endpoints are no longer exposed.

- Began replacing the mandatory project-context onboarding/review workflow with a PM-owned GED
  manifest lifecycle. Committed `.ged/MANIFEST.json` is now the single schema-version and audit
  source; legacy `.ged/VERSION` can be adopted exactly once and removed, malformed manifests fail
  closed, and projects created by newer GedCode schemas are never downgraded. The manifest is checked
  before every PM turn; missing or outdated context automatically starts one held Smart-default
  maintenance run, and clean scoped results are audited and applied uncommitted without a modal.
  Automatic settlements and their PM hold state now survive database replay and restart.

- Project-context review now reports structured conflict evidence instead of only a generic failure
  string. The UI distinguishes provider scope violations, context/workspace drift, checked-out HEAD
  drift, and protected Git metadata changes; lists implicated paths; disables unsafe Commit/Revise
  actions; and provides an immediate Retry inspection path while keeping Discard available.

- Project-context runs now hold Orchestrator PM delivery from request through settlement. If a PM
  turn is active, the run durably waits for an explicit Wait or Interrupt decision, refreshes its
  baseline after the PM settles, and starts before preserved PM queue entries can resume. The hold
  survives restarts, blocks both user messages and automatic re-entry, releases on commit, discard,
  clean failure, interruption, or pre-start cancellation, and avoids stale-baseline launches.

- The Orchestrator keeps PM chat visible during a project-context hold while disabling only ordinary
  PM message entry. A status panel explains the active phase and offers Wait for PM, Interrupt PM,
  and pre-start cancellation controls; drafts remain intact and pending access/input controls remain
  available when needed to let a waiting PM turn settle.

- Fixed project-context Commit and Discard being blocked when an unrelated branch, tag, remote ref,
  or Orchestrator task ref changed after the agent run. Review resolution still fails closed if the
  checked-out HEAD, current branch identity, index, Git configuration, hooks, audited info files,
  context files, or non-context workspace paths changed.

- Fixed legacy Orchestrator tasks becoming permanent board clutter after an empty-diff landing was
  recorded as `landed` without a pull request. Startup reconciliation and the PM's no-change tool now
  retire and archive these records when Git proves the task branch still equals its creation baseline,
  including after an obsolete landing failure or removed worktree. Failed landings whose branch has
  commits remain untouched for explicit recovery.

- Fixed **Dismiss for now** (and successful context-run starts) reopening the same project-context
  prompt when an immediate post-action scan raced the durable projection and returned stale state.
  The acknowledged schema/fingerprint now closes immediately and remains closed in the shared query
  cache, while a new context fingerprint still prompts normally.

- New Orchestrator tasks now receive readable server-owned branches such as
  `ged/feature/fix-the-pm-harness`. Task types and titles are normalized into bounded Git-safe slugs;
  existing names are reserved atomically with deterministic `-2`, `-3`, and later suffixes, including
  under concurrent creation. Failed dispatches release only an unchanged reservation. Worker
  worktrees attach the exact persisted ref, while existing `orchestrator/*` tasks remain unchanged.
  The PM/MCP task-creation tool no longer accepts caller-selected branch names, and task creation now
  requires the registered project checkout to be an available Git repository rather than silently
  falling back to an unsafe name.

- Added compact Open controls to Orchestrator project/PM and worker headers. The primary action uses
  the user's preferred installed editor, while the adjacent branded menu offers every available
  alternate editor plus file-manager reveal and terminal launch. Project actions target the registered
  project root; worker actions target only that task's managed worktree. Preferences persist across
  future controls, header actions wrap on narrow layouts, and unavailable/remote capabilities or tasks
  without worktrees render disabled with an explicit reason.

- Added secure Orchestrator launch APIs for project roots and task worktrees. Callers select a logical
  project or task plus an installed editor, file-manager reveal, or terminal action; the server derives
  the path from current projections, verifies exact project/worktree ownership and directory liveness,
  and never accepts a caller-provided path. Environment capabilities are queryable for disabled UI,
  with unsupported launchers and process failures reported distinctly. Existing general Chat editor
  actions keep their current behavior.

- Added mandatory project-context change review across normal Chat and Orchestrator. Completed
  context agents now present their bounded summary, changed paths, deterministic diff, and any scope
  violations before anything is committed. Commit creates a descriptive, run-attributed Git commit
  containing only the reviewed agent delta; baseline-aware three-way merging preserves pre-existing
  unstaged edits in the same context file, while stale files, staged indexes, Git drift, and
  overlapping hunks fail closed. Revise starts another durable agent turn against the original
  baseline, and Discard restores the exact pre-run bytes without `git restore` or path-wide cleanup.
  Commit and Discard atomically settle the run plus its resulting context fingerprint, so onboarding
  stays complete until a material context change or scanner upgrade. These runs remain independent
  from tasks, worktrees, stages, gates, pull requests, and landing.

- Added shared project-context onboarding across normal Chat and Orchestrator. A fresh bounded scan
  offers **Populate** for missing or stub guidance and **Review** for substantive context, while
  exact schema/fingerprint dismissal and active-run detection prevent repeat prompts across surface
  switches and reconnects. The non-bypassable prompt presents Cheap, Smart, and Genius cards with
  the effective project/global harness logo, model, and thinking options; Smart is the factory
  choice, and each explicit selection becomes the durable global default for later context runs.
  Material context changes and scanner schema upgrades make onboarding eligible again without
  exposing file contents to the browser.

- Added durable Populate/Review agents for canonical project context. Runs default to the Smart
  capability preset, permanently stamp the selected harness/model/thinking configuration, and work
  in the primary checkout without creating a task, worktree, stage, gate, commit, pull request, or
  landing record. Server-owned raw-file and Git-visible baselines preserve pre-existing dirty work,
  detect out-of-scope files plus HEAD, index, ref, local-config, hook, and Git info mutations, and
  survive restart. The audit intentionally covers Git-visible checkout state and selected Git
  metadata; ignored content and paths outside the checkout remain within the trusted provider-policy
  boundary. Successful runs and abnormal runs with safely auditable changes stop at pending human
  diff review; Gedcode never stages, commits, resets, cleans, or silently repairs the checkout.
  Pending runs wake once at a known quota-reset time even without fresh provider telemetry, while
  orphaned running runs never replay their prompt after restart and instead audit changes into review
  or stop safely. Requests are bound to the server-captured checkout identity, so queued deletion or
  root relocation rejects an obsolete baseline instead of starting a run in a different workspace.

- Added the durable project-context onboarding foundation. A bounded scanner classifies the canonical
  `AGENTS.md`, `.ged/PROJECT.md`, `.ged/ARCHITECTURE.md`, root `CONTEXT.md`, and root ADR files without
  crawling `.gedcode/`, task memory, generated output, or secret-bearing paths. Semantic fingerprints
  ignore formatting/comment noise, detect material context changes and schema upgrades, and compare
  against append-only per-project Dismissed or Completed resolutions so Chat and Orchestrator can
  share one restart-safe onboarding decision in the next UI slices.

- Replaced the basic GED `grill-me` clarification prompt with pinned, vendored `grill-with-docs`,
  `grilling`, and `domain-modeling` skills for both Codex and Claude. Non-trivial work now resolves one
  user decision at a time, looks up discoverable facts in the repository, records clarified project
  language inline in root `CONTEXT.md`, offers sparse ADRs only for consequential trade-offs, and
  hands confirmed understanding into GED planning without duplicating implementation details in the
  glossary.

- Project managers and orchestration MCP clients can now start, inspect, and interrupt persisted
  read-only helper runs without creating task-board work. Helpers default to the Cheap capability
  preset, can explicitly use Smart or Genius, attach either to the PM conversation or an active task,
  and re-enter the PM automatically on completion, failure, or interruption instead of requiring
  polling. Project and task timelines show live and reconnect-safe helper status, stamped provider,
  model, tier, and bounded result or failure details.

- Read-only helper runs now execute through the configured Codex, Claude, or OpenCode harness against
  the project root or an existing task worktree without creating lifecycle stages or worktrees.
  Provider-native read-only policies block edits, shell mutation, delegation, and interactive access;
  bounded secret-scrubbed results feed subsequent task stages. Pending helpers respect provider quota,
  resume after recovery or restart with stable identities, and settle cleanly on completion, failure,
  or interruption.

- Added the durable foundation for read-only nested helper runs attached to a project-manager thread
  or an existing task. Each run keeps a restart-safe identity, selected capability tier, resolved
  harness/model/thinking configuration, bounded prompt and result, provider thread identity, and
  terminal outcome independently from task stages. Helpers intentionally create no task, worktree,
  gate, commit, pull request, landing state, or task-board card.

- Replaced per-task raw worker backend overrides with semantic Cheap, Smart, and Genius defaults for
  Plan, Work, and Verify. The PM now names a tier for every handoff, keeps simple planning itself,
  defaults delegated planning to Genius, and chooses Cheap or Smart for implementation and
  verification. Every attempt records both the tier and resolved backend; quota, permission,
  environment, network, and provider failures retain their tier instead of escalating silently, while
  diagnosed capability failures can be retried explicitly at a higher tier.

- Upgrades from role-based Orchestrator worker settings now enter a durable, mandatory capability
  preset migration before any Orchestrator operation can run. The migration enumerates every live
  project's legacy selections, requires an exact manual Cheap/Smart/Genius mapping, rejects partial
  or generic-settings bypasses, and restores access only after project decisions and the global
  completion marker have been persisted. A non-dismissible two-step wizard now enforces that setup
  across Orchestrator home, project, task, and deep-link routes, with provider logos and full
  harness/model/thinking pickers for global presets and explicit per-project inheritance or overrides.

- Added the schema and runtime foundation for Cheap, Smart, and Genius Orchestrator capability
  presets. Global configuration now accepts only a complete three-preset map, projects can override
  presets independently, and tier-backed stage attempts permanently record the chosen tier plus the
  resolved harness, model, thinking options, and permission mode instead of re-resolving history from
  later settings changes. Global and project settings now present these as branded preset cards with
  harness, model, and thinking controls, visible inheritance, and independent project reset; semantic
  Plan, Work, and Verify settings remain available separately for prompt prefixes only.

- Project managers can now complete genuinely trivial, bounded, low-risk edits directly in the
  primary checkout without creating task or PR clutter. Direct commits require an exact reviewed
  patch, a concrete low-risk rationale, proportional check evidence, and a descriptive message;
  unrelated dirty paths and unselected hunks in the same file remain untouched and visible.

- Project-manager sessions can now work directly in their project: Codex PMs use workspace-scoped
  writes with native auto-review, while Claude and OpenCode PMs retain provider-native full access.
  Access requests that Codex auto-review cannot grant are forwarded into the PM composer with their
  details and explicit approve-once, session approval, decline, and cancel controls.

- Added a visible task **Change review** workflow with a bounded tracked-diff preview, explicit path
  selection, descriptive commits, return-to-worker revision instructions, and confirmed destructive
  discard. Human and PM actions share the same per-task lifecycle lock; change reviews now appear in
  **Needs you**, clean empty work can be recorded as **No changes needed**, and that outcome remains
  labeled in archived task history.

- Tasks whose accepted work leaves a clean branch at its creation commit can now be completed through
  a PM no-change action instead of a meaningless land approval or pull request. No-change results and
  successfully opened task PRs archive automatically, and startup reconciliation repairs eligible
  empty landed tasks while preserving real PR-opening failures for retry.

- Verification now succeeds only against the task worktree's exact inspected clean Git HEAD. Land
  approval requests, human approvals, initial landing, and landing retries re-check that HEAD and
  reject dirty or stale worktrees, preventing post-verification commits or edits from landing under an
  outdated approval.

- Added scoped PM change-review tools to inspect a task-owned worktree, commit selected paths or exact
  patch hunks, discard only explicitly selected changes, or return the work to a fresh worker attempt.
  Foreign paths and pre-staged commits are rejected, unselected changes remain pending for review,
  and every resolution invalidates stale verification before the task can continue.

- Work-agent completion now inspects the task worktree's exact Git HEAD and tracked/untracked status.
  Dirty completions atomically enter **Change review**, notify the PM exactly once across replay, and
  block verification until resolved. Work-stage instructions now explicitly require descriptive
  commits and a clean worktree before completion.

- Added durable Orchestrator completion records for pending worktree change review, successful
  verification bound to an exact Git HEAD, and terminal **No changes needed** outcomes. The new
  append-only events, projections, and migration survive replay and provide the lifecycle foundation
  for PM review actions and exact-commit landing enforcement.

## 0.3.0 - 2026-07-17

- Made GitHub release publication deterministic for manually dispatched releases by using the resolved
  version tag and commit directly, while preserving generated notes, strict cross-platform asset
  validation, metadata reconciliation, and safe retry uploads.

- Changed the first-use Codex chat default to GPT-5.6 Sol with medium reasoning and Standard service.
  Explicit provider, model, reasoning, and speed choices remain sticky across every new normal chat,
  including Claude Opus, while Claude-only setups retain Claude's provider-native defaults.

- Changed Codex orchestration workers from unrestricted full access to workspace-scoped writes with
  Codex automatic approval review. Claude and OpenCode workers remain full access, while PM and
  normal-chat permission behavior is unchanged. Granular permission requests and denied automatic
  reviews now pause for the owning PM, which is re-entered exactly once and can inspect and resolve
  only that task's still-pending requests under a least-privilege policy.

- Fixed Codex-backed project managers rejecting their own trusted orchestration ledger and task
  lifecycle calls behind an invisible approval prompt. GedCode now approves only its private,
  bearer-authenticated loopback orchestration MCP server while retaining the PM's read-only sandbox
  and normal approval policy for every other tool surface.

- Fixed unsent normal-chat drafts disappearing from view when switching to Orchestrator and back.
  The Chat toggle and a project's **Open in Chat** action now return to that project's existing draft
  before selecting a completed server thread or the empty chat home.

- Fix: Repair startup after the Orchestrator worker-role reduction by removing retired `classify` and
  `review` keys from persisted project/task role settings and their incompatible derived
  stage-history rows. Current writes remain strict, while historical append-only events remain
  untouched.

- Feature: Let Orchestrator projects and individual tasks choose a provider harness, model, and
  supported thinking/reasoning level independently for each `plan`, `work`, and `verify` worker. The
  shared picker includes configured custom models, preserves still-valid provider options across
  harness/model changes, removes stale options, shows effective inherited selections, and persists
  task overrides through the existing typed RPC.

- Breaking change: Simplify Orchestrator workers to `plan`, `work`, and `verify`. The PM now owns task
  classification and lifecycle control directly; plan critique is another bounded plan attempt and
  post-work review belongs to verification. Removed `classify`/`review` role values have no aliases or
  migration because the unreleased app has no user task ledger.

- Documentation: Add an artifact lifecycle and privacy guide distinguishing agent-authored `.ged/`
  workflow memory, app-managed workspace `.gedcode/` task worktrees, and durable user `~/.gedcode/`
  application state. Link it from the GED default setting and remove stale managed-subagent claims.

- Feature foundation: Persist per-thread normal-chat message queues with captured backend options,
  GED/runtime modes, attachments, stable idempotency identities, dispatch retry state, and a default-on
  queue preference. Active-turn sends now queue by default and drain one item after each settled turn;
  interrupted dispatches reuse the same identity, failures pause without hot-looping, and queue-off
  sends use the provider's existing live-steer path. Queue state remains isolated by environment and
  supports identity-preserving edit, delete, and status operations. Queued messages are shown above the
  composer with responsive Steer/Retry, Delete, inline Edit, and queue preference controls; disabling
  queueing leaves existing queued work intact.

- Feature: Add a typed normal-chat thread fork operation. Codex forks its native conversation and
  rolls back only the new copy when continuing from an earlier assistant turn; other providers use a
  fresh session with copied visible history. Both strategies preserve the source task and explicitly
  retain the current filesystem state rather than reverting files to the selected message. Completed
  assistant messages expose a **Continue in new task** action with pending/error feedback and navigate
  to the new task after creation.

- Feature: Restore lightweight per-thread GED mode for normal chats, enabled by default. GED turns add
  repository workflow and skill guidance to the provider prompt without changing stored messages,
  forcing role models, or starting managed subagents; explicit Normal mode remains unchanged. The
  composer now exposes a Normal/GED selector with an explanatory tooltip, persists draft overrides,
  and provides a global setting for the default used by new threads.

- Fix: Require a successfully completed Orchestrator verification stage newer than the latest
  successful work stage before landing can begin or open a pull request. Other stage ordering remains
  permissive so optional stages may still be skipped.

- UI: Complete Orchestrator context menus across project and task sidebars. Project rows now offer
  rename, orchestration settings, path copy, and state-guarded removal; task cards expose only the
  lifecycle actions valid for active, cancelling, terminal, or archived state, including cancellation
  directly from active cards.

- Feature/UI: Guard release-task publishing behind a content-matched human approval and one
  lifecycle-locked GitHub Actions dispatch. Dirty repositories are refused before any reservation,
  repeated calls cannot dispatch twice, and durable dispatching/dispatched/failed state plus the
  authoritative workflow URL survives replay and is visible to the PM and task detail.

- Feature: Register a dedicated Orchestrator `release` task type and built-in release-preparation
  playbook. Release tasks require durable provenance to exactly one visible, fully landed feature task
  in the same project; PM creation, replayed worker dispatch, and classification reject missing or
  premature sources, and publishing remains reserved for the guarded release actuator.

- Internal/Fix: Replace implicit feature-only task-type handling with a server-owned registry. Task
  config remains replay-compatible and extensible, while project writes, PM tools, task creation,
  splitting, classification, worker startup, and gate resolution reject unknown task types instead of
  silently inheriting the feature workflow.

- UI: Share project sorting between Chat and Orchestrator, including the same persisted sort mode,
  last-message and creation-time ordering, and manual drag order across environment-scoped projects.

- Fix: Persist unsent Orchestrator PM composer text per environment and project so navigation between
  Chat, Orchestrator, projects, and task routes no longer discards or cross-contaminates drafts.

- Feature: Group split Orchestrator tasks beneath one collapsible parent board card, preserve declared
  child order, summarize aggregate progress, and surface child attention without duplicate top-level
  cards.

- Improvement: Teach the Orchestrator PM to split only genuinely oversized work into bounded,
  independently verifiable children after the existing plan gate approves their complete structure.

- Feature: Add an atomic, idempotent Orchestrator `splitTask` operation for 2-8 ordered child slices with explicit acceptance criteria and acyclic earlier-child dependencies. Dependent workers cannot start before prerequisites land, and PM ledgers identify blocked children.
- Feature: Persist ordered parent/child Orchestrator task relationships and derive each parent task's terminal, landed, and abandoned child progress consistently through event replay and SQL projection rebuilds.
- Feature: Let the Orchestrator PM set validated provider options, including reasoning effort, alongside per-role worker backend overrides. Task ledgers expose the effective role selections, stage startup forwards the complete selection to providers, and PM policy distinguishes Terra/high medium work from Sol/high difficult or cross-cutting work when those backends are configured.
- UI: Show each Orchestrator stage attempt's effective worker permission mode in task history, backed by the mode resolved at stage start and preserved through event replay and SQL snapshots.
- Feature/UI: Record intentional Orchestrator task replacements as durable `supersedes`/`superseded by` links. PM task creation accepts a settled predecessor, rejects active, hidden, cross-project, or already-replaced predecessors, keeps the relationship through replay and SQL snapshots, and labels replacement state on the task board.
- Fix: Prevent newly started Claude Orchestrator PM turns from stalling on invisible shell approval requests. PM sessions now opt into the enforced read-only Claude policy, which permits built-in file/search, skill-loading, and orchestration tools without approval while immediately denying shell, mutation, and native-agent tools; the PM prompt now accurately delegates heavier exploration through bounded worker handoffs.
- Feature/UI: Make the shared left sidebar collapsible from visible desktop content-header controls across Chat, Orchestrator, empty-chat, and Settings surfaces. The existing off-canvas transition remains resizable while open, shows the correct open/closed icon, restores the last state from its persisted cookie after reload, and reserves the macOS window-control area whenever collapsing exposes an Electron titlebar.
- Breaking/Internal: Bound PM task-ledger context by returning compact task summaries with only the three most recent stage attempts instead of full task aggregates. Ledger responses and automatic settlement re-entry now carry last-action cursors so the PM can track progress without re-ingesting growing histories.
- Internal: Pin the Orchestrator thread reuse policy: each project keeps one deterministic persistent PM thread, steering reuses its selected stage attempt, and every stage start or retry creates a fresh worker thread linked through task stage history.
- Breaking/Fixed: Orchestrator worker stages now always run with full access, and the global/project `allowFullAccessWorkers` opt-ins have been removed. Legacy persisted keys still decode but are ignored and omitted on save. PM sessions no longer run full-access; they use the existing approval-required policy, which maps Codex PMs to the read-only/on-request sandbox.
- Fix/UI: Hide the active-task Plan and Gates sections until they contain a proposed plan or gate, removing misleading permanent “No proposed plan yet” and “No gates” cards.
- Fix: Make steering an active worker explicit across providers. Codex now uses app-server `turn/steer`, OpenCode reports live steering, Claude reports active-turn queuing, and durable worker activity distinguishes started, steered, queued, and rejected delivery. Codex steering rejection is surfaced without silently falling back to a new turn or interrupt/restart; this requires a Codex app-server version that supports `turn/steer`.
- Feature/Fixed: Add first-class Orchestrator worker interruption through PM/MCP, RPC, and task detail. Requests are durably acknowledged immediately, active provider turns are interrupted without waiting for the PM turn to finish, and provider-reported interruption/cancellation now settles the stage as interrupted instead of completed.
- Fix: Stop instructing Orchestrator PMs to poll worker stages. PMs now wait for existing event-driven stage, gate, quota, and interrupt re-entry, and use `inspectStage` only for explicit status requests or one bounded pre-action diagnostic.
- Fix: Make PM `createTask` retries idempotent with a required stable request key. Identical retries derive the same safe task ID, command receipt, and PM provenance ID; reusing a key with changed task content keeps the task identity but produces a distinct command that is rejected instead of silently aliasing different work.
- Feature/UI: Expose Orchestrator task archive, restore, and permanent-delete through PM/MCP tools, typed RPC actions, and terminal task-card context menus. Archived tasks have an on-demand board section, restore immediately rehydrates open clients without polling, and permanent deletion requires explicit confirmation.
- Feature: Add append-only Orchestrator task archive, restore, and permanent-delete tombstones. Retention changes are limited to abandoned tasks or landed tasks with a recorded pull request; active snapshots and PM ledgers omit archived/deleted tasks while replay and command state preserve their full history.
- Fix: Protect Orchestrator task worktrees from other GedCode runtimes that use a separate database for the same workspace by writing atomic filesystem ownership leases, renewing them while tasks remain live, and requiring both lease expiry and a grace period before orphan cleanup.
- Feature/UI: Retry exhausted Orchestrator PR-opening failures through the existing guarded `landTask` PM/MCP/RPC action and task-detail button; retries are serialized, reuse an existing open PR when present, preserve the worktree until success, and coalesce repeated requests while landing is in progress.
- Fix/UI: Persist Orchestrator task landing progress, exhausted PR-opening failures, branch-push state, and completion directly on the task projection so failures survive replay without a stage thread, remain visible after restart, and appear in the task board's Needs you section.
- Fix: Close the Orchestrator task-worktree reactor's startup scan/subscription gap by buffering live events before snapshot capture, replaying durable events after the snapshot cursor, and deduplicating overlap before PR creation and cleanup.
- Feature/UI: Land approved Orchestrator tasks from task detail through a typed client RPC, with exact gate eligibility, monotonic request progress, retryable request errors, pull-request opening/failure status, and the final PR link.
- Feature: Let the Orchestrator PM land a reviewed task through its shared Claude/Codex MCP tool after the latest land gate is content-matched and approved; landing is serialized against worker startup/cancellation and repeated calls are idempotent.
- Fix: Recover Orchestrator worker stages orphaned by a server restart by durably interrupting the stale attempt, clearing task ownership, notifying the PM exactly once, and allowing a fresh same-role handoff without misreporting completion or quota exhaustion.
- Fix: Resume durably reserved Orchestrator task cancellations during server startup, skip shutdown phases already checkpointed, and avoid resurrecting orphaned provider sessions merely to interrupt them.
- Fix: Atomically reserve Orchestrator task cancellation before worker shutdown, serialize cancellation against queued worker startup, durably checkpoint shutdown progress/failures for safe retry, and prevent direct abandonment or task progression from bypassing cleanup.
- Fix: Make Orchestrator cancellation side-effect free for landed and abandoned tasks, so terminal task history is never removed after completion.
- Fix: Orchestrator task cancellation now stops the active worker turn/session and closes stage terminals before dispatching `task.abandon`, surfaces typed shutdown failures without removing the worktree, and clears the abandoned task's active stage pointer in projections.
- Change: Use `~/.gedcode` as the default app data directory for fresh installs and copy existing default `~/.t3` data there on desktop startup, including the active legacy state directory when `~/.gedcode` already exists from earlier local/dev usage.
- Change: Treat orchestration as enabled for every project and remove the project enable toggle plus the stage-handoff resource limit from contracts, runtime enforcement, and settings logic.
- UI: Simplify Orchestrator settings by removing stage, gate-autonomy, and stage-handoff controls from the settings surfaces, leaving auto-created PR mode and operational limits, with safer operational defaults and working Orchestrator-sidebar project context menus.
- Internal: Raise ACP child-process integration test timeouts to reduce CI and release preflight flakes under runner load.

## 0.2.1 - 2026-07-09

- Fix: Repair stale projected Orchestrator project configs from the event log during upgrade so packaged 0.2.0 apps do not lose `enabled:true` and fail to start the PM runtime after selecting a PM model.

## 0.2.0 - 2026-07-09

- UI: The orchestrator can now add a project from the landing header and the orchestrator sidebar, reusing the same add-project flow as chat.
- Fix/UI: Run a dark-mode and spacing consistency pass across orchestrator surfaces; the update notification no longer overlaps the task board.
- Fix/UI: Markdown file tags with line suffixes now derive their file icon from the unsuffixed path, so links like `package.json:25` show the npm package icon instead of the generic file icon.
- UI: Switching between Chat and Orchestrator is now first-class. The sidebar "Orchestrator" toggle returns to your last-visited orchestrator project workspace (falling back to the project grid on first use or if that project no longer exists). A chat project row now has an "Open in Orchestrator" hover action next to "New thread", and the orchestrator workspace header has a symmetric "Open in Chat" button that lands on that project's most recent chat thread. In orchestrator mode the left sidebar swaps the chat thread list for an orchestrator project list — each row shows a needs-attention count (pending gates + blocked/quota), an active count, and a live pulse when any of the project's worker stage threads is running — while the Chat/Orchestrator toggle stays at the bottom. In chat mode, orchestrator-owned threads (PM chat and worker stage threads) no longer clutter the thread list; they remain reachable from the task detail view.
- UI: Orchestrator PM chat polish. PM lifecycle events now render as centered system-divider rows instead of generic work-log clusters — "PM handed off — <mode> · <time>" for harness handoffs, and quiet destructive-tinted dividers for PM turn failures and quota pauses. PM tool activities that genuinely carry a task id (createTask, handoffWorker, steerStage, inspectStage, cancelTask, …) now show a compact clickable task chip (task title when known, short id otherwise) linking straight to the task view. A fresh PM chat shows a proper empty state explaining what the PM is for and that its tasks appear on the board.
- UI: The Orchestrator task board is reorganized by concern instead of one section per status. A "Needs you" section surfaces tasks with a pending approval gate or a blocked/quota status (each with a reason chip); a single "Active" section holds every other in-progress task with a stage-role badge, a live pulse and elapsed time when its worker turn is running, and the worker model when known; "Landed" and "Abandoned" are collapsed count sections at the bottom. The header count now reflects needs-you + active only, the per-card `orchestrator/<uuid>` branch slug moved to the card tooltip, and section casing is consistent Title case.
- Fix: opening an orchestrator task now actually shows the task view (stage output, work log, gates) — the route never rendered before.
- Fix: tasks in a verify stage no longer disappear from the task board.
- Fix: Codex-driver orchestrator PM sessions no longer go silent after starting. The session's runtime event pump was forked into the caller's short-lived scope and died the moment the PM runtime finished building — codex would run the turn and answer into an unread pipe. The pump now lives in the session-owned scope, and if the PM's event bridge ever ends mid-turn the turn fails loudly instead of spinning forever.
- Feature/UI: The orchestrator PM can now run on Codex. The PM model picker offers Claude and Codex instances, and switching the PM across harnesses triggers the handoff dialog for real — hand off the conversation as a full transcript or summary brief, or start fresh. Traits follow the selected instance's driver.
- Internal: The orchestrator PM runtime now accepts Codex provider instances alongside Claude — driver-neutral adapter wiring, session reset/clear, provider stamping, and a Codex-conditional PM prompt (decisions asked in plain text since Codex's interactive-question tool is unavailable outside plan mode). The PM model picker remains Claude-locked until the web unlock lands.
- Internal: The orchestrator PM event bridge now understands Codex MCP tool-call items, so orchestration tool activity surfaces identically in the PM chat regardless of the PM's harness.
- Internal: Codex sessions now honor `systemPromptAppend` (injected as `developerInstructions` on thread start/resume) and `enableOrchestrationTools` — the orchestration MCP tools are served over a loopback streamable-HTTP endpoint (bearer-token protected, same tool executors as the Claude in-process server) and attached to Codex sessions via the per-session thread/start config overlay. Groundwork for running the orchestrator PM on Codex.
- UI: Switching the Orchestrator PM to a different harness now asks whether to hand off the conversation as a full transcript, hand off a summary brief, start fresh, or cancel. Same-harness model changes stay silent; the picker remains inert for non-Claude PM harnesses until those harnesses unlock.
- Internal: Add server-side Orchestrator PM harness handoff machinery. The PM conversation can be handed to a new PM session as a full transcript or a summary brief with transcript fallback, keeping the same PM thread and laying groundwork for switching PM harnesses.
- Internal: Remove the per-thread `gedWorkflowEnabled` field from orchestration contracts and projections. Old append-only events that still contain the field remain replayable because unknown payload properties are ignored during decode.
- Internal: The server-side ged workflow subsystem (turn guard/interceptor, event reactor, role prompts, gedWorkflowGetState RPC) and the @t3tools/ged-workflow package are removed, along with the ged settings fields and the ProviderSendTurnInput.gedWorkflowEnabled contract field. Orchestrator stage machinery (roles, role model selections, prompt prefixes, playbooks) is unaffected.
- Change/UI: Normal chat threads no longer have a "Ged workflow" mode — the toggle, its drafts/settings plumbing, the "Ged orchestration" settings section, and the ged main-thread model override are removed. The orchestrator view is the workflow surface.
- Internal: Fully remove the legacy pi agent stack: adapter, OAuth flow, provider catalog/settings, and the vestigial PM auto-compaction trigger are gone. PM context compaction is handled by the native harness, while legacy pi-era `pmModelSelection` values remain replayable.
- Fix/UI: The Orchestrator task-board count no longer includes abandoned tasks, and abandoned tasks are now viewable from a collapsed read-only section.
- UI: The Orchestrator PM chat model picker now includes the thinking/effort traits picker.
- Internal: `inspectStage` now returns a live tail of the worker stage, including recent messages, recent activities, turn elapsed time, and latest token usage.
- Internal: The Orchestrator PM can now steer running worker stages by sending messages into their threads with `steerStage`, reusing the same `thread.turn.start` path as human chat messages.
- UI: The Orchestrator PM chat now uses the standard provider/model picker for Claude-driver PM models, and the PM prompt now directs heavier exploration through native subagents instead of dedicated exploration tasks.
- UI: The Orchestrator PM can now ask interactive questions in PM chat with clickable options like worker sessions instead of stalling, and pending PM questions clear when the PM turn aborts.
- Change: The Orchestrator PM now runs with full tool access and no approval prompts. Its system prompt now steers it to keep PM responsibilities in-process, delegate implementation to work agents, use native subagents for heavier exploration, and request plan-review second opinions when useful.
- Fix: The Orchestrator PM chat send button no longer stays disabled when the chat opens before the environment connection is ready.
- Fix: Clearing a chat now also clears its persisted activity feed, so old tool calls and failure notices no longer reappear in a cleared PM chat.
- Fix: Clearing the Orchestrator PM chat can no longer resurrect pre-clear messages or activities on reconnect/resubscribe, and stale replayed session or turn state can no longer block the PM composer.
- Fix: Prevent Orchestrator PM chat replies from rendering with missing text spans and stop Claude worker sessions from losing runtime events while the PM is active. The PM now subscribes to the provider event broadcast instead of competing with the provider pipeline for the Claude adapter's single-delivery event queue.
- Fix: Keep Orchestrator PM chat projection stable across PM runtime rebuilds. PM projection command/message/turn ids now include a per-runtime nonce so the first PM message after a clear or restart no longer disappears, assistant completion cannot create new "(empty response)" bubbles from dropped deltas, and PM provider runtime events are no longer double-projected by the generic ingestion path.
- Fix: Prevent Orchestrator PM turns from staying Running after abnormal Claude-driver endings or PM runtime teardown. Aborted Claude PM turns now emit a terminal settle signal, PM projection teardown best-effort marks active turns ready, PM session projection records the Claude driver kind instead of the provider instance id, and Clear PM chat resets the persisted Claude PM binding to a stopped status with its resume cursor cleared.
- Fix: Keep fresh Orchestrator PM chats and live PM turns in sync. Subscribing to a not-yet-created PM thread now stays live for the first message, PM turn lifecycle events now clear the Running indicator even for tool-only turns, and streaming message replay no longer drops deltas when a snapshot watermark is ahead of the message content.
- Fix: Make Clear PM chat reset the Claude driver PM session as well as visible PM messages, clearing the persisted resume cursor so the next PM turn starts fresh instead of resuming prior Claude history.
- UI: Expose Orchestrator task cancellation through `orchestrator.cancelTask`, the PM `cancelTask` MCP tool, and a destructive task-header action. Cancellation reuses the existing `task.abandon` terminal transition and clears any pending gates for the abandoned task.
- Fix: Keep Orchestrator PM chat live rendering in sync with refresh state. Tool-only PM turns no longer append an empty assistant bubble, stale thread/project snapshots can no longer erase newer live PM messages or completed worker activities, and subscription streams replay events committed between the snapshot read and live subscription attachment.
- Fix: Actually apply the Orchestrator PM system prompt to the Claude session. The PM's role/delegation instructions were built but never sent — the Claude adapter always used the bare `claude_code` preset — so the PM behaved like a generic read-only assistant (asking the human to enable Bash) even though its orchestration tools were connected. Session start now carries an optional `systemPromptAppend` that the Claude driver appends to the preset, and the driver-PM passes the PM prompt through it.
- Fix: Strengthen the Orchestrator PM system prompt so the PM delegates instead of answering directly. It now states the PM orchestrates and never does the work itself, is read-only by design, and that workers have full tool access (shell/network/edits) — so any request needing execution/inspection/changes becomes a task handed to a worker rather than a read-only guess or a request for the human to run commands.
- Fix: Run the read-only Claude Orchestrator PM in `default` permission mode instead of `plan` mode. Plan mode made the PM research-and-propose (presenting a plan via ExitPlanMode and stopping) rather than invoking its orchestration tools, so the workflow never started and turns surfaced as "(empty response)". Read-only is still enforced by the tool allow/deny lists plus the `canUseTool` default-deny.
- Fix: Wire read-only Claude Orchestrator PM sessions to the in-process orchestration MCP server through a root late-bound provider, so PM turns can start with orchestration tools after the engine-side runtime registers the shared MCP config.
- Fix/UI: Surface Orchestrator PM driver-turn failures directly in the PM conversation as error activities with classified quota/rate-limit/auth/abort wording where detectable, and replace the PM chat composer with a focused text input plus read-only PM model label instead of inert chat model/runtime/workflow controls.
- Internal/UI: Swap the Orchestrator PM brain from legacy PM model selection to worker provider-instance model selection. The PM now resolves a Claude provider instance and runs through the Claude DriverPmAdapter, with legacy pi-era PM selections replaying as unconfigured and non-Claude PM instances failing clearly until Codex support lands.
- Internal: Add an additive Claude-driver Orchestrator PM adapter that starts read-only Claude sessions with the in-process orchestration MCP server, bridges Claude runtime events into the existing PM event projection, and persists Claude resume cursors for future PM runtime wiring without changing PM model selection yet.
- Internal: Add the Claude-driver foundation for a read-only Orchestrator PM. Claude sessions can now opt into an injected in-process MCP server for Orchestrator PM tools, and an enforced read-only policy uses Claude Agent SDK plan mode plus explicit built-in tool allow/deny lists so mutating tools such as Write/Edit/MultiEdit/Bash are unavailable.
- UI: Add a Clear PM chat action to Orchestrator project PM chat. The human-origin `orchestrator.clearPmChat` RPC appends an append-only `thread.cleared` event for the project PM thread, clears legacy PM session rows, and invalidates the in-memory PM runtime so the next PM turn starts with fresh visible messages, session memory, and runtime state.
- UI: Add a global Orchestrator default worker backend and show each stage picker's resolved default backend so inherited worker routing is visible.
- Fix: Keep Orchestrator mode sidebars focused on projects and Orchestrator navigation by hiding regular chat thread lists, and exclude PM threads from regular sidebar chat lists.
- Fix: Let the Orchestrator PM runtime inherit the global PM model default when a project leaves its PM model selection unset, while keeping the orchestrator enabled flag project-only.
- Fix: Surface each human message sent to the Orchestrator PM immediately in the PM conversation while keeping settlement and quota re-entry prompts out of the visible user-message timeline.
- Fix: Scope the Orchestrator PM system prompt to its project (project id, title, workspace root) and instruct the PM to operate on that project instead of asking the human for a project or repo id.
- Fix: Preserve sparse Orchestrator project config during event replay while normalizing only legacy worker-shaped PM model selections to an unconfigured PM.
- Internal: Add real-engine Orchestrator landing integration coverage for the human-approved land gate opening a mocked PR, resolving draft/ready configuration, failing loud without a supported source-control provider, and avoiding duplicate PR opens for tasks that already recorded a PR URL.
- UI: Surface the Orchestrator landing PR draft/ready setting in global defaults and per-project inherited overrides, and show a "View PR" link on landed task details when landing recorded a pull request URL.
- Internal: Add Phase 5 Orchestrator landing contracts for real PR creation. Orchestrator config now carries inheritable `openPrAsDraft` defaults, tasks expose `prUrl`, and the internal `task.pr.opened` command records a `task.pr-opened` event without wiring the landing reactor yet.
- Internal: Wire Orchestrator task landing to push the task branch with server git credentials, open a gated GitHub/GitLab PR or merge request after the approved land gate, record the resulting `prUrl` durably, and leave failed landings surfaced with the worktree intact for retry.
- Internal: Add real-engine Orchestrator integration coverage proving sparse projects inherit live `ServerSettings.orchestratorDefaults` for gate policy, enabled stages, and stage handoff limits, while explicit project overrides win and `land` never auto-resolves.
- Fix: Make the project Orchestrator settings editor write sparse project overrides. Project stages, gate autonomy, and resource limits now render as "use global" versus explicit override, save only explicit project keys, never write `land` as an override, and no longer seed unconfigured projects from global defaults.
- Fix: Make server-side Orchestrator global defaults live in the decider. Sparse project config now resolves guarded stages, gate policies, and resource limits as project-explicit value -> `ServerSettings.orchestratorDefaults` -> safe constant, while fully configured projects continue to use their own values.
- Fix: Apply Orchestrator PM model changes to a running PM immediately when the provider instance is unchanged by serializing the switch through the PM re-entry queue; provider-instance changes now safely invalidate the cached PM runtime so the next use rebuilds with the new backend.
- Fix: Allow persisted Orchestrator `task.role-selections-updated` events to decode `pm-runtime` origins, matching the Phase 4 decider path that lets the PM set per-task backend overrides while still keeping gate resolution human/client-only.
- Internal: Add Orchestrator mode Phase 4 integration proofs for gate autonomy, stage toggles, built-in playbook snapshots, PM-origin per-task backend overrides, and restart replay durability through the real engine/projector/reactor pipeline.
- Internal: Wire the built-in Orchestrator `feature` playbook into the PM harness as a skill resource and snapshot the loader-resolved deterministic `playbookVersion` during PM classification, so tasks record the actual built-in playbook version that guided classification.
- Internal: Add a source-agnostic Orchestrator playbook loader and bundled built-in `feature` playbook. The loader parses playbook frontmatter, maps it to the PM resource shape, and produces deterministic `builtin:<sha256-prefix>` playbook versions without wiring the resources into the PM runtime yet.
- UI: Add a persisted task-board visibility toggle to the Orchestrator project view so the PM chat can use the full width when the board is hidden.
- UI: Add global Orchestrator defaults under Settings → Orchestrator. Operators can set default stages, gate autonomy, resource limits, PM reconciliation cadence, and worktree cleanup cadence; projects without explicit overrides inherit these defaults live.
- UI: Extend the project Orchestration settings dialog with HARD Orchestrator config editing. Humans can now toggle project orchestrator mode, choose or clear the PM model, enable optional review/verify stages, set classify/plan/work/review gate autonomy while keeping land approval-only, and edit resource limits; saves continue through one human-origin `project.meta.update` with a sparse replace-wholesale Orchestrator config plus the existing role backend/prompt-prefix maps.
- Internal: Move Orchestrator mode per-task backend selection to the PM tool surface. The PM can now set a task's stage-role backend/model with `setTaskBackend`, dispatching the existing `task.role-selections.set` command as `pm-runtime` while preserving other role selections; gate resolution and runtime-mode controls remain human/client-only. The task-detail "Backends..." dialog was removed, while the human-origin websocket RPC remains available for non-dialog callers.
- Internal: Enforce Orchestrator mode task-type stage toggles in `task.stage.start`. The default `feature` pipeline now allows the full canonical stage set (`classify`, `plan`, `review`, `work`, `verify`), while per-type configs can opt out of optional stages; a worker handoff for a role omitted from the task type now fails as a decider invariant before model selection or event emission.
- Internal: Wire Orchestrator mode gate autonomy into the decider. Task-type gates with resolved policy `auto` now emit the normal `task.gate-requested` event followed immediately by an internal `system`-origin approved `task.gate-resolved` event bound to the same content hash, while `land` remains human/client approval-only and external `pm-runtime` gate resolution stays rejected.
- Internal: Add a pure `@t3tools/shared/orchestrator` config resolver for Orchestrator mode Phase 4. It resolves task-type gate policies and resource-limit layers (`project` -> `ServerSettings.orchestratorDefaults` -> safe constants).
- Internal: Extend Orchestrator mode Phase 4 contracts for gate autonomy without wiring runtime behavior. Gate policy now covers `classify`, `plan`, `work`, `review`, and terminal `land`, with `land` schema-pinned to `require-approval`; the gate-resolution origin schema can represent internal `system` resolutions for later decider-emitted approvals.
- UI: Add a per-task backend override editor for Orchestrator mode (tracking epic #51 / WP-P6.3). A "Backends…" button on the task-detail header opens a dialog to override, per stage role, which provider backend + model that task runs on — each role's "use default" option shows the backend it would otherwise inherit (the project's per-role selection, else the project default). Saves through the dedicated human-origin `orchestrator.setTaskRoleSelections` RPC (the server stamps origin/createdAt), never the generic client command channel. The per-role backend picker is now a shared `RoleBackendPicker` used by both the project and task editors; the project editor adds the prompt-prefix field on top.
- Internal: Add the dedicated Orchestrator mode `orchestrator.setTaskRoleSelections` websocket RPC (tracking epic #51 / WP-P4.2). The method accepts `{ taskId, roleModelSelections }`, validates the role-keyed backend/model selection contract, stamps `origin: "human"` and `createdAt` server-side, and dispatches `task.role-selections.set` through the decider. The typed `wsRpcClient` and `environmentApi.orchestrator` now expose the helper for the upcoming per-task backend override UI, without adding the raw task mutation to the generic client command channel.
- UI: Add a project Orchestration settings editor for Orchestrator mode (tracking epic #51 / WP-P6.1-P6.2). A new "Orchestration settings…" item on the sidebar project context menu opens a dialog to choose, per stage role (classify / plan / review / work / verify), which provider backend + model that role runs on (or "use project default") and an optional per-role prompt prefix. The editor seeds from the project's current config and saves via a single human-origin `project.meta.update` that replaces both config maps; roles left on the default and blank prefixes are omitted. The per-task backend override UI remains in WP-P6.3 and will use the dedicated `orchestrator.setTaskRoleSelections` helper instead of exposing the raw task mutation through the generic client command channel.
- Internal: Add Orchestrator mode Phase 3 P7 integration proofs for the full multi-role pipeline and restart durability. A new server integration suite drives `classify -> plan -> review -> work -> verify -> land` end-to-end, confirms backend selection precedence (`task` override -> project role -> default), rejects PM-origin task role selection updates in the live engine path, and proves per-role prompt prefixes are applied exactly once across quota block and deterministic auto-resume. The same harness now reloads an existing SQLite/root directory to prove blocked stage history, per-task role overrides, and pipeline position rebuild after restart before auto-resuming from a provider quota-ok signal. Test harness utilities now support restart reuse, multi-instance fake provider aliases, broadcast runtime events, and deterministic reactor draining for these proofs.
- UI: Show a stage timeline on the Orchestrator mode task-detail view (tracking epic #51 / WP-P5.2). The task rail now lists the task's pipeline stages (classify → plan → review → work → verify) in start order, each with its role, the backend instance + model it ran on, and a live status chip (running / completed / blocked). Seeded from the task/project snapshot and kept live by streamed stage events; hidden until the first stage starts.
- Internal: Stamp the resolved backend/model on the Orchestrator mode `task.stage-started` event and carry per-task stage history into the web store (tracking epic #51 / WP-P5.1). The decider now records the resolved `providerInstanceId`/`model` directly on the stage-started event (optional fields for append-only compatibility), so the stage-history projection and the web timeline reflect what actually ran without re-resolving config; both projections fall back to re-deriving from config for events appended before the fields existed. The web store keeps a per-task stage-history slice live — seeded from the project/task snapshot and updated by streamed `task.stage-started`/`-completed`/`-blocked` events — exposed via `selectTaskStageHistoryByRef` for the upcoming stage-timeline UI.
- Internal: Add the Orchestrator mode Phase 3 engine foundation for multi-stage roles and multi-backend selection (tracking epic #51 / WP-P1-P3). Contracts now include `review` and `verify` worker roles, a `reviewing` task status, stage-role-keyed backend/model and prompt-prefix config maps that reject unknown role keys, per-task role model overrides, and a durable stage-history snapshot shape. The server resolves worker backend/model selection as task override -> project role default -> project default, enforces human/client-only task role override updates, persists role prompt/override state and stage-history rows, and writes stage history for running/completed/quota-blocked stages. Per-role prompt prefixes are applied exactly once, including quota-resumed stages that reuse original instructions. The PM handoff tool and system prompt now know about the new roles, and the web store/snapshots carry the new config and stage-history data for the later UI lane.
- Fix: Tighten Orchestrator mode subscription-quota handling after review. Provider `warning` telemetry now remains non-blocking (only `exhausted` telemetry and classified `rate_limit` failures park an instance), so near-limit but still usable backends are not prematurely gated. Worker `task.stage-blocked` events now re-enter the PM through the durable settlement path, making quota pauses PM-visible exactly once, and the quota resume sweep isolates per-stage dispatch failures so one over-retried blocked row cannot prevent later eligible stages from resuming. The project subscription snapshot now exposes PM-provider quota state and the web renders a project-level PM quota banner that seeds from snapshots, updates live from PM `quota.paused` activity, and clears when the PM resumes messages. The PM quota read fail-open behavior remains the approved fallback so transient projection defects do not wedge PM re-entry.
- UI: Surface PM-brain quota exhaustion in the PM conversation timeline (tracking issue #43 / WP-Q7). When the PM's own turn fails on quota (the WP-Q5 self-detection path), the runtime now appends a calm info-tone `quota.paused` activity to the PM thread, so the PM workspace shows "Paused — `<backend>` usage limit reached" live instead of the project silently stalling. This closes the dedicated-PM-instance gap, where no worker-stage badge would otherwise indicate the pause. Best-effort (a failed marker never masks the original turn error) with deterministic ids (one marker per block episode; the re-entry gate then holds further turns until recovery).
- UI: Add a calm "paused — usage limit reached" timeline entry when an Orchestrator mode worker stage is parked on quota (tracking issue #43 / WP-Q7). When a worker turn fails on a rate-limit, the runtime now appends an info-tone `quota.paused` activity to the stage thread alongside the block, so the task work log explains the pause instead of going silent. Deterministic activity/command ids keep it exactly-once across retries (engine command-receipt dedup + projector activity dedup). Admission-gate blocks — where no worker turn ran, so there is no in-progress timeline — are surfaced by the task status and the reset-time badge rather than a timeline entry.
- UI: Surface the subscription-quota reset time on Orchestrator mode tasks (tracking issue #43 / WP-Q7). The orchestrator project subscription snapshot now carries `quotaBlockedStages`, and the web keeps a per-task quota-block index live from the streamed `task.stage-blocked` (set) / `task.stage-started` (clear) events. A calm "Quota · resets ~HH:MM" badge now appears on `blocked-on-quota` task cards (the board swim lane) and the task-detail header, falling back to "Quota-blocked" when no trustworthy reset time is known (e.g. a `blocked-unknown` instance). Complements the already-shipped blocked-on-quota status surfacing.
- Internal: Add Orchestrator mode auto-resume-at-reset for quota-blocked provider instances (tracking issue #43 / WP-Q6 — the staged "(A)" layer). The PM reconciliation sweep now optimistically clears a `blocked-until` instance back to `ok` once its parsed reset time (`resetAt`) has elapsed, so the existing resume + worker-start admission paths re-drive its blocked stages without waiting for fresh provider telemetry or an operator. Only `blocked-until` qualifies — a trustworthy reset time, confirmed present on both Codex and Claude in the WP-Q1 spike; `blocked-unknown` (no reset, e.g. a PM self-detected block) is left for telemetry/operator recovery. Optimistic and self-correcting: if the quota is not actually replenished, the next turn re-marks the instance blocked, bounded by `maxRetriesPerStage`. Resumption rides the existing `pmReconciliationIntervalMs` sweep (no separate scheduler), and a new `t3_orchestration_quota_reset_cleared_total` counter tracks how many instances were cleared this way.
- Internal: Add Orchestrator mode subscription-quota observability metrics (tracking issue #43 / WP-Q7). New `t3_orchestration_quota_*` metrics, emitted from the PM reconciliation sweep alongside the existing WP-6 durability metrics: gauges for the number of provider instances and worker stages currently parked on quota (sampled once per sweep so they track recovery back to zero), a counter for stages re-driven after their instance recovered, and a timer for how long a stage sat blocked. Instrumentation-only — the metric taps are wrapped so a recording error can never break the resume/sweep. The blocked-on-quota task status is already surfaced in the web UI (a dedicated task-board swim lane plus the task-detail status badge); richer surfacing (reset-time badge, a project banner when the PM instance is blocked, and a calm "paused — usage limit reached" timeline entry) is deferred — it requires plumbing the per-instance quota status and `quotaBlockedStages` through the project-snapshot contract and web store, plus a new per-instance exposure for the PM banner, which is a cross-cutting server+web change rather than a metrics tap.
- Internal: Handle Orchestrator mode PM-brain subscription-quota exhaustion (tracking issue #43 / WP-Q5). The PM ("project manager") runs on its own provider instance; when that instance runs dry the whole project would otherwise stall while the re-entry loop kept prompting a dead PM. The PM re-entry path now gates on the per-instance quota projection (WP-Q2): while the PM's `providerInstanceId` is quota-blocked, a settlement is held _before_ it is consumed (live) or re-driven (sweep), so nothing is prompted and nothing is consumed — the existing reconciliation sweep re-drives the un-consumed/pending settlement once the instance recovers, preserving exactly-once PM re-entry. Because a PM turn failure surfaces as a `PmRuntimeError` (not a `runtime.error` provider event) it bypasses the ingestion-path detection that marks worker instances blocked, so the PM re-entry queue now classifies a failed turn via `classifyRuntimeErrorClass` and marks the PM instance quota-blocked itself. A quota-projection read error fails open (treats the PM as available) so a transient DB hiccup can never wedge the project. No new domain event — the PM-blocked state is derived from the per-instance projection (project-wide blast radius), surfaced to the UI in WP-Q7.
- Internal: Complete Orchestrator mode subscription-quota handling for provider instances and worker stages (tracking issue #43 / WP-Q2-Q4). The server now maintains a per-`providerInstanceId` quota-status projection (`ok`, `blocked-until`, `blocked-unknown`) from `account.rate-limits.updated` telemetry and classified `runtime.error` rate-limit failures. Active worker stages can be parked through the new internal `task.stage.block` command and `task.stage-blocked` event, deriving a `blocked-on-quota` task state plus durable blocked-stage projection rows keyed by the original stage thread. `ProviderCommandReactor` now gates worker starts before provider session/worktree startup when the selected instance is quota-blocked, and runtime ingestion parks active stages on rate-limit errors. When quota telemetry explicitly transitions back to `ok`, blocked stages are re-driven through `task.stage.start` using the original stage instructions and deterministic command IDs; the PM reconciliation sweep also resumes eligible blocked stages after restarts. `maxRetriesPerStage` is now part of orchestrator resource limits and caps repeated quota resumes.
- Internal: Lay the foundation for Orchestrator mode subscription-quota handling (Phase 3, tracking issue #43 / WP-Q1). The `account.rate-limits.updated` runtime event previously discarded its payload as `Schema.Unknown`; it now carries a normalized, backend-agnostic `AccountRateLimitsUpdatedPayload` (`status: ok | warning | exhausted | unknown`, an optional epoch-ms `resetAtEpochMs`, per-window snapshots, and the preserved `raw` payload), and `RuntimeErrorClass` gains a `rate_limit` member so quota-exhaustion failures are identifiable rather than opaque `provider_error`s. A new pure, SDK-agnostic `apps/server/src/provider/rateLimits.ts` is the single home for this logic — `mapCodexRateLimits`/`mapClaudeRateLimits` normalize each backend's native shape (Codex `primary`/`secondary`/`individualLimit` windows + `rateLimitReachedType`; Claude `rate_limit_info` `status`/`utilization`/overage), `normalizeEpochToMs` disambiguates seconds-vs-milliseconds reset timestamps with a year-2001 threshold, and `classifyRuntimeErrorClass` conservatively upgrades a runtime error to `rate_limit` only on a known quota/429/`resource_exhausted` pattern. Both provider adapters now populate the structured payload and route their hardcoded `provider_error` sites through the classifier. Foundational only — no consumer acts on the signal yet (per-instance projection, blocked-stage state, and resumption land in later WPs). Spike outcome: both Codex (`resetsAt`, including a required `individualLimit.resetsAt`) and Claude (`rate_limit_info.resetsAt`) carry trustworthy reset timestamps, so auto-resume-at-reset (WP-Q6) is feasible.
- Docs: Record Orchestrator mode Phase 2 (durability and safety hardening, tracking issue #35) as fork-original work in `docs/upstream-decisions.md`, marking the work-package set (SQLite hardening, stage-completion gating, two-phase settlement recovery + reconciliation sweep, the `StageResultBuilder` diff envelope, the worktree reaper, durability metrics, and queue-contention measurement) complete in this fork.
- Internal: Capture the worker's code diff in the Orchestrator mode PM re-entry envelope via a new bounded, secret-scrubbed `StageResultBuilder`. A completed worker stage previously fed the PM only flat assistant text; the PM now also receives a structured, clearly-delimited diff section so it can reason over the actual code changes. The diff is read from the checkpoint/projection (`CheckpointDiffQuery.getFullThreadDiff` keyed off `ProjectionSnapshotQuery.getFullThreadDiffContext.latestCheckpointTurnCount`), never from the worker agent directly, and is treated as untrusted: the assistant text and the diff patch each ride the one shared `boundUntrustedContent` scrub+cap helper (now extracted to `orchestration/untrustedContent.ts` so the builder and `PmRuntime` share a single redaction implementation), and the assembled envelope is bounded once more so the combined message cannot exceed the documented limit. A one-line "N files changed" summary is derived from the patch. A diff that is missing, empty, or fails to read (`CheckpointServiceError`) degrades to a no-diff section and logs a warning — it never fails the settlement, and the human gate-resolution re-entry path is unchanged. Builder runs as a pure read-only step before the consume+cursor transaction, so exactly-once PM re-entry is preserved.
- Internal: Add Orchestrator mode command-queue contention measurement (instrumentation only — no change to the engine's single-queue dispatch serialization or any runtime behavior). A pure `classifyOrchestrationCommand` classifier labels each dispatched command (`streaming`/`turn`/`thread-control`/`project`/`task`), and two new histograms — `t3_orchestration_command_queue_depth` (queue depth sampled at offer time) and `t3_orchestration_command_queue_wait_duration` (milliseconds an envelope waited before the serialized worker picked it up) — are emitted around the existing dispatch path. The data is intended to inform a future lane-split decision; it does not split lanes or alter dispatch ordering today.
- Internal: Add Effect Metrics observability to the Orchestrator mode durability paths (instrumentation only, no control-flow or semantics change): the PM reconciliation sweep (run count, duration, and settlements re-driven), PM re-entry turn latency, the SQLite busy/locked write retry (attempts and budget exhaustions), and the worktree reaper (worktrees removed, labeled by `terminal`/`orphaned` cleanup reason). New `t3_orchestration_*` metrics are defined alongside the existing orchestration metrics in `observability/Metrics.ts`.
- Fix: Close the Orchestrator mode PM re-entry liveness gap by adding a two-phase `pending` -> `acted` settlement marker, migration 038, and a configurable PM reconciliation sweep that re-drives stalled settlements through the existing single-writer PM re-entry queue.
- Fix: Add a configurable Orchestrator mode task-worktree reaper (`worktreeReaperIntervalMinutes`) that periodically scans deterministic task worktree directories and removes leaked worktrees with no live task owner.
- Internal: Add server persistence migrations 033–037 for Orchestrator mode — task projection (`projection_tasks`), PM re-entry reconciliation sources (`projection_awaited_stages`, `projection_pending_gates`), legacy PM session tables (`pm_sessions`, `pm_session_entries`), exactly-once PM re-entry bookkeeping (`pm_runtime_cursor`, `pm_consumed_settlements`), and an `orchestrator_config_json` column on the project projection. Additive DDL only; no backfill, no event-log mutation, and no user-facing behavior until the feature is wired up.
- Internal: Advance Orchestrator mode server foundations with derived task/pending-gate projections, task command invariants, human-only gate resolution checks, max active task-worktree guards, terminal task worktree cleanup/pruning, worker runtime-mode clamping, task worktree/push-hook bootstrap, secret-stripped worker session environments, host-wide worker start admission, startup reconciliation for orphaned task-stage turns, internal worker stage-completion events, PM command tools that dispatch through the decider, deterministic PM-thread projection, orchestrator WebSocket RPCs for PM messages, project/task subscriptions, and human gate resolution, an exactly-once PM cursor/settlement repository, and a restart-replay PM runtime that uses durable project cursors, buffers live settlements behind historical catch-up, and feeds bounded redacted worker/gate settlements back to the PM queue exactly once.
- Internal: Add a mocked Orchestrator mode thin-slice E2E proof covering task creation/classification, one detached work-stage handoff, human-only plan and land gates, exactly-once PM re-entry across a restart-window replay, secret redaction in the PM worker-result envelope, and terminal task landing.
- UI: Add the first Orchestrator mode web surfaces: a persisted Chat/Orchestrator mode switch, `/orch` project grid, project PM workspace with task board, task detail with shared timeline rendering, the shared PM composer, proposed-plan and diff panels, gate approval controls, orchestrator RPC pass-throughs, and ref-counted project/task subscriptions feeding task and pending-gate store selectors.
- Fix: Scrub secrets and length-bound the Orchestrator mode gate-resolution settlement before it reaches the prompt-injectable PM. The human-gate re-entry envelope — which embeds the human-controlled, unbounded `task.title` (and the free-form `approvedHash`/`gateId`) — previously bypassed the `boundUntrustedContent` redaction/length cap that the worker-stage envelope already used; both PM re-entry settlement messages now ride the same bounded, redacted path.
- Docs: Document the Orchestrator mode PM re-entry durability ordering as a deliberate at-most-once design. The consumed-settlement marker and project cursor commit in one transaction _before_ the side-effecting PM turn, which guarantees a crash can never replay a settlement into a second PM turn (no double-dispatch) at the cost of a recoverable liveness gap — a crash in the post-commit/pre-act window stalls the owning task until an operator re-issues the human action. Automatic reconciliation is deferred pending a durable two-phase (pending → acted) record the single-marker schema cannot express.
- Docs: Correct the `orchestratorDefaults.maxParallelWorkers` comment to describe it accurately as the host-wide worker _start-admission_ throttle. The permit is released the moment `startSession` returns, so it bounds concurrent worker _starts_ (smoothing the startup/replay thundering herd), not the number of workers _running_ concurrently. The running-worker ceiling is the pure decider — `maxParallelTasks` (active task worktrees) plus the single-active-stage-per-task invariant — which a prompt-injected PM cannot exceed.
- Internal: Pin the Orchestrator mode PM re-entry queue serialization invariant with a regression test and a clarifying comment. Because the PM adapter's blocking `prompt` holds the single drain permit for the whole turn, a settlement that arrives mid-turn is buffered and rides the next batched `prompt` rather than racing into the busy-adapter `follow-up` fallback (review finding L2).
- Fix: Gate Orchestrator mode stage completion on a real captured diff. A worker stage previously completed the instant `turn.completed` arrived, before the worktree diff was captured, so the PM could re-enter with a not-yet-persisted diff. The stage now completes only once `CheckpointReactor` confirms a real captured diff (any `status !== "missing"` checkpoint, including an empty-but-captured `files: []` diff; genuine no-op turns no longer block), with a hard-coded 30s fail-loud diff-wait timeout in the runtime ingestion path so a stage can never stall (e.g. a non-git workspace) — the timeout completes with `diffComplete: false`. Both paths dispatch the same deterministic command id, so the engine's command-receipt dedup makes PM re-entry exactly-once (whichever path commits first wins, the other dedups) with no in-memory latch, surviving restarts.
- Fix: Harden SQLite against concurrent-writer contention now that Orchestrator mode runs multiple persistence writers (PM runtime, projection pipeline, session/task/checkpoint stores) against one database. Every connection now sets `PRAGMA busy_timeout` so SQLite blocks for a bounded window before surfacing a lock error, and each write transaction is wrapped in a jittered, bounded retry that fires _strictly_ on `SQLITE_BUSY`/`SQLITE_LOCKED` — never on constraint, syntax, or any other failure, since retrying a non-transient error is unsafe. The retry re-runs the whole rolled-back transaction, preserving atomicity; reads are intentionally left unwrapped. The busy window, initial/maximum backoff, and attempt count are tunable via `T3CODE_SQLITE_BUSY_TIMEOUT_MS`, `T3CODE_SQLITE_RETRY_INITIAL_BACKOFF_MS`, `T3CODE_SQLITE_RETRY_MAX_BACKOFF_MS`, and `T3CODE_SQLITE_RETRY_MAX_ATTEMPTS` (each floored to 1 so a stray value can never disable the handler). Critically, the retry predicate also recovers the busy/locked signal from the raw `node:sqlite` cause: the driver reports the SQLite primary result code on `errcode`, which Effect's `classifySqliteError` does not read, so a _real_ busy/locked error arrives classified as `UnknownError` rather than `LockTimeoutError` — gating on the reason tag alone would have left the retry silently dead in production. Covered by a live two-connection contention test that proves an actual `SQLITE_BUSY` retries to the bound and recovers once the lock is released.

## 0.1.3

- Improve: Add a dev-only `T3CODE_DESKTOP_APP_VERSION_OVERRIDE` for testing manual desktop update checks against existing GitHub releases without editing package metadata or publishing a release.
- Fix: Send GitHub REST API headers from the desktop manual update checker so dev/unpackaged builds do not fail release checks with GitHub 403 responses.
- Fix: Let dev/unpackaged desktop builds use the manual GitHub release check path instead of disabling the update button just because native auto-update is unavailable.
- Fix: Allow desktop update checks to run when the app has stale native-updater `downloaded` state, so the new manual release-page update flow remains testable after a previously staged update.
- Change: Desktop update actions are now manual: when the selected channel reports an available update, the UI opens the GitHub release/download page instead of downloading, staging, or installing the update inside the app.
- Fix: Install local mock macOS desktop updates with a dev-only replacement helper instead of Squirrel.Mac. Unsigned/ad-hoc mock artifacts can download successfully but Squirrel refuses the final install handoff, so loopback `--mock-updates` feeds now replace the current `.app` bundle after quit and reopen it; signed production/nightly updates still use `autoUpdater.quitAndInstall()`.
- Fix: Route desktop update install confirmations through the existing Electron dialog bridge instead of raw renderer `window.confirm()`, so packaged mock-update builds can actually reach the `installUpdate` IPC path when the "Restart to Update" button is clicked.
- Fix: Let the desktop updater retry installation whenever a downloaded payload is staged, even if the current update state is `error`; the UI already presents this as an install action, but the main process previously rejected it unless the status was exactly `downloaded`, making the button appear to do nothing after some updater errors.
- Fix: Stop the desktop `before-quit` handler from cancelling the updater-owned quit. Installing a downloaded update stops the backend and then calls `autoUpdater.quitAndInstall()`, which relies on the app actually quitting; the lifecycle handler was calling `event.preventDefault()` on that quit, so the update never installed and the (already-stopped) backend was left dead — surfacing in the UI as a permanent "disconnected, retrying…" with no install. The handler now defers only user-initiated quits and lets programmatic quits (quitAndInstall, signal shutdown, fatal startup) proceed.
- Fix: Restart the desktop backend when an update install fails (either a thrown `quitAndInstall` or an asynchronous updater `error` event) instead of leaving the app stranded with a stopped backend after it was halted in preparation for the install.
- Improve: Make the desktop updater testable locally. When the resolved update feed is a local mock (a `generic` provider on a loopback host, as baked by `build-desktop-artifact --mock-updates`), the app now follows the build's `dev` channel and accepts dev-track candidates instead of applying the stable/nightly channel rules that previously rejected them. Adds `docs/desktop-updater-local-testing.md` documenting the end-to-end local update flow.

## 0.1.3-nightly.20260614.1

- Improve: Derive orchestration shell-stream events once per domain event in the engine and fan the mapped result out to all shell subscribers, removing the prior per-event per-subscriber projection re-query.
- Remove: Drop the bundled marketing site (`apps/marketing`).
- Remove: Drop PostHog usage telemetry from the server.
- Remove: Drop the Cursor agent provider; Codex, Claude, and OpenCode remain.
- Remove: Drop Bitbucket and Azure DevOps source-control integrations; GitHub and GitLab remain.
- Improve: Rework chat message metadata, timestamps, and tool work-log rows for denser timelines.
- Improve: Virtualize and polish the provider model picker for large model catalogs.
- Fix: Sync Codex app-server protocol handling and provider startup behavior, including service-tier model options.
- Fix: Improve source-control provider detection for self-hosted GitLab and multi-account GitHub auth.
- Fix: Reduce repeated macOS permission prompts by avoiding eager protected-directory and Tailscale status probes.
- Fix: Include standard Linux desktop icon sizes in AppImage packaging.
- Fix: Preserve forwarded SSH HTTP status markers in desktop remote API errors.
- Fix: Surface redacted stdout diagnostics when SSH commands fail without stderr output.
- Provider support: Gate Claude Fable 5 behind supported Claude Code versions and expose its reasoning/context options.
- Fix: Handle Claude SDK system messages as structured tool-denied events or clearer diagnostics instead of generic runtime-warning floods.
- Fix: Deny pending Claude AskUserQuestion requests when a session stops instead of auto-approving them with empty answers, and emit a single resolved event.
- Fix: Spawn the server build's Node subprocess directly instead of routing it through the Windows shell.
- Fix: Spawn Windows PowerShell environment probes directly instead of routing them through the shell.
- Fix: Spawn trusted system executables directly instead of routing them through the Windows shell.
- Fix: Keep running turns open until the provider session ends or is superseded, including live store updates, provider steer handling, and completion duration formatting.
- Performance: Reduce VCS remote status polling churn by using a remote-only Git status path and delaying automatic refreshes when cached remote snapshots are available.
- Docs: Add upstream decision tracking for pending upstream-only work and record the initial implementation categories.
- Fix: Repair the desktop `dev`, `start`, and `smoke-test` turbo tasks, which still depended on the pre-rebrand `t3#build` package and failed to resolve; they now depend on `gedcode#build` so the desktop app builds and launches locally.

## 0.1.2

- Pin the desktop release builder to the ad-hoc-signing-compatible version and verify macOS artifacts before upload so unsigned builds can still be manually opened without Gatekeeper reporting them as damaged.

## 0.1.1

- Desktop
  - Fix in-app desktop update installation by preserving the updater-owned quit flow and using silent installs only on Windows.
  - Add packaged desktop identity metadata and keep packaged development builds out of live update mode.
- Release and packaging
  - Add release wrapper scripts and packaged-dev desktop identity metadata.
  - Keep packaged dev out of live mode and allow nightly releases after a stable release.
  - Resolve previous release notes tags with the nightly channel for nightly releases.
  - Ignore `docs/research` in format/lint checks and allow hosted web pairing deployments to use fork-owned router and channel domains.
- Ged workflow
  - Scope runtime checkpoints to each thread and guard checkpoint ownership.
  - Enforce auto-escalation and surface more accurate workflow status phases.
  - Clarify runtime escalation, Codex Ged subagent presets, and sequential role gates with main-thread fallback.
  - Show the workflow badge only while the latest turn is running and hide it while chat is idle.
- Provider support
  - Expose the Claude Fable model.
- UI
  - Fix light-mode contrast for destructive outline buttons such as connectivity Revoke actions.
- CI
  - Fix `tsgo` typechecking after Effect's `Sink` export moved behind the package root.

## 0.1.1-nightly.20260610.1

- Ged workflow
  - Scope runtime checkpoints to each thread and guard checkpoint ownership.
  - Enforce auto-escalation and surface more accurate workflow status phases.
  - Clarify in the workflow prompt that the harness/runtime may upgrade initially trivial tasks to non-trivial after observing scope.
  - Require native Codex Ged subagents to use the configured role model and reasoning presets when subagent tools are available.
  - Clarify runtime escalation, Codex Ged subagent presets, and sequential role gates with main-thread fallback.
  - Show the workflow badge only while the latest turn is running and hide it while chat is idle.
- Release and packaging
  - Add release wrapper scripts and packaged-dev desktop identity metadata.
  - Keep packaged dev out of live mode and allow nightly releases after a stable release.
  - Ignore `docs/research` in format and lint checks.
  - Allow hosted web pairing deployments to use fork-owned router and channel domains.
- Provider support
  - Expose the Claude Fable model.
- UI
  - Fix light-mode contrast for destructive outline buttons such as connectivity Revoke actions.
