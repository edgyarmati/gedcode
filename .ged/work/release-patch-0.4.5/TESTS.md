# Verification plan

All release gates run from the repository root with
`PATH=/Users/edgy/.local/share/mise/installs/node/24.13.1/bin:$PATH`, Bun 1.3.11, and Node 24.13.1.
Logs and command timing/exit codes: `.ged/runtime/release-patch-0.4.5/`.

Setup: verify Node/Bun/Electron paths and run `bun install --frozen-lockfile` as CI does;
installation must not alter tracked dependency metadata.

1. `bun fmt CHANGELOG.md`: scoped format; no other product files should change.
2. `bun run fmt:check`: repository formatting passes without broad rewrites.
3. `bun run lint`: configured whole-repository lint passes.
4. `bun run typecheck`: all workspace typechecks pass using the serial wrapper.
5. `bun run test`: uncached full workspace Vitest release run passes.
6. `bun run release:versions:check`: all release manifests and bun.lock still agree on 0.4.4.
7. `bun run release:smoke`: temporary-fixture version/update-manifest tooling checks pass.
8. `bun run release:audit`: no unresolved high/critical finding; record failure if present.
9. `bun run --filter=@t3tools/web test:browser:install`: required Chromium runtime available.
10. `bun run --filter=@t3tools/web test:browser`: all configured real Chromium browser tests pass.
11. Compare the starting Unreleased body against the final 0.4.5 body, check one target heading,
    unchanged release metadata, `git diff --check`, `git status --short`, and empty staged diff.
12. Read-only remote recheck via `git ls-remote origin` and `gh` scoped to edgyarmati/gedcode.

Browser tests are required by both CI and release preflight despite release.sh not invoking them.
Desktop multi-OS packaging/signing, Linux xvfb startup smoke, signed Sparkle feeds and final
artifact/manual smoke are downstream workflow/publication gates; this preparation does not claim
they ran. Do not run release.sh dispatch or dry-run against intentionally uncommitted notes.

## Results — verification blocked, evidence collection complete

| Command | Result / exit | Evidence |
| --- | --- | --- |
| `node --version && bun --version && node -e "console.log(require('./apps/desktop/node_modules/electron'))"` | passed / 0: Node 24.13.1, Bun 1.3.11; existing Electron executable resolved (not launched). | `toolchain.log` |
| `bun install --frozen-lockfile` | passed / 0: Frozen install passed; 679 installs / 822 packages checked, no metadata changes; configured Effect TSGo patch ran. | `install.log` |
| `bun fmt CHANGELOG.md` | passed / 0: Scoped formatter passed; changelog remains an exact two-line heading insertion. | `format-changelog.log` |
| `bun run fmt:check` | passed / 0: 1461 files checked; all matched files correctly formatted. | `fmt-check.log` |
| `bun run lint` | passed / 0: Exit 0, 76 existing warnings; no lint errors. | `lint.log` |
| `bun run release:versions:check` | passed / 0: Four release manifests and Bun workspace metadata still agree on 0.4.4. | `versions.log` |
| `bun run release:smoke` | passed / 0: Release metadata/update-manifest fixture checks passed; temporary smoke fixture removed by script. | `release-smoke.log` |
| `bun run release:audit` | failed / 1: Exit 1: four high Browserslist/TOML advisories block release (same as current-main CI). | `audit.log` |
| `bun run typecheck` | failed / 2: Exit 2: native TSGo binder SIGSEGV in web; 8 successful tasks, server/desktop checks not completed. | `typecheck.log` |
| `bun run test` | failed / 1: Exit 1: 4112 passed, 2 failed, 1 skipped tests; 454 passed / 2 failed files; 10 of 11 workspace tasks passed. | `test.log` |
| `bun run --filter=@t3tools/web test:browser:install` | passed / 0: Playwright Chromium install command exited 0. | `browser-install.log` |
| `bun run --filter=@t3tools/web test:browser` | passed / 0: Real headless Chromium: 23 files / 240 tests passed in 40.10s; console diagnostics retained in log. | `browser-test.log` |

Final validator: all 13 notes and older release history preserved byte-for-byte; exact two-line
heading insertion; only the five intended changelog/context files differ; package manifests,
bun.lock, release scripts/workflows unchanged; HEAD unchanged and index empty. Diff check passed.
No application tests added/updated. Full command/timing/log evidence is in the runtime directory.

1. **Audit / current-main CI** — `scripts/audit-production-dependencies.ts:94` correctly fails
   the configured release policy on four high findings:
   - Browserslist GHSA-c83g-rgw3-j3cx (unbounded query cache / OOM).
   - Browserslist GHSA-73wf-gq98-2v4g (custom-stat crash / prototype write).
   - toml GHSA-82x6-q7mm-w9cf (uncontrolled recursion).
   - toml GHSA-v5mp-jgw5-2x6j (prototype pollution).
   Reachability/classification remediation is not part of this task; no new exception was added.
