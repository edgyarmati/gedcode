# TESTS — Forced Landing and Direct PM Publication

## Method

- Vertical TDD only: add one observable failing behavior, implement minimally, rerun, then continue.
- Prefer public command/RPC/PM-tool/service interfaces over private helpers.
- Test agents are Terra-low; production implementation agents are Sol-low.
- Use `bun run test`, never `bun test`.

## Forced Landing

- Normal land approval rejects absent or stale Verify.
- Dedicated force-land requires a non-empty reason.
- Force-land accepts absent/stale Verify only when the current land gate, content hash, proposal,
  inspected HEAD, clean worktree, task status, and lifecycle lock are valid.
- Each preserved invariant has focused rejection coverage.
- Forced resolution and landing start append atomically and replay with override reason/origin.
- Concurrent/repeated force requests start one landing attempt.
- Web UI requires explicit confirmation and reason, then sends the dedicated RPC.

## Direct Publication

- PM tool requires an explicit project ID, source commit, destination/base branches, exact PR proposal, and optional
  existing PR URL.
- Successful publication resolves one commit, creates an isolated worktree, applies it, pushes
  without force, creates/updates the PR, records activity, cleans up, and dispatches no task command.
- Identical retry is idempotent.
- Invalid commit, dirty checkout, protected ref, PR mismatch, conflict, push/provider failure all
  return typed failures and clean up.
- Prompt/tool descriptions direct trivial commit-routing work here and retain tasks for real work.

## Required Gates

- Focused contracts, decider/projector, landing, PM tool/service, source-control, and UI tests.
- `bun fmt`
- `bun lint`
- Narrow contracts/server/web typechecks.
- `git diff --check`

## Evidence

### FL-01 RED — dedicated force-land command (2026-07-28)

Command run from the dedicated force-land worktree:

```text
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts --testNamePattern='force-lands one current reviewed gate with a human verification override reason'
```

Result: failed as intended (1 failed, 80 skipped). The public decider tracer builds a Review/idle
task with a current pending, content-matched land gate containing an exact PR proposal and a clean
inspected matching HEAD, but no successful Verify after Work. It first proves normal
`task.land.approve` remains rejected, then requires the distinct `task.land.force` command with a
non-empty human reason to atomically emit `task.gate-resolved` and `task.landed`, with the latter
carrying `verificationOverride: { kind: "force-land", reason }`.

The current decider rejects the dedicated command before any fixture or invariant ambiguity:

```text
Orchestration command invariant failed (task.land.force): Unknown command type: task.land.force
```

This was the intended missing-contract RED. FL-01 is complete; production code, status, and
protocol implementation had not changed at that point.

### FL-02 GREEN — force-land atomic transition and preserved dirty-worktree guard (2026-07-28)

Commands run from the dedicated force-land worktree:

```text
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts --testNamePattern='force-lands one current reviewed gate with a human verification override reason'
bun run test --filter=@t3tools/contracts -- src/orchestration.test.ts
bun run typecheck --filter=@t3tools/contracts
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts --testNamePattern='rejects force-land when the inspected task worktree is dirty'
```

Results:

- The original force-land tracer passed (1 passed, 80 skipped). It preserves normal missing-Verify
  rejection and requires the dedicated command to atomically resolve the gate and start landing
  with the reason-bearing override audit payload.
- Contracts orchestration tests passed (70), contracts typecheck passed, and the complete task
  decider suite passed (81).
- The next preserved-invariant tracer also passed (1 passed, 81 skipped): a dirty inspected
  worktree remains ineligible for force-land.

`bun run typecheck --filter=gedcode` could not complete because the temporary worktree dependency
links do not include `packages/tailscale/node_modules`; it fails before server typechecking on
unresolved `effect` and `@effect/vitest` imports in that unrelated package. The contracts and server
focused test evidence above is clean. Further durable audit/projection and idempotency coverage was
recorded in the next verification slice.

