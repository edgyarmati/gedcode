# Upstream Decisions

This document tracks decisions about upstream-only work from `pingdotgg/t3code`.
Use it before categorizing, cherry-picking, or reimplementing upstream commits.

Last reviewed against the live `upstream/main` snapshot at `200fa82` on
2026-07-27 (649 upstream-only commits after merge base `e3accd6e957` on
`feat/orchestrator-mode`). The previous local review covered 422 commits at
`32e78448`; upstream added 227 more commits afterward, including the Sidebar V2
task-oriented chat lifecycle.

## Initial divergence review (2026-07-27)

Comparison basis:

- Fork merge base: `e3accd6e957` (`Ensure Electron runtime is installed in
release workflow (#2861)`), 2026-05-29.
- Current fork: `4dada3ad` on `main`.
- Current upstream: `200fa82` on `upstream/main`, 2026-07-27.
- Upstream-only range: 649 commits. The comparison is dominated by mobile code,
  vendored reference repositories, cloud infrastructure, and the tooling
  migration; the task-oriented chat lifecycle is a separate web/server feature
  within that range.

Verdict: **do not adopt upstream wholesale**. GedCode has a different product
direction and a substantially different orchestration/runtime surface. Keep
Bun, the current client connection and replay design, and the fork-original
orchestrator. Port isolated reliability or UX improvements only when they fit
the current modules and have a clear verification story.

The table groups the upstream range into cohesive differences rather than
listing every small fix. Effort is deliberately qualitative and describes an
adapted implementation in GedCode, not a raw cherry-pick.

