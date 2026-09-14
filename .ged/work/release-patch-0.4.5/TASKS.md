# Tasks

- [x] RP-01 — Read policy, check local cleanliness/auth/origin releases/main/CI, resolve version.
  Verify: main equals reviewed HEAD, next patch is 0.4.5, no existing target tag; capture remote
  facts in runtime evidence. Initial CI audit blocker reported; no remediation.
- [x] RP-02 — Finalize every existing Unreleased entry under the dated 0.4.5 heading.
  Verify: original bullet text/order unchanged, no release package or lockfile diff; scoped format.
- [x] RP-03 — Run local release preflight gates with supported Node and pinned Bun.
  Verify: per-command logs and actual exit codes for fmt:check, lint, typecheck, full Vitest,
  release:versions:check, release:smoke, release:audit, browser install and browser tests.
  Failures block publication but do not suppress independent gate evidence.
- [x] RP-04 — Recheck origin/main/CI, inspect final diff, write STATE and SESSION-SUMMARY evidence.
  Verify: explicit readiness, reviewer outstanding, exact changed files, empty index, no publication.

## Plan tightened after RP-01

CI already blocks release at audit; complete RP-02 and independent verification, then hand off
blockers instead of attempting a release wrapper or unrelated fixes. The dirty changelog is
intentional and cannot meet release.sh's clean-worktree gate until the parent reviews/commits.

## Follow-up requiring separate authorization (not implementation scope)

- Resolve the four blocking Browserslist/TOML advisories without broad exceptions or degraded paths,
  obtain green current-main CI, then repeat release preflight on the exact reviewed publication SHA.

## RP-03 failure update

- Local audit reproduced all four high findings; no exception or dependency changed.
- Full typecheck exited 2 at `@t3tools/web`: native TSGo binder SIGSEGV after eight successful
  package tasks. Server/desktop typecheck tasks did not complete. Frozen install passed first,
  including the configured Effect TSGo patch; no alternate compiler or degraded flags are used.
- Continue the already-planned independent full Vitest/browser gates, retain the original failure
  log, and stop at a blocked handoff. Investigating/fixing the compiler crash requires follow-up.

- Full Vitest finished with two server failures: CheckpointReactor.stageGate.test.ts:682 and
  ProviderRuntimeIngestion.test.ts:756, both reporting OrchestrationCommandIdConflictError from
  OrchestrationEngine.ts:438. Ten other workspace test tasks passed. Preserve failure evidence;
  fixing stage-completion command fingerprint interactions is separate authorized work.

## Final checkpoint

All planned commands executed and recorded. Chromium: 23 files / 240 tests passed. RP-03 is checked
as execution/evidence complete, NOT as gates green. Release is blocked by audit, TSGo crash and
two server test failures; RP-04 confirms unchanged main, failed exact-main CI, intended five-file
scope, no staged files, and required reviewer/publication left to parent.

## Authorized remediation slices (supersede report-only follow-up)

- [x] RF-01 — Trace audit paths/advisory patched ranges, apply compatible security updates and
  parser regressions if necessary. Verify frozen install, focused dependency/audit tests and audit.
- [x] RF-02 — Reproduce configured TSGo crash under Node24; isolate compiler/cache cause and repair
  supported configuration/package if needed. Verify unchanged package typechecks repeatedly.
- [x] RF-03 — Inspect shared timeout/diff stage-completion fingerprints; fix production idempotency
  without accepting different semantic payloads. Add regression assertions for both event orders,
  persistent replay and legitimate conflict rejection. Verify focused server tests and typecheck.
- [x] RF-04 — Update release notes; run fmt/lint/affected checks then all release gates including full
  `bun run test` and browser tests. Preserve failed attempts, tighten plan on failures, review diff,
  record gate manifest/summary and empty index proof; do not publish.

## Remediation execution checkpoint