### FL-02 GREEN — override audit survives contract roundtrip and replay (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/projector.test.ts --testNamePattern='round-trips and replays a force-land verification override into the task landing snapshot'
```

Result: passed (1 passed, 24 skipped). A public `task.landed` event containing the force-land
verification override is decoded, encoded, decoded again, then replayed through the projector. The
resulting task snapshot retains the exact override kind, human origin, and reason at
`task.landing.verificationOverride`. FL-02 is complete; FL-03 is next.

### FL-02A RED — request a pending land gate before Verify (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts --testNamePattern='requests a pending land gate before Verify while keeping normal approval separate'
```

Result: failed as intended (1 failed, 82 skipped). The public tracer starts with a Review/idle task
that has completed Work but no Verify, an exact PR proposal, and clean inspected HEAD equal to the
requested content hash. It proves ordinary `task.land.approve` remains rejected, then requires
`task.gate.request` for `land` to emit only a pending gate. The current request path incorrectly
applies `requireFreshVerification` and rejects before the gate is created:

```text
Task 'task-1' cannot be approved or landed without verification recorded against its worktree HEAD.
```

This is the intended FL-02A RED. The request must be decoupled from approval/landing while retaining
the clean matching-HEAD and exact-proposal checks; normal approval and dedicated force-land stay
separate.

### FL-02A GREEN — pending gate creation is independent of Verify (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts --testNamePattern='requests a pending land gate before Verify while keeping normal approval separate'
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts --testNamePattern='force-lands one current reviewed gate with a human verification override reason|normal approval'
bun run test --filter=gedcode -- src/orchestration/decider.task.test.ts
bun run typecheck --filter=@t3tools/contracts
```

Results: the new tracer passed (1 passed, 82 skipped); the force/normal-approval regression pair
passed (2 passed, 81 skipped); the focused decider suite passed (83 passed); and contracts typecheck
passed. The legacy `never auto-approves a land gate` fixture now uses `verified-head` as its request
content hash, which matches the deliberately retained invariant that the clean inspected HEAD must
equal the requested content. `bun run typecheck --filter=gedcode` remains blocked before server
typechecking by the force-land worktree's unrelated `@t3tools/tailscale` dependency links: its
`node_modules` lacks `effect` and `@effect/vitest`, yielding unresolved-import errors. FL-02A is
complete; FL-03 is next.

### FL-03 RED — dedicated force-land WebSocket action (2026-07-28)

```text
bun run test --filter=gedcode -- src/server.test.ts --testNamePattern='force-lands a current reviewed gate through the dedicated orchestrator websocket action'
```

Result: failed as intended (1 failed, 78 skipped) with `TypeError: forceLandTask is not a
function`. The public server seam fixes the requested RPC name as `orchestrator.forceLandTask` and
requires `taskId`, `gateId`, `approvedHash`, and a non-empty human reason. Its fixture deliberately
has no Verify record, but owns a real clean Git worktree whose inspected HEAD equals the pending
land gate and supplied hash. When implemented, the server must locate that task, serialize through
the normal lifecycle coordinator, inspect the worktree, dispatch exactly one `task.land.force` with
the server-observed completion and reason, and return `{ sequence, alreadyLanded }`. The missing
RPC group/schema method is the intended first RED; FL-03 remains next.

### FL-03 GREEN — force-land RPC delegates through the guarded landing service (2026-07-28)

```text
bun run test --filter=gedcode -- src/server.test.ts --testNamePattern='force-lands a current reviewed gate through the dedicated orchestrator websocket action'
bun run test --filter=gedcode -- src/orchestration/taskLanding.test.ts
bun run test --filter=@t3tools/contracts -- src/orchestration.test.ts
bun run typecheck --filter=@t3tools/contracts
```

Results: the public server tracer passed (1 passed, 78 skipped), all six focused task-landing
service tests passed, all 70 contracts orchestration tests passed, and contracts typecheck passed.
The new RPC locates the task, serializes its lifecycle, observes the clean matching HEAD on the
owned worktree, and dispatches the reason-bearing `task.land.force` command. `bun run typecheck
--filter=gedcode` is still blocked before server typechecking by the temporary worktree's unrelated
`@t3tools/tailscale` dependency links, which lack `effect` and `@effect/vitest`. The next FL-03
slice is the browser confirmation UX.

### FL-03 RED — explicit force-land confirmation and reason (2026-07-28)

```text
cd apps/web && gtimeout 25s bun run test:browser src/components/orchestrator/OrchestratorRoutes.browser.tsx --testNamePattern='requires an explicit reason before force landing a pending land gate' --reporter=verbose --testTimeout=8000
```

Result: failed as intended (1 failed, 23 skipped). The pending land gate still renders the primary
normal `Approve` action, but the required separate `Force land` action does not exist:

```text
locator.click: Timeout 7844ms exceeded
waiting for ... getByRole('button', { name: 'Force land' })
```

The browser tracer then specifies the rest of the protected flow: an explicitly named confirmation
dialog, a labelled reason field, a disabled confirmation until the reason is non-empty, and a single
`api.orchestrator.forceLandTask({ taskId, gateId, approvedHash, reason })` call. It also proves that
the normal approval API is untouched by force landing. This is the intended UI RED; no production
code was changed and FL-03 remains next.

### FL-03 GREEN — explicit force-land confirmation is bounded and auditable (2026-07-28)

```text
cd apps/web && gtimeout 30s bun run test:browser src/components/orchestrator/OrchestratorRoutes.browser.tsx --testNamePattern='uses land-gate approval as the only normal landing action|requires an explicit reason before force landing a pending land gate|does not offer force land for non-land or resolved gates' --reporter=verbose --testTimeout=12000
bun run test --filter=gedcode -- src/server.test.ts --testNamePattern='force-lands a current reviewed gate through the dedicated orchestrator websocket action'
bun run test --filter=gedcode -- src/orchestration/taskLanding.test.ts
bun run test --filter=@t3tools/contracts -- src/orchestration.test.ts
bun run typecheck --filter=@t3tools/contracts
git diff --check
```

Results: all three focused browser tests passed (3 passed, 22 skipped); the browser flow retains
normal approval, requires a visible confirmation dialog and non-empty reason before submitting the
exact force-land RPC payload, and suppresses Force land for non-land and resolved gates. The final
submit activation uses direct DOM `click()` only in this isolated CSS-less component harness because
Base UI's inert presentation wrapper otherwise covers the rendered dialog; the browser test still
performs real visibility, enabled-state, and input assertions beforehand. The public server RPC test
passed (1 passed, 78 skipped), task-landing tests passed (6), contracts tests passed (70), contracts
typecheck passed, and `git diff --check` passed. Server and web typechecks are blocked before their
targets by unrelated temporary-worktree dependency links: `@t3tools/tailscale` and `@t3tools/shared`
respectively lack the required Effect packages. FL-03 is complete; DP-01 is next.

### DP-01 RED — PM direct publication is taskless and explicit (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/pm/pmTools.test.ts --testNamePattern='publishes one direct commit without creating an orchestration task'
```