| Upstream difference since fork                                                                                       | Relevance to GedCode                                                                                                      | Initial decision                                                                                                                | Effort                                          |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Mobile app and native mobile runtime (`apps/mobile`, mobile CI and native patches)                                   | Low for the current web/desktop product                                                                                   | Do not implement unless mobile becomes an explicit product goal                                                                 | High                                            |
| Relay, cloud, APNs, Clerk, and T3 Connect infrastructure                                                             | Low; changes the deployment and security model                                                                            | Do not implement for now                                                                                                        | High                                            |
| pnpm/Vite Plus workspace and test-tool migration (`b440dd18` and follow-ups)                                         | Low; GedCode is intentionally Bun-based                                                                                   | Do not migrate. Port compatible release/CI fixes individually                                                                   | High for migration; Low–Medium per isolated fix |
| Client-runtime connection rewrite (`e95b57dc`)                                                                       | Low relative to GedCode’s hardened subscriptions, replay, and orchestration recovery                                      | Do not implement wholesale; use as reference only                                                                               | High                                            |
| Broad Effect error-structuring and service refactor campaign                                                         | Medium reliability value, low parity value, and high collision risk with GedCode’s conventions                            | Do not port as a campaign. Select individual error-context or safety fixes only                                                 | High wholesale; Low–Medium selectively          |
| In-app browser preview, automation, annotations, and HTTP MCP support (`52c77c1e` plus follow-ups)                   | Potentially useful for agent-driven UI work, but outside the current orchestrator/MCP boundary                            | Defer as a separate future project; keep `orchestration/mcp` separate                                                           | High                                            |
| Workspace file browser, file preview, and composer file integration (`de8bdc10`, `0936fd27`, `8ca4eec9`, `4cfec8c1`) | Medium. Basic filesystem browsing already exists; the preview-panel and explorer-to-composer portions are missing         | Implement selectively if workspace inspection becomes a priority                                                                | Medium–High                                     |
| Task-oriented chat lifecycle / Sidebar V2 (`32c6012d` and follow-ups)                                                | High. It turns thread history into an active/snoozed/settled work inbox and aligns with GedCode’s task-oriented direction | Adopt the interaction model selectively, but do not cherry-pick the upstream client-runtime/sidebar stack                       | High                                            |
| Provider-native `Auto` runtime mode (`fbd77420`)                                                                     | High safety relevance, but GedCode already has a different per-gate autonomy model                                        | Do not adopt as-is. Revisit only if provider-level AI-reviewed approvals are wanted in normal chats                             | Medium                                          |
| Websocket/activity payload and offline catch-up optimizations (`d60f6e97`, `db4b2d8a`, `c14a5ca4`, `765e1b5f`)       | High for reliability and performance under active orchestration streams                                                   | Adapted locally with ordered buffered bootstrap, bounded replay, transport-only delta compaction, and activity payload previews | Complete                                        |
| Prompt stash and per-provider composer queue (`200fa82`)                                                             | Medium. GedCode already has queued active-turn messages; cross-thread prompt parking is the missing part                  | Defer the stash UX until normal-chat workflows need it; keep the existing queue design                                          | Low–Medium                                      |
| Checked-in project actions via shared `t3.json` (`1c9a6de2`)                                                         | Medium for portable project setup, but separate from GedCode’s event-sourced project/orchestrator config                  | Defer. Revisit if project actions should be shareable with upstream/T3 projects                                                 | Medium                                          |
| Chat timeline scroll anchoring and minimap (`fda64862`)                                                              | High usability value in long sessions                                                                                     | Adopted in adapted form as local commit `7f4265738`; no further upstream sync needed                                            | Complete                                        |
| Persistent word wrapping for chat code blocks/tables (`fb103454`)                                                    | Medium usability value. GedCode already has persistent diff wrapping, but not the full chat setting                       | Consider a small adapted follow-up; not urgent                                                                                  | Low–Medium                                      |
| Model picker virtualization and message metadata/work-log polish (`31533466`, `1916ac6d`)                            | High usability/performance value                                                                                          | Adopted in adapted form as local commits `b07b81c37` and `8a19d2a1b`                                                            | Complete                                        |
| Remaining chat markdown, composer, changed-files, header, and sidebar polish                                         | Medium–High day-to-day value, but much of the surface was already reshaped locally                                        | Adopt selectively when touching the affected component; do not chase visual parity                                              | Low–Medium per item                             |
| Snapshot-over-HTTP and replay-before-live-subscription (`482d5623`)                                                  | Relevant reliability pattern, but GedCode has a separate orchestration snapshot/recovery protocol                         | Review the transaction and subscribe-before-replay ideas; do not port the client architecture                                   | Medium                                          |
| Codex app-server protocol and provider updates (`ae7e88b0`, later model and Claude skill updates)                    | High when required by installed provider versions                                                                         | Follow `@openai/codex`/provider releases and capability needs, using upstream as reference                                      | Low–Medium per release                          |
| Desktop, process, SSH, WSL, VCS, and release hardening                                                               | Medium–High where GedCode shares the execution boundary                                                                   | Port concrete fixes when the local path has the same failure mode; several early fixes are already recorded as completed below  | Low–Medium per fix                              |
| Grok provider, Cursor provider work, marketing, and vendored/reference-repo changes                                  | Low or explicitly removed from GedCode                                                                                    | Do not implement; preserve the existing exclusions                                                                              | Medium–High                                     |

This review creates no implementation backlog beyond the classifications above.
When an item moves into active implementation, add a bounded task and update
the relevant category below in the same change.

## Policy change (2026-07-06) — leaving the fork network

GedCode has drifted far from t3code and will leave the fork network in the
near future. **Parity syncs are over.** Do not merge or stage-merge
`upstream/main`. Instead, selectively port individual upstream features when
they are useful and there is a good implementation for our tree.

Decided against wholesale adoption (2026-07-06 audit of the 422-commit range):

- **pnpm/Vite Plus tooling migration** (`b440dd18`, 299 files, + follow-ups) —
  we stay on Bun; port only release/CI fixes that apply to our setup.
- **Client-runtime connection rewrite** (`e95b57dc`, 606 files) — would
  destabilize our hardened subscription/replay surfaces for no product need.
- **Effect error-structuring campaign** (~200 commits) — style parity has no
  value post-detach; our conventions evolve independently.
