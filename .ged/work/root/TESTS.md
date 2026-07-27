# TESTS — Replacement Landing for Existing Pull Requests

## Planned Coverage

- Decode legacy landing JSON without hash metadata.
- Project completed landing at hash A, then later Work/Verify at hash B, as stale/reapproval-required.
- Approve a pending land gate for freshly verified hash B when the task already has a PR for hash A.
- Preserve idempotency when the approved hash is already published.
- Reject replacement approval when verification, clean HEAD, or gate content does not match.
- Force-with-lease push the existing PR branch after rebase.
- Update the existing PR title/body from the newly approved proposal.
- Record successful replacement publication against the same PR and hash B.
- Render and execute the pending replacement gate in the web UI.
- Run `bun fmt`, `bun lint`, focused Vitest files with `bun run test`, and narrow relevant package
  typechecks.

## Evidence

| Check | Result |
| --- | --- |
| Contracts: `bun run test orchestration.test.ts` | 70 passed |
| Server focused landing/state/Git/provider suite | 203 passed across 8 files |
| Web landing presentation logic | 5 passed |
| Web browser land-gate action | 1 passed, 22 skipped by filter |
| `bun fmt` | Passed; 1,426 files formatted/checked |
| `bun lint` | Exit 0; existing repository warnings only |
| `packages/contracts`: `bun typecheck` | Passed |
| `apps/server`: `bun typecheck` | Passed |
| `apps/web`: `bun typecheck` | Passed |
| `git diff --check` | Passed |

The focused reactor regression proves replacement landing uses `forceWithLease: true`, calls
`updateChangeRequest` with the existing PR URL and approved proposal, does not create a second PR,
and records the replacement `publishedHash`.

An attempted run of `integration/orchestratorLanding.integration.test.ts` is currently blocked by
the existing fixture requesting land gates without the now-required exact PR title/body. The failure
occurs at `task.gate.request` before replacement-landing code executes; it is unrelated to this
change and was not expanded into scope.

## PM Prompt Prefix Verification Plan

- Contracts: decode missing global/project prefix fields without breaking persisted data.
- Resolution: project omission inherits the global prefix; explicit project text overrides it;
  explicit project empty text suppresses the global prefix.
- Runtime: the resolved prefix appears once after the immutable built-in PM instructions.
- Web logic: global and project drafts preserve and serialize prefix values and inheritance intent.
- UI: global and project settings render accessible PM prompt-prefix textareas.
- Quality gates: `bun fmt`, `bun lint`, narrow package typechecks, and focused Vitest files.

## PM Prompt Prefix Verification Evidence

| Check | Result |
| --- | --- |
| Contracts config tests | 21 passed |
| PM runtime tests | 52 passed |
| Web global/project settings logic tests | 17 passed |
| Global Orchestrator settings browser test | 1 passed |
| `bun fmt` | Passed on 1,426 files |
| `bun lint` | Exit 0; existing repository warnings only |
| `packages/contracts` typecheck | Passed |
| `apps/server` typecheck | Passed |
| `apps/web` typecheck | Passed |
| `git diff --check` | Passed |

Manual diff review confirmed that custom PM instructions append after the mandatory built-in prompt,
project overrides preserve inheritance intent, and global/project changes invalidate active PM
runtimes without changing the `plan`, `work`, and `verify` worker-role contract.

## Worker Thread Continuation Verification Plan

- PM system prompt: require a first bounded correction to use `steerStage` on the current viable stage.
- Fresh-attempt boundary: require new attempts for independent judgment, materially different
  approaches, capability changes, bad/exhausted context, and terminal provider/session failures.
- Verification loop: require implementation findings to return to Work and a fresh Verify afterward.
- Tool metadata: distinguish continuing an attempt from starting a new auditable attempt.
- Quality gates: `bun fmt`, `bun lint`, server typecheck, focused Vitest files, and `git diff --check`.

## Worker Thread Continuation Verification Evidence

| Check | Result |
| --- | --- |
| PM runtime, tool metadata, and built-in playbook tests | 111 passed across 3 files |
| `bun fmt` | Passed on 1,426 files |
| `bun lint` | Exit 0; existing repository warnings only |
| `apps/server`: `bun typecheck` | Passed |
| `git diff --check` | Passed |

Manual diff review confirmed that a bounded correction to the current viable Plan/Work attempt now
prefers `steerStage`, while independent judgment, materially different approaches, capability/model
changes, context or terminal-session recovery, failed continuation, and post-newer-stage correction
remain fresh attempts. Verifiers still cannot repair implementation and every post-fix validation is
a fresh Verify.

## 0.4.0 Release Candidate Verification Evidence

The release candidate includes the completed orchestrator, provider, workflow, landing, and release
documentation changes recorded in the 0.4.0 changelog. The pre-existing working tree was split into
atomic commits before release preparation; no unrelated changes were folded into the release notes
or test fixes.

| Check | Result |
| --- | --- |
| Full workspace `bun run test` | Passed; 231 test files, 1,884 passed, 1 skipped (1,885 total) |
| `bun fmt` | Passed; 1,426 files formatted/checked |
| `bun lint` | Exit 0; existing repository warnings only |
| Full workspace `bun typecheck` | Passed; 12/12 packages |
| Focused landing integration tests | Passed; 6 tests |
| Focused Claude adapter tests | Passed; 61 tests |
| Focused Phase 4/pipeline/live-globals integration tests | Passed; 7 tests across 3 files |
| Focused GED manifest test | Passed; 3 tests |
| `bun run release:smoke` | Passed |
| `git diff --check` | Passed |

The full suite emits expected test-injected warnings for unsupported synthetic VCS operations,
best-effort Codex tripwire probing, and no-change baseline inspection. These are covered behaviors,
not failed assertions. The release candidate keeps the documented compatibility boundary: workers
retain full host/backend access, while worktree ownership, protected-ref hooks, admission limits,
and the best-effort Codex tripwire remain active safeguards rather than a security sandbox.

## Cross-platform Test Stabilization Evidence

The release preflight exposed macOS-specific temporary-directory fixtures and a reactor assertion
that observed session startup before the asynchronous turn send completed. The fixtures now derive
their roots from the runtime, and prompt assertions wait on a dedicated turn-sent signal with a
bounded diagnostic timeout.

| Check | Result |
| --- | --- |
| Focused project-context and helper reactor tests | Passed; 2 files, 25 tests |
| Full workspace `bun run test` | Passed; 231 files, 1,884 passed, 1 skipped |
| `bun run fmt:check` | Passed; 1,426 files |
| `bun run lint` | Exit 0; existing repository warnings only |
| `apps/server`: `bun run typecheck` | Passed |
| `git diff --check` | Passed |

The full workspace run completed in 10m8.49s on macOS. Ordinary hosted CI and release preflight now
retain a 30-minute finite timeout so serialized server Git/SQLite integration tests have sufficient
Linux-runner headroom.