Result: failed as intended (1 failed, 57 skipped): `findTool` cannot find
`publishDirectCommit`. The public PM-tool tracer supplies the narrow direct-publication port and
requires only the source commit, destination branch, base branch, exact PR title/body, and optional
existing PR URL; the project ID comes from PM project context and is asserted at the port boundary.
It pins the successful PR URL/details response and proves that no orchestration command—especially
`task.create`—is dispatched. The missing tool/port is the intended DP-01 RED; DP-01 remains next.

### DP-01 GREEN — PM direct publication stays taskless (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/pm/pmTools.test.ts --testNamePattern='publishes one direct commit without creating an orchestration task'
bun run test --filter=gedcode -- src/orchestration/pm/pmTools.test.ts
git diff --check
```

Results: the public tracer passed (1 passed, 57 skipped) and the narrow PM-tool suite passed (58).
The test now injects the production direct-publication port and verifies the exact project-context
input, PR result, and absence of every orchestration dispatch. `bun run typecheck --filter=gedcode`
is blocked before server typechecking by the same temporary-worktree `@t3tools/tailscale` dependency
links lacking Effect packages. DP-01 is complete; DP-02 is next.

### DP-02 RED — isolated one-commit publication service (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/directPublication/DirectPublicationService.test.ts --testNamePattern='publishes one existing commit from an isolated worktree without changing the primary checkout'
```