RF-01 implemented: compatible security overrides, dependency lock, runtime parser/security policy
regressions. A stale Bun TOML link was caught by tests; force-frozen reinstall corrected it.
RF-02 diagnosis bounded: original stack is native incremental-snapshot binder invalid AST pointer;
configured compiler has passed baseline, warm and 21 cold checks, plus full workspace typecheck.
Do not invent a root cause or claim a compiler fix; retain as an explicitly unresolved recurrence risk
for parent/reviewer disposition. No alternate binary or weakened options used.
RF-03 implemented: accepted deterministic completion receipts reconcile only stored observations;
full fingerprints and immutable identity remain enforced. Persistent close/reopen, one/two-event
receipt paths and original two regressions pass. Test fixture state/type issues were corrected,
not hidden by relaxing assertions. RF-04 now runs independently to completion.

## RF-02 reopened after full gate reproduction

Full preflight reproduced native SIGSEGV in contracts parser, while original failure was in web binder.
Exact compiler hash matches Effect's installed 0.11.4 distribution; no corrupted patch or alternate
compiler. Fault pointer decodes to path text, supporting native memory corruption rather than a source
type error. Repeated configured contracts checks additionally produced a transient missing-vitest
resolution error while its installed link/files remained present. Nearest same-line compiler patch
0.11.5 exists; evaluate that supported update first, preserving native host, flags and diagnostic rules.
Do not jump to a different compiler or disable checks. If it does not resolve reproduction, stop for
parent decision on a larger compiler upgrade/upstream investigation. Repeat full gates after any fix.

0.11.5 did not pass release-order verification, despite 80 repeated focused checks. The same native
compiler's current maintained release 0.43.0 is available. Tighten RF-02 to evaluate that package
update with the original native host, configuration and all diagnostic severities; stop for parent
if it demands broader code migration or any weakened rules/alternate tooling. Do not retain 0.11.5
as a purported fix. All failed attempts remain evidence.

## Final remediation disposition

- RF-01 and RF-03 implemented and verified, release notes updated; no audit policy/code rules weakened.
- RF-02 BLOCKED: 0.43.0's prepare step requires a supported TypeScript7 host, not the configured
  native-preview package. Restored original 0.11.4/compiler lock. Ask parent to authorize coordinated
  TypeScript7.0.2 + Effect TSGo0.43.0 migration with equivalent diagnostics, or maintain release hold
  and investigate the current native compiler upstream. No claim the native defect is fixed.
- RF-04 checks executed and evidence complete, NOT release-ready: full typecheck remains a blocker.
  Do not rerun until green and discard failed evidence. Independent reviewer and publication remain
  parent-owned. No commits, staging, tags, dispatch, auth edits or installed-app restart.

## Approved compiler migration slices

- [x] TM-01 — Inspect installed 0.43.0 docs/schema/patch CLI; capture baseline and diagnostic
  mapping. Migrate pinned host/plugin, workspace commands and supported config/install hook.
  Verify lock scope, frozen install, actual patched binary/version/hash, narrow typechecks.
- [x] TM-02 — Add focused toolchain regressions: manifest/runner alignment, documented equivalent
  diagnostic policy, and real compiler negative/positive probes. Record pending 0.4.5 notes.
  Verify focused Vitest, fmt/lint/scripts typecheck, no source suppressions.
- [x] TM-03 — Stress final configured compiler with 60 cold contracts, 20 cold web and 10 cold
  client-runtime checks; retain every attempt and stop on failure. Run three cold full workspace
  typechecks (serial wrapper, no altered flags). Verify no crashes or transient missing modules.
- [x] TM-04 — Run all final release gates on final dependencies in documented release order;
  preserve command exits/logs. Check preserved prior fixes, complete diff, empty index; update
  durable state/summary and structured acceptance report for parent-required independent review.

If any slice fails, retain failure, tighten this plan and repair only approved migration scope;
new diagnostic incompatibilities require parent decision, not silent suppression or rerun masking.

