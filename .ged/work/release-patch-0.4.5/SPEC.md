# Prepare stable patch 0.4.5

## Goal and clarified contract

Prepare the explicitly requested next stable patch from clean `main` at
`eaa41bc722cc393ac21075d6e58fdb949185c887`, including the broad checkpoint `50ded1b5e` and
reviewed Codex/Astra fix. The request concretely fixes scope, checks, publication ownership,
and failure policy; no additional product clarification is needed.

## Policy and version decision

- Read `docs/release.md`, `release.sh`, `scripts/resolve-release-version.ts`, version-consistency
  and update tooling, `.github/workflows/ci.yml`, and `.github/workflows/release.yml`.
- On 2026-09-08, origin/main equals the starting local HEAD; latest stable GitHub release is
  `v0.4.4`, published 2026-08-28. `sparkle-feed` is a machine-managed prerelease, not a version.
- Current release manifests and lockfile baseline are 0.4.4. Stable patch resolver returns
  `0.4.5`; no remote `v0.4.5` tag exists at inspection.
- Move all existing Unreleased notes into `0.4.5 - 2026-09-08`, preserving their text and order.
  Keep an empty Unreleased heading for subsequent work.
- Do not pre-bump manifests or bun.lock: the build job aligns versions in its checkout, and
  stable finalization records published versions on current main with deterministic lock updates.

## Constraints

- Sole writer. No subagent launches. Only origin edgyarmati/gedcode remote inspection; no other
  repository fetches, comparisons, or inspection. No credentials in output or evidence.
- No staging, commits, pushes, tags, workflow dispatch, publication, or installed-app restart.
- No bypasses, fallback/degraded behavior, dependency upgrades, or unrelated remediation.
- Report failures as blockers and collect remaining independent gate evidence without masking them.
- Use `bun run test`, never Bun's native test runner. Full suite is authorized for release.
- Node 24.13.1 is already installed through mise and meets package engines; prepend its bin to
  PATH for gates instead of the ambient unsupported Node 26.0.0. Bun is pinned 1.3.11.
- Preserve unrelated completed work under `.ged/work/root`; this named work directory isolates
  this release's planning artifacts and runtime evidence.

## Acceptance criteria

1. Scope is changelog finalization plus required durable context; release metadata/code unchanged.
2. Run formatting, lint, full workspace typecheck/Vitest, version consistency, release smoke,
   production audit, Chromium runtime installation and browser tests; preserve exit codes/logs.
3. Record remote main, latest release, auth validity (without tokens), current-main CI, gate results,
   changed files, no-staged-files proof, residual risks, and exact commands for independent review.
4. Clearly distinguish prepared notes from release readiness. Required reviewer and parent-owned
   commit/publication remain outstanding. Failed gates mean release is not ready.

## Initial blocker

Current-main CI run 34226518172 failed at production audit. Four high findings affect Browserslist
(GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g) and toml
(GHSA-82x6-q7mm-w9cf, GHSA-v5mp-jgw5-2x6j). This was reported before implementation;
no remediation is authorized in this release-preparation slice.

## Authorized blocker remediation follow-up

The parent explicitly authorizes fixes for all three blockers above (including the TSGo crash and
stage-completion command conflicts recorded in runtime evidence). This supersedes the preparation-only
constraint on dependency/code changes. Preserve all prior work, versions, gates and audit policy.
Trace vulnerable dependencies and prefer patched compatible updates; ask parent if an unpatched
package requires an exception or incompatible replacement. Diagnose the installed configured compiler
under Node 24/Bun, never silently substitute a degraded compiler/flags. Fix shared production
idempotency, not just tests. Add focused regressions and 0.4.5 notes (also Unreleased per AGENTS).
Success: all local release gates green, exact evidence retained, no staged files, reviewer still required.
No publication or remote mutation is authorized. Contract is concrete; no product questions remain.

## Approved coordinated compiler migration

The user/parent explicitly approved TypeScript 7.0.2 + Effect TSGo 0.43.0 to resolve the
intermittent native compiler release blocker. This supersedes the earlier native-preview-only
constraint. Contract is concrete; no further product clarification is needed. Follow installed
package README/schema/CLI documentation, align manifests/lock/scripts/install hook as required,
and preserve every existing diagnostic severity (translate removed options only to equivalent
supported configuration). No suppressions, relaxed gates, degraded paths or unrelated refactors.
Ask parent if materially different migration or diagnostic changes become necessary. Preserve
all pending release/security/stage-receipt fixes and original failed evidence.

Success: supported host and actual patched native binary verified; focused tooling regressions;
repeated fresh-process/cold-cache checks without recurrence; all authorized full release gates
on final dependencies (frozen install, fmt/fmt:check, lint, full typecheck, full Vitest, release
versions/smoke/audit, Chromium install/browser suite, local desktop build). Record in pending
0.4.5 notes, not a pre-bump. Exact commands/exits/logs and complete diff since eaa41bc72 support
required independent review. No staging/commit/push/tag/dispatch/publication/app restart. Green
local checks do not establish remote CI or signed/artifact publication readiness.

## Timed-out implementation recovery (2026-09-14)

User authorizes continuation as sole writer, not reimplementation. Guarded-crypto/SPEC.md is the
latest approved security boundary. Preserve every pending application/tooling/dependency edit.
Recovery found GC-04 gates and isolated install already completed successfully after the last
partial agent message, but durable state was not finalized. Reconcile existing evidence first;
perform one final release-order verification with per-gate checkpoints and source hashes, reuse
existing three cold full typechecks and 90 package stress attempts rather than repeat stress.
Validate a clean/repeat install only in an isolated source snapshot, with cwd dependency/compiler
hashes unchanged. No auth edits, expanded policy/suppression, degraded paths, stage/commit/push/
tag/dispatch/publish/restart. Success is checked local evidence and an empty index; security and
aggregate independent review, remote platforms and publication remain outstanding.