Result: failed as intended before execution because the public
`./DirectPublicationService.ts` module is absent (0 tests). The single success tracer creates a
real temporary primary repository plus bare `origin`, commits one source change, and injects a fake
source-control provider. It specifies an isolated-worktree publication API that preserves the clean
primary checkout, pushes the explicit destination branch normally, creates the exact proposed PR,
returns its URL, and removes the temporary repository state. DP-02 remains next.

### DP-02 RED — idempotent direct-publication retry (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/directPublication/DirectPublicationService.test.ts --testNamePattern='retries an identical direct publication'
```

Result: failed as intended (1 failed, 2 skipped). The first real-repository publication succeeds;
the identical retry with its existing PR URL attempts to create the destination branch again and
fails with `fatal: a branch named 'ged/direct/retry' already exists`. The tracer requires unchanged
remote head, no repeat cherry-pick/push, and one exact existing-PR update rather than a second PR.
DP-02 remains next.

### DP-02 GREEN — validation boundaries have no publication side effects (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/directPublication/DirectPublicationService.test.ts --testNamePattern='rejects direct-publication validation boundaries before provider calls or repository mutation'
bun run test --filter=gedcode -- src/orchestration/directPublication/DirectPublicationService.test.ts
git diff --check
```

Results: the new table-driven public service tracer passed (1 passed, 4 skipped), then the full
DirectPublicationService suite passed (5 passed). Its reusable real-repository fixture covers a
dirty primary checkout (`checkout-dirty`), invalid source (`source-commit-invalid`), protected
`main` destination (`destination-protected`), and a pre-existing destination lacking exact `-x`
provenance (`destination-mismatch`). Every case asserts neither PR provider method is called and no
temporary worktree is retained; the first three also prove no remote ref changes beyond the fixture,
while the mismatch case verifies only its deliberately pre-created fixture branch exists. `git diff
--check` passed. Server typechecking remains blocked before its target by this temporary worktree's
unrelated `@t3tools/tailscale` dependency links, which lack `effect` and `@effect/vitest`; that
environment issue is unchanged and is not expanded in this slice. DP-02 is complete; DP-03 is next.

### DP-03 RED — direct publication requires an explicit PM project target (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/pm/pmTools.test.ts --testNamePattern='publishes a direct commit for its explicit project without global project inference'
```

Result: failed as intended (1 failed, 58 skipped). The public PM-tool tracer supplies two enabled
projects and explicitly selects the first project while publishing one commit. It requires the port
to receive that exact project ID, no task command to dispatch, and no global project inference.
The current tool ignores the explicit input and calls `resolvePmProjectId`, which rejects because
the shared read model has two enabled projects:

```text
Direct publication requires one PM project context; found 2.
```

The contract is now explicit: the global trusted PM MCP transport accepts a required `projectId`,
then server-side resolution validates that selected project before resolving its workspace and
source-control provider. This preserves the existing shared MCP transport and intentionally avoids
a per-project endpoint redesign. DP-03 remains next.

### DP-03 GREEN — explicit PM project tool target (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/pm/pmTools.test.ts --testNamePattern='publishes a direct commit for its explicit project without global project inference'
bun run test --filter=gedcode -- src/orchestration/pm/pmTools.test.ts
```

Results: the explicit-project tracer passed (1 passed, 58 skipped), and the complete PM-tool suite
passed (59). The existing direct-publication tracer now supplies the required project ID too. With
two enabled projects, the tool forwards only the selected ID to its port and dispatches no task
command.

### DP-03 RED — live direct-publication adapter binds project services (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/directPublication/DirectPublicationLive.test.ts --testNamePattern='binds direct publication to the explicitly selected project workspace and source-control provider'
```

Result: failed as intended before execution because `./DirectPublicationLive.ts` does not exist
(0 tests). The next public adapter tracer supplies two projects, explicit VCS and source-control
registry services, and an injected publication function. It requires the selected project only to
resolve its workspace and source-control provider, then passes the exact workspace, project ID,
publication parameters, provider, and VCS process to the underlying service. The production factory
should default that injection to the existing direct-publication service. DP-03 remains next.

### DP-03 GREEN — live adapter resolves only the selected project (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/directPublication/DirectPublicationLive.test.ts --testNamePattern='binds direct publication to the explicitly selected project workspace and source-control provider'
bun run typecheck --filter=gedcode
```