- Long-standing exclusions remain: mobile (#2013 + ~44 follow-ons),
  relay/cloud/APNs/Clerk/T3 Connect, marketing/docs/vendored refs, Grok
  provider, Cursor provider (deleted here; drop all upstream Cursor work).

Port shortlist (opportunistic, each as its own adapted port, not a raw
cherry-pick):

- Individual web/chat polish items: virtualized model picker (`31533466` —
  already ported per Completed section), timeline scroll/minimap (`fda64862` —
  already ported per Completed section), word-wrap (`fb103454` — partial local
  coverage), message metadata/work-log rows (`1916ac6d` — already ported), and
  the missing workspace file-preview/composer integration (`de8bdc10`,
  `0936fd27`, `8ca4eec9`, `4cfec8c1`).
- Task-oriented chat lifecycle / Sidebar V2 (`32c6012d`) — relevant and likely
  worth adapting after a short design pass. The nightly implementation remains
  thread-backed: it adds server-backed `settled`/snoozed lifecycle and an
  active-work inbox, rather than replacing threads with a new task aggregate.
  GedCode should map this onto its existing normal-chat and Orchestrator task
  surfaces instead of importing the upstream client-runtime rewrite.
- The inline tool timeline (`649f4328`) is reference-only for now because
  GedCode’s timeline and orchestrator activity model are different.
- In-app browser preview subsystem (~48 commits incl. its `apps/server/src/mcp`
  HTTP MCP server dependency) — future project when wanted; our
  `orchestration/mcp` endpoint stays separate regardless.
- Codex app-server protocol updates — driven by `@openai/codex` releases, not
  t3code; upstream's protocol-sync commits are reference material when we bump.

Mechanics: keep the `upstream` remote read-only for reference until detach.
`main` fast-forwards cleanly from `feat/orchestrator-mode` and does not wait
on any upstream work.

Historical context below reflects the pre-2026-07-06 parity policy.

Previous review: `upstream/main` at `57f6bf7e` on 2026-06-11.
At that point, local `main` matched `origin/main`, and `main...upstream/main`
was `117 83`: this fork was 117 commits ahead and 83 commits behind upstream.

## Categories

- **Want to implement**: We intend to port, cherry-pick, or reimplement this work. When an item in this section is completed, remove it from this list in the same task.
- **Deferred indefinitely**: Worth keeping in view, but not scheduled and not needed for current direction.
- **Not doing for now**: Explicitly out of scope for this fork unless product direction changes.
- **Needs decision**: Requires user/maintainer decision before implementation work starts.

## Fork-Original Work

### Orchestrator mode Phase 1

- Tracking issue: [#32](https://github.com/edgyarmati/gedcode/issues/32)
- Completed in this fork: 2026-06-18
- Notes: This is fork-original product direction, not a cherry-pick from
  `pingdotgg/t3code`. Phase 1 adds the pi-backed PM runtime, task aggregate,
  detached worker handoff, human gates, restart-window PM re-entry proof, and
  the initial `/orch` web surfaces.

### Orchestrator mode Phase 2

- Tracking issue: [#35](https://github.com/edgyarmati/gedcode/issues/35)
- Completed in this fork: 2026-06-20
- Notes: Fork-original durability and safety hardening of Phase 1, not a
  cherry-pick from `pingdotgg/t3code`. Phase 2 adds SQLite concurrent-writer
  hardening (`PRAGMA busy_timeout` + a jittered retry gated strictly on
  `SQLITE_BUSY`/`SQLITE_LOCKED`), real-captured-diff completeness gating on
  stage completion, durable two-phase `pending -> acted` settlement recovery
  with a reconciliation sweep (closing the at-most-once PM re-entry liveness
  gap), a bounded secret-scrubbed `StageResultBuilder` worker-diff envelope, a
  periodic leaked-worktree reaper, durability-path Effect Metrics, and
  measure-only command-queue contention instrumentation.

### Orchestrator mode Phase 3

- Tracking issue: [#51](https://github.com/edgyarmati/gedcode/issues/51)
- Status: Complete in this fork as of 2026-06-22 (on `feat/orchestrator-mode`).
- Notes: Fork-original multi-stage role and multi-backend work, not a
  cherry-pick from `pingdotgg/t3code`. The P1-P3 engine foundation adds
  `review`/`verify` worker roles, human-controlled per-task role model
  overrides, per-role prompt prefixes, deterministic backend/model selection,
  PM handoff support for the new roles, and a durable stage-history projection.
  The follow-on UX/E2E lane added the stage-timeline UI and the P7
  full-pipeline/restart-durability integration proof. Project/task configuration
  editing was reshaped into Phase 4 (see below).

### Orchestrator mode Phase 4

- Tracking issue: [#59](https://github.com/edgyarmati/gedcode/issues/59)
- Status: Complete in this fork as of 2026-06-23 (on `feat/orchestrator-mode`; not
  yet merged to `main`).
- Notes: Fork-original configuration, autonomy, and guidance layer over the Phase 3
  pipeline — not a cherry-pick from `pingdotgg/t3code`. Adds a five-layer
  `ConfigResolver`; per-gate autonomy (gates flippable to `auto`, auto-resolved by
  the decider with a `system` origin; `land` hard-pinned to require-approval);
  per-project stage toggles (review/verify optional, classify/plan/work mandatory)
  with a global default that seeds new projects; a PM tool for PM-driven per-task
  backend selection (the per-task settings dialog was removed in favor of
  chat-driven control); PM-only built-in playbooks (a source-agnostic
  `PlaybookLoader` + content-hash version, injected into the PM via pi
  `setResources`); and PM context auto-compaction layered over pi's built-in
  compaction. Deliberately NO per-task-type taxonomy and NO per-task config maps
  (the single `feature` task type is an internal implementation detail). A full
  E2E + restart-durability integration proof closes the phase.

## Removed Forked-In Features

Subsystems inherited from upstream that this fork has deliberately deleted to
lower maintenance/verification surface. Do not re-port these from
`pingdotgg/t3code` unless product direction changes. Removed 2026-06-13.

- **Marketing site** (`apps/marketing`): the public Astro landing page. The fork
  is a local/desktop coding-agent GUI, not a marketed product.
- **PostHog telemetry** (`apps/server/src/telemetry`): upstream's anonymous usage
  analytics, hardcoded to ping.gg's PostHog project. No value to this fork.
- **Cursor agent provider**: the Cursor ACP provider, adapter, text generation,
  and model probing. Codex, Claude, and OpenCode remain. This supersedes the
  completed "Cursor dynamic model probing" item below — do not re-port Cursor
  provider work. (The Cursor _IDE editor_ "open in" target is unrelated and is
  kept.)
- **Bitbucket and Azure DevOps source control**: their API/CLI clients,
  providers, detection, and UI. GitHub and GitLab remain. This supersedes the
  Bitbucket/Azure DevOps portions of the completed "Source-control provider edge
  cases" item below.

Considered but **kept**: remote access (pairing/SSH/Tailscale), the desktop
auto-update system, the OpenCode provider, and local diagnostics
(process/resource monitoring + OTLP/observability plumbing). The OTLP _export_
removal was scoped out for now because its metrics/tracing instrumentation is
woven into core provider/orchestration logic.

## Completed Upstream Work

### Git status polling churn

- Upstream commit: `0baf1986` (`[codex] Reduce Git status polling churn (#3037)`)
- Completed in this fork: 2026-06-11
- Notes: Remote VCS status now uses a remote-only Git status path, and stream subscribers with cached remote snapshots wait for the configured refresh interval before polling again.

### Turn fold projection correctness

- Upstream commit: `57f6bf7e` (`Fix turn fold proejctions (#3041)`)
- Completed in this fork: 2026-06-11
- Notes: Running turns now stay open until the provider session ends or a new active turn supersedes them across replay projection, persisted projection, and live web store state. Local Claude, Cursor, and OpenCode adapters reuse active turn ids for steers. The applicable web duration formatting fix was ported. The upstream Grok adapter and client-runtime reducer portions were skipped because those paths do not exist in this fork, and upstream's explicit turn-fold row changes are not directly applicable to the fork's current timeline row model.

### Avoid shell for system executables

- Upstream commit: `300f7fd1` (`[codex] Avoid shell for system executables (#2950)`)
- Completed in this fork: 2026-06-12
- Notes: System executable probes now spawn directly instead of opting into the Windows shell, and SSH/Tailscale spawns use platform-specific executable names (`ssh.exe`/`tailscale.exe` on Windows).

### Avoid shell for Windows environment probe

- Upstream commit: `6ce6f678` (`[codex] Avoid shell for Windows environment probe (#2951)`)
- Completed in this fork: 2026-06-12
- Notes: Desktop Windows PowerShell environment probes now spawn directly without `shell: true`, while preserving profile/no-profile PATH hydration behavior.

### Avoid shell for Node executable spawns

- Upstream commit: `a74dfd4f` (`[codex] Avoid shell for Node executable spawns (#2952)`)
- Completed in this fork: 2026-06-12
- Notes: The server build helper now launches the current Node executable directly without Windows shell mode. Local ACP and Codex app-server fixture peers still use Bun-specific test runner spawns rather than the upstream direct Node pattern.

### Claude SDK system message handling

- Upstream commits: `e1ce9f85` (`fix: handle Claude Agent SDK 0.3.x system messages to stop runtime-warning flood (#2872)`), `75257d64` (`"claude system message" instead of "runtime warning" when using 4.8 from claude code (#2972)`)
- Completed in this fork: 2026-06-12
- Notes: Claude `thinking_tokens` system messages are ignored, `permission_denied` maps to a structured `tool.denied` runtime event, `mirror_error` maps to a clearer runtime error, and unknown Claude SDK/system messages include clearer row text with scalar previews.

### Claude Fable 5 model

- Upstream commit: `de58ec8e` (`Add Claude Fable 5 model (#3009)`)
- Completed in this fork: 2026-06-12
- Notes: Claude Fable 5 is gated behind Claude Code `2.1.169` or newer, exposes reasoning and 200k/1M context options, and preserves `xhigh` effort for Claude SDK sessions.

### Cursor dynamic model probing

- Upstream commit: `d78e02cd` (`Probe Cursor models via list_available_models (#2428)`)
- Completed in this fork: 2026-06-12
- Notes: Cursor model discovery now uses the `cursor/list_available_models` ACP extension, decodes per-model config options into model capabilities, and avoids spawning additional ACP sessions for background per-model capability enrichment.

### SSH redacted stdout diagnostics

- Upstream commit: `f5849f7d` (`fix(ssh): Surface redacted stdout for failed commands (#2920)`)
- Completed in this fork: 2026-06-12
- Notes: Non-zero SSH command failures now include redacted stdout in logs and `SshCommandError` details when stderr is empty, while preserving stderr as the preferred user-facing failure message.

### Desktop SSH HTTP auth status preservation

- Upstream commit: `4956415f` (`fix(desktop): Preserve SSH HTTP auth status (#2923)`)
- Completed in this fork: 2026-06-12
- Notes: Desktop SSH remote API errors now preserve forwarded `[ssh_http:<status>]` markers from SSH loopback failures so the web runtime can distinguish auth failures such as 401 responses.

### Linux AppImage icon packaging

- Upstream commit: `f0116e44` (`fix(desktop): Include standard Linux AppImage icons for Niri/Noctalia (#2915)`)
- Completed in this fork: 2026-06-12
- Notes: Linux desktop artifact staging now generates standard icon sizes under an `icons` resource directory and release CI installs ImageMagick for Linux builds.

### macOS TCC prompt-loop prevention

- Upstream commit: `b76f161d` (`fix(desktop): stop looping macOS TCC permission prompts (#2745)`)
- Completed in this fork: 2026-06-12
- Notes: Desktop endpoint discovery avoids unnecessary Tailscale status spawns, Tailscale MagicDNS reads can be cached/injected, denied filesystem browse directories return empty listings, and command palette browse prefetch no longer scans highlighted child directories before explicit navigation.

### Source-control provider edge cases

- Upstream commit: `49c1b646` (`fix(source-control): handle self-hosted GitLab, multi-account GitHub auth & azure devops web url (#2480)`)
- Completed in this fork: 2026-06-12
- Notes: Source-control detection now handles self-hosted GitLab remotes through authenticated `glab` hosts, GitHub CLI JSON auth status with multiple accounts, host:port remote detection, and Azure DevOps pull request web URL fallbacks.

### Codex app-server protocol and provider startup

- Upstream commit: `ae7e88b0` (`[codex] Sync app-server protocol, service tiers, and provider startup (#3036)`)
- Completed in this fork: 2026-06-12
- Notes: Codex app-server generated schemas and client behavior now include the upstream protocol sync, Codex model options include service tier handling, text generation forwards service tier settings, and provider startup has focused coverage for persisted/non-persisted launch behavior.

### Model picker virtualization and polish

- Upstream commit: `31533466` (`Model picker UI Improvements, Virtualize Model List (#3021)`)
- Completed in this fork: 2026-06-12
- Notes: The provider model picker now uses a virtualized model list, keeps provider rails visible in locked mode with disabled incompatible providers, blocks incompatible model selections in started threads, and has focused browser-test coverage for locked-mode filtering and disabled model behavior.

### Chat timeline scroll anchoring and minimap

- Upstream commit: `fda64862` (`Restore chat scroll affordances and add timeline minimap (#3587)`)
- Completed in this fork: 2026-06-29, adapted as local commit `7f4265738`.
- Notes: The local implementation preserves GedCode’s timeline and orchestrator activity model while carrying over the useful scroll anchoring, jump-to-latest, and minimap affordances. Do not re-port the upstream version.

### Message metadata and work-log row polish

- Upstream commit: `1916ac6d` (`Rework message metadata, timestamps, and tool work log rows (#3022)`)
- Completed in this fork: 2026-06-12
- Notes: Chat timelines now use the upstream metadata and timestamp presentation, tool/work-log rows have clearer success/failure/neutral affordances, review-comment contexts render as structured cards, and focused timeline/session coverage was adapted for this fork's Vitest setup.

### Orchestration subscription replay and transport hardening

- Upstream references: `c14a5ca4`, `db4b2d8a`, `d60f6e97`, and `765e1b5f`.
- Completed in this fork: 2026-07-27.
- Notes: GedCode now uses one local ordered-subscription primitive for shell, normal-thread,
  Orchestrator project, and Orchestrator task streams. Live delivery attaches before snapshot I/O;
  replay is bounded to 1,000 global events with a `limit + 1` fresh-snapshot decision; replay,
  buffered, and live envelopes are ordered and deduplicated; sparse shell projection gaps carry
  explicit covered ranges; consecutive same-message assistant deltas coalesce only after durable
  ordering; and oversized activity payloads are reduced to semantic 32 KiB WebSocket previews with
  explicit byte metadata. Persistence, owner-only HTTP snapshots, and raw provider streams retain
  their existing full-fidelity behavior. The upstream client-runtime/WebSocket architecture was not
  imported.

## Selective Follow-ups

### Task-oriented chat lifecycle / Sidebar V2

- Representative commits: `32c6012d` (`Sidebar v2 beta: flat thread list with a server-backed settled lifecycle (#4026)`), `202e5609` (`feat(sidebar-v2): thread snoozing (#4311)`), and the follow-up settled-thread, project-grouping, and sidebar-polish commits through 2026-07-24.
- Decision: Relevant and likely worth implementing conceptually; do not cherry-pick the upstream stack.
- What it contains: A beta-gated Sidebar V2, server-persisted thread settlement, active/snoozed/settled shelves, reopening behavior when sending to a settled thread, status-oriented rows, and associated persistence/projector/decider changes. The current nightly still models these records as threads; “task-oriented” describes the workflow and inbox semantics, not a replacement task entity.
- Why it matters: This is the clearest upstream match to GedCode’s desired work-oriented chat UX and complements the fork’s Orchestrator task aggregate. It could reduce the pressure to keep every completed conversation in the active chat list.
- Implementation guidance: First decide whether normal chats, Orchestrator tasks, or both participate in the work inbox. Reuse GedCode’s event-sourced task and thread projections, define the lifecycle and reopen semantics explicitly, and keep the upstream client-runtime rewrite out of scope. Qualitative effort: High.

### Provider-native `Auto` runtime mode

- Representative commit: `fbd77420` (`feat: add "Auto" runtime mode — AI-reviewed approvals for Codex and Claude (#4272)`).
- Decision: Relevant as a safety/product reference, but do not adopt the upstream mode as-is.
- What it contains: A normal-chat runtime mode that gives Codex and Claude a provider-native AI approval reviewer for routine actions while retaining human prompts for riskier actions.
- Why it is not a direct port: GedCode already has fork-original per-gate autonomy in Orchestrator Phase 4, with durable gate events, a system-origin auto-resolution path, and `land` pinned to human approval. Upstream `Auto` is provider-level permission behavior for ordinary chats, so conflating the two would weaken the boundary between task policy and provider policy.
- Implementation guidance: If normal chats later need AI-reviewed approvals, add it as an explicit provider capability with a clear fallback for providers that do not support it. Do not silently map unsupported providers to another permission mode. Qualitative effort: Medium.

### Prompt stash and checked-in project actions

- Representative commits: `200fa82` (per-provider `cmd+S` prompt stash) and `1c9a6de2` (shared `t3.json` project configuration and action import).
- Decision: Useful but not part of the immediate adoption set; defer both.
- What is already covered locally: GedCode has persisted normal-chat queued messages for active turns and its own event-sourced project/orchestrator configuration. The upstream features address different convenience layers: parking unsent prompts across threads/providers, and importing portable project actions from a checked-in file.
- Implementation guidance: Consider prompt stash when cross-thread handoff becomes a recurring workflow. Consider a checked-in project-action format only after deciding whether interoperability with T3’s schema is a product requirement; otherwise keep project configuration native to GedCode. Qualitative effort: Low–Medium for stash, Medium for project actions.

### Web UI, UX, and performance polish

- Representative commits: `fb103454` (`add persistent word-wrap setting for chat code blocks and tables`), `7f741a56` (`Misc markdown styling improvements (#3017)`), `a4757c26` (`Composer polish (#3018)`), `0b40ea62` (`Extract changed files card (#3023)`), and `343061a0` (`Misc chrome polish (#3027)`).
- Decision: Selective follow-ups only. Model picker virtualization, message metadata/work-log polish, and timeline scroll/minimap are already covered by local adaptations; the rest is optional polish.
- Why it matters: The remaining items can improve long-session scanning and dense markdown/composer usability, but visual parity would compete with GedCode’s orchestrator UX and local component changes.
- Implementation guidance: Prefer small, isolated improvements when touching an affected component. Keep local UX consistency in mind, and verify dense chat timelines, long model lists, markdown-heavy messages, and small viewports.

### Compatible tooling, CI, and release fixes

- Representative commits: `b440dd18` (`Migrate workspace to Vite+ and pnpm (#2899)`), `f60def20` (`Migrate tests to vite-plus test APIs (#2964)`), `4c262c4b` (`[codex] split ci workflow jobs (#2940)`), `6a1c4da5` (`fix(release): use workspace electron-builder for desktop packaging (#2938)`), `e4643ecc` (`fix: build web before desktop release packaging (#2934)`), `52ae8e88` (`fix(release): preserve desktop artifact arch (#2943)`)
- Decision: Selective fixes only; do not migrate the workspace.
- What it contains: Release packaging fixes, desktop artifact corrections, dependency-closure handling, CI job restructuring, and the pnpm/Vite Plus migration.
- Why it matters: Build and release reliability matter, but GedCode’s Bun workflow and release scripts have already diverged substantially. The migration would create more risk than value.
- Implementation guidance: Port only a concrete fix that reproduces in GedCode, preserving Bun and the current test runner. Until then, repo instructions still require `bun fmt`, `bun lint`, and `bun typecheck`.

## Deferred Indefinitely

### In-app browser preview subsystem

- Representative commits: `52c77c1e` (`feat(preview): in-app browser preview panel`), `f4c39432` (background preview capture and picture-in-picture), and the follow-up preview automation, annotation, session, and HTTP MCP work.
- Decision: Deferred indefinitely as a standalone project.
- Rationale: This is a substantial desktop/server/web subsystem with browser lifecycle, port scanning, automation, annotations, session ownership, and an HTTP MCP server. It may become valuable for orchestrator-driven UI work, but it must be designed around GedCode’s separate `orchestration/mcp` boundary rather than merged from upstream.

## Not Doing For Now

### Mobile app platform bring-up

- Representative commit: `b3e8c033` (`T3 Code Mobile [WIP] (#2013)`)
- Scope: Adds `apps/mobile`, native terminal and review modules, mobile state/runtime integration, mobile-specific scripts, assets, and supporting shared-runtime changes.
- Decision: Not doing for now.
- Rationale: This is a major product surface, not a small upstream catch-up. It brings native mobile maintenance, Expo/native module concerns, large assets, mobile CI/static checks, and cross-package runtime pressure. GedCode is currently focused on the web/desktop coding-agent GUI, so mobile would dilute implementation and verification effort unless mobile becomes an explicit product goal.

### Relay and cloud infrastructure

- Representative commits: `5ae77c0d` (`feat(relay): Add managed relay tunnels and APN service (#2837)`), `a04c09a1` (`Use HttpApi for Environment APIs & standardize authn/authz (#2858)`), `602148f8` (`fix(cloud): use Electron fetch for proxying Clerk IPC requests (#2973)`), `a56496c7` (`Annotate relay error spans with schema fields (#2976)`), `3ea6adf1` (`[codex] Enrich relay authorization diagnostics (#2977)`)
- Scope: Managed relay tunnels, APN/live-activity delivery, relay auth, cloud environment linking, DPoP/auth flows, Clerk integration, relay observability, infra migrations, and cloud-facing docs.
- Decision: Not doing for now.
- Rationale: This work is operationally heavy and changes the deployment/security model. It would require infrastructure ownership, auth policy decisions, secrets handling, relay observability, and ongoing production support. Until this fork commits to hosted relay/cloud operation, these changes add more operational surface than value.

### T3 Connect rebrand and cloud product direction

- Representative commit: `22f9f305` (`[codex] Rebrand T3 Cloud as T3 Connect (#3011)`)
- Scope: Renames or reframes upstream cloud/connectivity concepts around T3 Connect.
- Decision: Not doing for now.
- Rationale: The naming follows upstream's cloud product direction, while this fork should avoid adopting cloud product language before deciding whether that product surface exists here at all. Pulling the rebrand without the cloud direction would create confusing terminology.

### Docs, marketing, vendored references, and release metadata

- Representative commits: `ec18938b` (`Restructure documentation into topical folders (#2963)`), `cc9e81ac` (`fix(marketing) : marketing showing wrong icons on linux (#2696)`), `e3f14058` (`chore: add vendored reference repo subtree sync tooling (#2902)`), `bd851c02` (`chore: add Alchemy reference repo subtree (#2918)`), `983a8c7f` (`chore(release): prepare v0.0.26`), `04f7f32a` (`chore(release): prepare v0.0.27`)
- Scope: Documentation reshaping, marketing fixes, vendored reference repository syncs, and upstream release bookkeeping.
- Decision: Not doing for now.
- Rationale: Most of this is upstream-specific process, historical release metadata, or large vendored reference material. Copying it would add noise without improving GedCode behavior. Individual docs can still be copied later when they directly explain behavior this fork supports, but the group itself should not be tracked as implementation work.

### Grok CLI provider

- Representative commit: `38ea6d48` (`feat(grok): add Grok CLI provider via ACP (#2809)`)
- Scope: Adds a new Grok CLI provider through ACP, including provider runtime integration, contracts, settings/model selection, text generation, tests, and failure behavior.
- Decision: Not doing for now.
- Rationale: The remaining provider/model value after Cursor dynamic probing and Claude Fable support is a full new provider integration, not a catalog freshness fix. It increases provider surface area and long-term maintenance burden, so it should stay out of scope unless Grok becomes an explicit product priority.

## Needs Decision

No upstream groups are awaiting categorization right now.