2. **Typecheck** — native TSGo crashes with SIGSEGV in its binder while checking `@t3tools/web`
   after 8 successful tasks. `bun run typecheck` exits 2; this is not a successful typecheck or
   proof of an application type error. The run used the configured post-install patch with no
   alternate compiler/flags. Root cause is uninvestigated; no silent rerun replaces this evidence.
3. **Full Vitest** — two server failures, both `OrchestrationCommandIdConflictError` at
   `apps/server/src/orchestration/Layers/OrchestrationEngine.ts:438`:
   - `CheckpointReactor.stageGate.test.ts:682`: dedups timeout/diff paths using shared command ID.
   - `ProviderRuntimeIngestion.test.ts:756`: completes stage after fail-loud missing-diff timeout.
   The server result is 2059 passed / 2 failed / 1 skipped tests in 242 files. All other ten
   workspace test tasks passed. No test was changed, skipped by this task, or rerun to hide failure.

The configured Chromium browser suite passed despite console WebSocket schema diagnostics in its
log. Required reviewer remains outstanding; green browser results do not waive the three failed
local gates or failed current-main CI. No dependency, compiler, runtime, or test remediation was
attempted. Downstream multi-OS build/artifact/startup/signing/manual checks remain with publication.

## Remediation verification plan

RF-01: preserve reachability and advisory metadata; audit must have zero new high blockers without
policy edits. Exercise Effect TOML parsing for valid nested config, malformed input and dangerous keys.
RF-02: original configured web check reproducer and repeated post-fix checks, then full typecheck;
no alternative compiler/no-check flags. Record executable versions and cache evidence.
RF-03: focused CheckpointReactor.stageGate/ProviderRuntimeIngestion and command fingerprint/engine
suite; assert exactly one completion across timeout/diff races while real command-ID conflicts fail.
RF-04: supported Node24/Bun frozen install, fmt, fmt:check, lint, release versions/smoke/audit,
full typecheck, full Vitest, Chromium install/browser suite. Exact logs/exit codes stored separately
under runtime remediation to preserve the original failed preflight. Review `git diff --check` and
`git diff --cached --exit-code`. Platform packaging/signing/publication remain parent-owned gates.

## Remediation results (2026-09-08, Node24.13.1/Bun1.3.11)

- Security tests: 11 passed, including parser depth/isolated exact prototype-traversal exploit,
  compatibility, and unchanged four-advisory blocking policy. Frozen install and audit passed.
- Focused server: 85 passed across stage receipt/engine/checkpoint/ingestion/fingerprint suites.
  SQLite reopen tests cover both winner orders, plan/work/verify, one/two-event receipts and changed
  identity rejection. Server/scripts/web affected typechecks passed on the configured compiler.
- Full release gates: fmt/fmt:check (1464 files), lint (76 pre-existing warnings), versions (0.4.4),
  release smoke, audit, full `bun run test` (458 files, 4125 passed, 1 skipped), Chromium install,
  browser suite (23 files, 240 passed) and additional local desktop build all passed.
- Full typecheck FAILED during this same release-gate run: native TSGo parser SIGSEGV in contracts,
  after two successful tasks. Earlier web binder SIGSEGV and passing focused/stress checks retained.
  Passing reruns are NOT evidence the intermittent native crash is fixed.
- Same-compiler 0.11.5 patch experiment passed focused stress but failed release-order typechecking
  with transient module resolution errors. Current 0.43.0 install failed its prepare step because
  the existing native-preview host is unsupported; its README specifies TS7.0.2/7.1 nightly.
  Neither candidate remains in package.json/bun.lock; original compiler restored and affected server/
  scripts checks passed. No compiler/diagnostic/runner flags changed; parent decision needed for
  coordinated supported compiler-host migration, not a degraded fallback.
- Exact attempts, failures, timestamps, exits and unabridged logs: runtime `remediation/commands.jsonl`
  and `remediation/logs/`. `remediation/full-gates.json` explicitly retains full typecheck exit 2.
- Required independent reviewer outstanding. Remote current-main CI cannot be declared green from
  uncommitted local work. Signed matrix builds/Linux startup smoke/publication remain downstream.

## Coordinated migration verification

Evidence is isolated in runtime `migration/` so original preparation/remediation failures remain
intact. Node24.13.1 PATH and Bun1.3.11 for every execution. Capture installed package docs, host
version, actual patched binary version/hash vs the exact supported distribution. Compare all
base/web rule severities before/after and prove representative inherited/web rules trigger
real compiler failures, while conforming fixture passes. No diagnostic suppression in fixtures.

Fresh-process checks remove only generated workspace .tsbuildinfo before each attempt (not
runtime evidence); contracts/client-runtime have no composite cache but still start a new
compiler process. Stress 60 contracts + 20 web + 10 client-runtime, then three cold full
workspace checks. Turbo typecheck/test are already uncached. Failures remain release blockers.
Final gates: frozen install; bun fmt; bun run fmt:check; bun lint; bun run typecheck;
bun run test; bun run release:versions:check; bun run release:smoke; bun run release:audit;
Chromium install and browser suite; bun run build:desktop. Record counts/warnings/residuals.
Complete review scope is every pending change since eaa41bc72, not just migration files.