Results: the live adapter tracer passed (1 passed). It binds project one—not the second enabled
project—to `/projects/one`, resolves the source-control provider only at that workspace, and passes
the injected provider, VCS process, exact project ID, and request parameters to the publication
function. The server typecheck remains blocked before the server target by the known unrelated
temporary-worktree `@t3tools/tailscale` dependency links missing Effect packages (`effect` and
`@effect/vitest`). DP-03 remains next.

### DP-03 RED — PM runtime MCP construction receives direct publication (2026-07-28)

```text
bun run test --filter=gedcode -- src/orchestration/Layers/PmRuntime.directPublication.test.ts --testNamePattern='constructs PM MCP executors with the live direct-publication port'
```

Result: failed as intended (1 failed). The bounded runtime-construction tracer specifies a public
`makePmRuntimeMcpToolExecutors({ directPublication })` seam in `PmRuntime`: it must construct the
normal PM MCP executor list with the supplied `DirectPublicationPort`, expose `publishDirectCommit`,
and route an explicit project request to that adapter without a service-unavailable error. The
existing runtime owns a globally registered MCP server directly and exports no such construction
seam, so the imported symbol is undefined at runtime. The implementation should introduce this
small public builder around the existing `makeOrchestrationMcpExecutors` composition and have
`makePmRuntime` use it; it should not redesign the global trusted MCP transport. The live adapter
test remains green. DP-03 remains next.

### DP-03 GREEN — PM runtime uses the configured publication port (2026-07-28)

```text
bun run test -- src/orchestration/Layers/PmRuntime.test.ts src/orchestration/Layers/PmRuntime.directPublication.test.ts
bun run test -- src/orchestration/directPublication/DirectPublicationService.test.ts src/orchestration/directPublication/DirectPublicationLive.test.ts
bun run test:browser -- src/components/orchestrator/OrchestratorRoutes.browser.tsx
bun run typecheck # packages/contracts
git diff --check
```

Implementation checkpoint results: the PM runtime suites passed (54 tests), direct-publication
service/live suites passed (6 tests), the focused Orchestrator browser suite passed (25 tests), the
contracts typecheck passed, and `git diff --check` passed. Runtime construction now receives one
configured `DirectPublicationPort` rather than eagerly constructing VCS/provider infrastructure,
and both PM backends use the normal MCP executor list with that port. The PM guidance reserves
taskless publication for exactly one already-reviewed commit and directs implementation,
uncertainty, and multi-commit work through a task and Verify.

These are implementation-agent checkpoint results, not the final independent verification record.
PUB-01 remains in progress while Terra runs format, lint, narrow cross-package typechecks, and final
focused verification. The temporary worktree's server/web dependency links currently resolve
`@t3tools/contracts` to the original checkout, so missing force-land API symbols from those two
cross-package typechecks must be rechecked in a correctly linked worktree rather than recorded as
product failures.

### PUB-01 FINAL — independent Terra verification (2026-07-28)

Terra completed the final verification checkpoint with the worktree dependencies resolving against
this branch:

- Server typecheck: passed.
- Workspace typecheck: passed, 12/12 workspace targets.
- Focused forced-landing, direct-publication, PM runtime/projection, RPC, and browser verification:
  passed, 120/120 tests.
- Landing integration verification: passed, 13/13 tests.
- Final full `bun run test`: passed. The retained output is
  `/tmp/gedcode-force-land-full-test-final.log`.
- Lint: passed with pre-existing warnings only and no new errors.
- `bun fmt --check`: passed.
- `git diff --check`: passed.

A transient `tsgo` runtime crash occurred during verification; clean reruns completed successfully,
including the final server and 12-target workspace typechecks above. It did not reproduce as a
product type error. PUB-01 is complete and PUB-02 is ready for commit, push, and the independent
draft pull request.
