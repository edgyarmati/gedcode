# Upstream Decisions

This document tracks decisions about upstream-only work from `pingdotgg/t3code`.
Use it before categorizing, cherry-picking, or reimplementing upstream commits.

Last reviewed against `upstream/main` at `57f6bf7e` on 2026-06-11.
At that point, local `main` matched `origin/main`, and `main...upstream/main`
was `117 83`: this fork was 117 commits ahead and 83 commits behind upstream.

## Categories

- **Want to implement**: We intend to port, cherry-pick, or reimplement this work. When an item in this section is completed, remove it from this list in the same task.
- **Deferred indefinitely**: Worth keeping in view, but not scheduled and not needed for current direction.
- **Not doing for now**: Explicitly out of scope for this fork unless product direction changes.
- **Needs decision**: Requires user/maintainer decision before implementation work starts.

## Want To Implement

### Reliability, runtime, and provider correctness fixes

- Representative commits: `57f6bf7e` (`Fix turn fold proejctions (#3041)`), `0baf1986` (`[codex] Reduce Git status polling churn (#3037)`), `ae7e88b0` (`[codex] Sync app-server protocol, service tiers, and provider startup (#3036)`), `300f7fd1` (`[codex] Avoid shell for system executables (#2950)`), `6ce6f678` (`[codex] Avoid shell for Windows environment probe (#2951)`), `a74dfd4f` (`[codex] Avoid shell for Node executable spawns (#2952)`), `e1ce9f85` (`fix: handle Claude Agent SDK 0.3.x system messages to stop runtime-warning flood (#2872)`), `75257d64` (`"claude system message" instead of "runtime warning" when using 4.8 from claude code (#2972)`)
- Decision: Want to implement.
- What it contains: Runtime projection fixes, reduced background git churn, protocol/schema synchronization with Codex app-server, provider startup behavior, safer process spawning, and provider event normalization.
- Why it matters: This group aligns directly with the repository priorities of performance, reliability, and predictable behavior under reconnects, restarts, partial streams, and provider edge cases. Several commits address correctness rather than presentation, and they reduce the chance that the app silently displays the wrong turn state, over-polls git status, misinterprets provider events, or spawns system processes in fragile ways.
- Implementation guidance: Do not merge this group wholesale. Treat it as a sequence of small backports with focused tests. Start with the fixes that are easiest to prove locally: projection correctness, git polling churn, provider event handling, and shell-spawn hardening.

### Provider and model additions

- Representative commits: `38ea6d48` (`feat(grok): add Grok CLI provider via ACP (#2809)`), `d78e02cd` (`Probe Cursor models via list_available_models (#2428)`), `de58ec8e` (`Add Claude Fable 5 model (#3009)`)
- Decision: Want to implement.
- What it contains: New provider support, dynamic model probing, provider catalog updates, provider-specific ACP extensions, and text-generation integration.
- Why it matters: Provider/model availability is user-facing. Keeping model catalogs fresh avoids stale choices in the UI, and dynamic probing can reduce hardcoded catalog drift. Broader provider support can also make GedCode useful in more local workflows, provided each provider is integrated with the same reliability expectations as Codex and Claude.
- Implementation guidance: Split small catalog/model updates from full provider additions. Existing-provider model updates can land as small tasks. New providers, such as Grok ACP, need separate implementation slices covering contracts, server runtime, settings UI, model selection, tests, and failure behavior.

### Web UI, UX, and performance polish

- Representative commits: `31533466` (`Model picker UI Improvements, Virtualize Model List (#3021)`), `1916ac6d` (`Rework message metadata, timestamps, and tool work log rows (#3022)`), `7f741a56` (`Misc markdown styling improvements (#3017)`), `a4757c26` (`Composer polish: focus ring, send/stop buttons, command menu, context meter, answer panel (#3018)`), `0b40ea62` (`Extract changed files card with compact aligned diff stats (#3023)`), `343061a0` (`Misc chrome polish: header badges, plan sidebar, diff panel, empty state (#3027)`)
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

### Desktop, SSH, and source-control fixes

- Representative commits: `49c1b646` (`fix(source-control): handle self-hosted GitLab, multi-account GitHub auth & azure devops web url (#2480)`), `4956415f` (`fix(desktop): Preserve SSH HTTP auth status (#2923)`), `f5849f7d` (`fix(ssh): Surface redacted stdout for failed commands (#2920)`), `b76f161d` (`fix(desktop): stop looping macOS TCC permission prompts (#2745)`), `f0116e44` (`fix(desktop): Include standard Linux AppImage icons for Niri/Noctalia (#2915)`)
- Decision: Want to implement.
- What it contains: Source-control provider edge cases, SSH diagnostics, desktop auth status preservation, macOS permission-loop behavior, and Linux desktop integration fixes.
- Why it matters: This group is close to a reliability bucket, but it is more specific to local workstation and packaged desktop workflows. The source-control fixes address real-world repository hosting setups: self-hosted GitLab, multi-account GitHub auth, and Azure DevOps URL handling. Those are the kinds of edge cases that make an app feel unreliable when they fail, because the core workflow may be blocked even though the user's repository setup is valid. The SSH fixes improve diagnosis and state preservation, especially when remote or tunneled environments fail. The desktop fixes reduce platform-specific friction, such as repeated macOS permission prompts or missing Linux AppImage icons.
- Implementation guidance: Backport one fix at a time and verify against the affected provider or platform path. These changes do not require adopting upstream mobile/cloud direction, but they may depend on upstream refactors around source-control services, SSH command handling, or desktop packaging.

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

## Needs Decision

No upstream groups are awaiting categorization right now.