## TM-01 compatibility blocker / tightened plan

Supported install/patch and initial contracts/scripts/web checks pass, but full typecheck now fails
on `nodeBuiltinImport` for `node:crypto` (SSH and 15 server files). Server/desktop independent checks
confirm only server fails. Base/web config is unchanged. The new rule broadens coverage, including
security-sensitive credential storage and fingerprints; no equivalent selective configuration is
shipped. Parent decision requested before any crypto API migration or diagnostic-policy change.
Do not refactor those callers or suppress the diagnostic. Continue bounded TM-02 tooling evidence
and independent release gates. TM-03 may stress the passing reproducer packages, but retain the
known full-check failure; three identical failed full runs add no evidence and are deferred until
parent-approved compatibility repair. No local/remote readiness claim.

## Migration handoff checkpoint

- TM-01 installed and verified, NOT accepted: supported host/patch works, broader crypto diagnostic
  remains blocking. No source/config relaxation. New compiler retained for parent decision.
- TM-02 complete: five real compiler/toolchain tests pass; initial web fixture failed because its
  temporary directory resolved dependencies from root instead of web. Corrected fixture location
  to the owning workspace's node_modules; assertions/config/diagnostic levels unchanged.
- TM-03 partial: all 90 fresh-process checks pass (60 contracts, 20 cold web, 10 client-runtime).
  No native crash/transient missing module recurrence observed. Three cold full workspace checks
  remain deferred pending parent-approved deterministic crypto compatibility repair. The final
  release-order cold full check still fails; this is not evidence of whole-workspace readiness.
- TM-04 all independent gates executed, NOT gates green: frozen install, fmt/fmt:check, lint,
  full Vitest (459 files / 4130 passed / 1 skipped), versions, smoke, audit, Chromium install,
  browser tests (23 files / 240 tests), desktop build pass. Full typecheck fails nodeBuiltinImport.
  Required reviewer and publication remain parent-owned; exact evidence is in runtime migration/.

## Recovery slices (GC-04 continuation; no reimplementation)

- [x] RC-01 — Recover all approved plans, prior partial output, diff, gate/install evidence; capture
  immutable recovery source/evidence hashes and archive stale summaries. Verify index empty,
  Node24 available, no leftover gate process in this checkout. All GC gates found passed.
- [x] RC-02 — One release-order supported Node24/Bun checkpoint: fmt/fmt:check, lint, full typecheck,
  full `bun run test`, versions/smoke/audit, Chromium install/browser, forced desktop build. Record
  each exit/log and update runtime STATE/SESSION-SUMMARY immediately. Reuse three passing cold full
  checks and 90 package stress attempts; do not repeat stress. No cwd reinstall is needed.
- [x] RC-03 — Fresh isolated source snapshot with hashes: frozen install, actual compiler fixtures,
  guard fixtures, repeat install, identity/diagnostics recheck and full typecheck. Confirm snapshot
  metadata identical, cwd dependency/compiler hashes identical, clean snapshot removed. Preserve
  prior clean-install evidence. This is local macOS ARM64 validation only.
- [x] RC-04 — Final scope/preservation/index validator, exact aggregate diff and changed/test files,
  log hashes, updated plans/state/summary and structured acceptance report for independent review.
  If a gate fails, retain it and make only a bounded approved fix; no security-policy widening.

## Current local completion disposition

All requested local implementation and release-verification slices are now complete. Historical
failed attempts/parent holds above describe prior checkpoints; approved guarded-crypto boundary
and recovery results supersede those holds, not their evidence. Supported compiler now passes
90 cold package + three cold full probes and final full workspace release checks. Upstream root
cause of the old compiler crash remains unproven; no universal stability claim. Independent
security/aggregate review and remote-platform CI/publication readiness remain parent-owned gates.
RC-04 bundles source preservation, complete aggregate diff, exact commands and empty-index proof.