## Coordinated migration results (2026-09-14, Node24.13.1 / Bun1.3.11)

- Actual host TS7.0.2, Effect0.43.0; all eleven workspace compiler resolutions report
  `Version 7.0.2+effect-tsgo.0.43.0`. Installed native tsc SHA256 matches the version-specific
  Effect distribution: `fcb42f8d69ed194eba73fb22078532261681d4d1c2113b9a012954170d90f437`.
  Frozen install is idempotent (680 installs / 842 packages checked, no lock changes).
- No tsconfig/diagnostic/exit-code settings changed: 28 base entries, five web overrides and all
  shared documented default severities preserved. Five tooling tests prove actual patch, all
  runners, ordinary TS errors, base Effect error exit codes, web allowance and inherited error.
  Initial fixture resolution mistake and corrected passing run are both retained.
- Compatibility blocker: unchanged nodeBuiltinImport:error now includes node:crypto, rejecting
  packages/ssh/src/command.ts and 15 server files. Independent server typecheck confirms all
  diagnostics; desktop check passes. No API/crypto/security code changed or suppression added.
- Cold stress: 60 contracts + 20 web + 10 client-runtime pass, no native SIGSEGV or transient
  resolution recurrence. Only generated target tsbuildinfo removed; fresh compiler each attempt.
  Final release-order full cold typecheck fails the deterministic crypto diagnostic (exit1).
  Three planned cold whole-workspace repetitions deferred until compatibility is repaired.
- Other final release gates pass: fmt/fmt:check (1465 files); lint (76 existing warnings); full
  `bun run test` (459 files, 4130 passed, one existing skipped, 11 tasks); versions (0.4.4);
  release smoke (isolated fixture); production audit (no new exceptions); Chromium install;
  browser tests (23 files, 240 tests); desktop build (3 uncached tasks). Browser console schema
  errors and audit residuals remain visible. No signed installers/manual artifact smoke/remote CI.
- Complete exact command/time/exit/log evidence: runtime migration/commands.jsonl, full-gates.json,
  stress-results.json, diagnostic-equivalence.json, compatibility-diagnostics.txt, logs/.
  Starting remediation files are byte-preserved except authorized manifests/lock/context/notes.
  Full diff and final validation/empty-index proof recorded for required independent review.

## Recovery verification (GC-04 continuation)

Recovery verified the earlier final gate manifest contains all successes: 14 gates, including
three cold full typechecks; isolated clean/repeat install also has seven successful steps and
metadata-preservation/cleanup confirmation. These logs remain intact in guarded-crypto/.
The partial timeout message was stale, not proof that these gates had not run.

Run RC-02 once with Node24.13.1/Bun1.3.11, no cwd reinstall or repeated stress. RC-03 repeats only
bounded clean-install validation in a hashed isolated snapshot, additionally proving cwd install
preservation. Commands/exits/logs and incremental STATE/SESSION-SUMMARY updates are under runtime
recovery/. Final preservation hashes must show zero application/tooling/dependency edits during
recovery. No prior failure logs may be overwritten or treated as passing. Required independent
security/aggregate reviewer and unrun remote-platform/publication checks remain explicit risks.

### Recovery final outcomes (2026-09-14, Node24.13.1 / Bun1.3.11, darwin/arm64)

- `bun fmt` + `bun run fmt:check`: PASS, 1472 files; product hashes unchanged.
- `bun lint`: PASS, zero errors and 76 existing warnings; no policy broadening.
- `bun run typecheck`: PASS, 11/11 uncached serial tasks. Reused prior guarded-crypto three cold
  full 11/11 passes plus migration 90 package passes; no additional stress runs.
- `bun run test`: PASS, 462 files, 4239 passed / one existing skipped, 11/11 uncached tasks.
- Versions: PASS, manifests/lock intentionally 0.4.4. Release smoke: PASS (isolated metadata
  fixture only; its resolution/download log does not describe cwd dependency changes).
- Production audit: PASS under unchanged policy. Retained low esbuild, existing documented high
  path-to-regexp exception and two moderate qs findings; no new audit exceptions.
- Chromium install + browser suite: PASS, 23 files / 240 tests. Existing console schema errors
  retained, not silently suppressed. Forced desktop build: PASS, three uncached tasks; chunk/
  dynamic-import/performance warnings retained. No installer/signing/startup/manual smoke claim.
- Isolated clean/repeat install: PASS, own empty Bun cache, 1663 hashed source files; actual
  compiler fixtures 14/14 before AND after repeat install, native guard 55/55; full typecheck
  11/11 uncached. Snapshot metadata unchanged, cwd install manifests/links/native binaries unchanged,
  snapshot/cache removed. Native SHA256 matches Effect's 7.0.2 replacement exactly.
- No recovery code/test/dependency edits needed. All original implementation tests preserved.
  Exact command timestamps/exits/logs: runtime recovery/commands.jsonl, full-gates.json,
  clean-install-results.json. Previous failed attempts retained, not recategorized as successes.

Required independent security and aggregate review remains outstanding. Prepared platform CI is
not run, and local acceptance is not permission to stage/commit/publish or proof of remote readiness.
