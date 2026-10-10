# Project

GedCode is a desktop and web workspace for running Codex, Claude, and OpenCode agents. Its
distinguishing feature is not the workspace — that comes from upstream — but the **Ged workflow**:
a structured development discipline where work is planned, implemented, and independently verified,
with durable project memory under `.ged/` and structural guards that enforce the discipline from
outside the model's control.

Status: **early WIP, mid-rebase.** Sweeping changes that improve long-term maintainability are
welcome.

## Base

This tree is a fresh checkout of T3 Code `main` @ `9afde1c6d` (#17848), not a continuation of the
v1 GedCode history. v1 forked at `e3accd6e95` and diverged by 741 / 3775 commits; upstream had
since deleted every file v1 integrated through (`wsServer.ts`, `providerManager.ts`,
`codexAppServerManager.ts`, `contracts/src/orchestration.ts`, `web/src/store.ts`). There was no
clean-merge surface, so the base was retaken and the Ged layer is being re-landed additively.

The v1 repository remains at `~/projects/gedcode` as a read-only reference.

Upstream's V2 orchestrator replaces v1's durable `plan → work → verify` state machine. It is
better, and we keep it. How the Ged discipline is expressed on top of it — delegation topology,
verifier independence, per-role model policy, the land gate — is specified in
[ORCHESTRATION.md](./ORCHESTRATION.md).

## What is ours

Everything Ged-specific is additive. Nothing upstream is modified. See the additive-only
constraint in [STANDARDS.md](./STANDARDS.md#additive-only-constraint).

- `.ged/` — project memory: these documents, plus specs, plans, tasks, and research.
- `.agents/skills/` — the Ged skills (`ged-planning`, `ged-execution`, `ged-verification`,
  `grilling`, `grill-me`, `grill-with-docs`, `verify`, `domain-modeling`, `sync-upstream`),
  alongside upstream's own. `.claude/skills` is a symlink to this directory.
- Planned, not yet built: a `ProjectMemory` service, a `memory` MCP toolkit exposing it to every
  provider, role briefs, the task-lead playbook, verdict records, and the land gate.

v1's `ProjectContextRunChanges.ts` (913 LOC) is deliberately **not** being ported. It is being
rebuilt as an MCP toolkit following upstream's `apps/server/src/mcp/toolkits/` pattern. Known
trade-off: that drops v1's supervised-write review gate unless it is deliberately rebuilt.

## Toolchain

pnpm + Vite+ (`vp`), not Bun. Tests run through `vp test run`, not Vitest directly. Full details,
commands, and the scope-discipline rule live in [STANDARDS.md](./STANDARDS.md).

Cargo/Rust is **not** required for normal development — resource telemetry degrades gracefully. It
is needed only for desktop artifact builds and `test:resource-monitor`.

### Bootstrap

```sh
node --version                                   # must be >= 24.13.1
curl -fsSL https://vite.plus | bash              # install the global vp binary
vp i
vp run --filter @t3tools/desktop ensure:electron
cp .env.example .env                             # optional
vp run dev
```

**Open the pairing URL the dev runner prints.** A bare `http://localhost:5733` will not
authenticate. Server is 13773, web 5733, offset per worktree. Dev state lives in a per-worktree
`.t3/`.

## Operating notes

- Provider auth, configuration, and running applications are operator-owned.
- Model availability is account-specific and discovered at runtime. Verify model IDs against the
  authenticated catalog or official vendor documentation — never from naming guesses.
- Release process is upstream's; v1's `release.sh` and its gate policy do not apply here.
