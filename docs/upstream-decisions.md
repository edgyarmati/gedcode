# Upstream Decisions

This document tracks decisions about upstream-only work from `pingdotgg/t3code`.
Use it before categorizing, cherry-picking, or reimplementing upstream commits.

Last reviewed against `upstream/main` at `32e78448` on 2026-07-06 (422 commits
behind merge base `e3accd6e957` on `feat/orchestrator-mode`).

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
  already ported per Completed section), timeline scroll/minimap (`fda64862`),
  word-wrap (`fb103454`), message metadata/work-log rows (`1916ac6d` — already
  ported), workspace file browser (`de8bdc10`), inline tool timeline
  (`649f4328`).
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

### Message metadata and work-log row polish

- Upstream commit: `1916ac6d` (`Rework message metadata, timestamps, and tool work log rows (#3022)`)
- Completed in this fork: 2026-06-12
- Notes: Chat timelines now use the upstream metadata and timestamp presentation, tool/work-log rows have clearer success/failure/neutral affordances, review-comment contexts render as structured cards, and focused timeline/session coverage was adapted for this fork's Vitest setup.

## Want To Implement

### Web UI, UX, and performance polish

- Representative commits: `7f741a56` (`Misc markdown styling improvements (#3017)`), `a4757c26` (`Composer polish: focus ring, send/stop buttons, command menu, context meter, answer panel (#3018)`), `0b40ea62` (`Extract changed files card with compact aligned diff stats (#3023)`), `343061a0` (`Misc chrome polish: header badges, plan sidebar, diff panel, empty state (#3027)`)
- Decision: Want to implement.
- What it contains: Model picker virtualization, chat timeline metadata, markdown rendering improvements, composer controls, changed-file display, header/sidebar/diff polish, and visual consistency work.
- Why it matters: These changes improve day-to-day usability and perceived quality. Some, like model picker virtualization, are also performance fixes when provider catalogs grow. Others make long sessions easier to scan by improving timestamps, tool rows, markdown rendering, and changed-file summaries.
- Implementation guidance: Prefer extracting the underlying usability/performance improvements over copying every visual detail. Keep local UX consistency in mind, and verify dense chat timelines, long model lists, markdown-heavy messages, and small viewports.

### Tooling, CI, and release pipeline migration

- Representative commits: `b440dd18` (`Migrate workspace to Vite+ and pnpm (#2899)`), `f60def20` (`Migrate tests to vite-plus test APIs (#2964)`), `4c262c4b` (`[codex] split ci workflow jobs (#2940)`), `6a1c4da5` (`fix(release): use workspace electron-builder for desktop packaging (#2938)`), `e4643ecc` (`fix: build web before desktop release packaging (#2934)`), `52ae8e88` (`fix(release): preserve desktop artifact arch (#2943)`)
- Decision: Want to implement.
- What it contains: Package manager/build-system migration, CI restructuring, release packaging fixes, desktop artifact corrections, dependency closure handling, and workflow scripts.
- Why it matters: Build and release reliability determine whether fixes actually reach users. Upstream likely fixed real packaging and CI problems here, especially around desktop artifacts and dependency closures. The package-manager/build-system migration is larger than a normal backport, but the release hardening value is high enough to keep this group on the implementation list.
- Implementation guidance: Do not change package manager or test runner semantics inside unrelated tasks. Handle this as an explicit tooling/release project. Decide within that project whether GedCode follows upstream to pnpm/Vite+ or ports only the release/CI fixes that are compatible with the current Bun workflow. Until that task starts, repo instructions still require `bun fmt`, `bun lint`, and `bun typecheck`.

## Deferred Indefinitely

No upstream groups are categorized here yet.

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
