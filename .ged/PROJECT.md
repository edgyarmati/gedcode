# Project

GedCode is a desktop and web workspace for running Codex, Claude, and OpenCode agents. Its
distinguishing feature is not the workspace — that comes from upstream — but the **Ged workflow**:
a structured development discipline where work is planned, implemented, and independently verified,
with durable project memory under `.ged/` and structural guards that enforce the discipline from
outside the model's control.

Status: **active fork; upstream feature integration targets GedCode 0.6.0.**

## Base

This tree integrates T3 Code `main` @ `30084f0018c5751a07291222e8d04e16d513700a` (2026-11-02).
The additive Ged layer was first rebuilt on `9afde1c6d` after v0.4's integration seams were removed
upstream. That history explains the legacy-data importer; it is not a reason to restore the old
orchestrator. See [DECISIONS.md](./DECISIONS.md).

The v0.4 repository remains at `~/projects/gedcode-v0.4` as a read-only reference.

### Naming

GedCode is one product on one version line. The fork that ran from `e3accd6e95` to `c3a9813f39` is
the **0.4.x** tree; this one continues on the **0.5.x and 0.6.x** line. The engine underneath changed completely, but
the thing users install did not, and there are real 0.4.8 installs on a live Sparkle feed that have
to see subsequent Ged versions as newer. A generation number that reset to 1.0 would have stranded them.

`v0.5` and `v0.6` name this tree; `v0.4` names the old one. Upstream's own uppercase `V1` / `V2` — the V2
orchestrator, the V1 sqlite projections — are a separate scheme, unversioned by us and not ours to
renumber.

Package manifests stay on upstream's version train (currently `0.1.6`). The release version is a build input
(`--build-version` / `T3CODE_DESKTOP_VERSION`), so shipping 0.5.x costs no upstream file edit.

Upstream's V2 orchestrator replaces v0.4's durable `plan → work → verify` state machine. It is
better, and we keep it. How the Ged discipline is expressed on top of it — delegation topology,
verifier independence, per-role model policy, the land gate — is specified in
[ORCHESTRATION.md](./ORCHESTRATION.md).

## What is ours

Ged functionality is additive wherever possible. Required upstream assembly, identity, packaging,
and permission seams are recorded in [STANDARDS.md](./STANDARDS.md#additive-only-constraint).
Keep those changes minimal; a sync must preserve both current upstream behavior and Ged's data,
update trust anchor, memory and independent-review policy.

- `.ged/` — project memory: these documents, model notes, plans, and verdict records.
- `apps/server/src/ged/ProjectMemory.ts` — the path-confined reader/writer for that tree.
- `apps/server/src/mcp/toolkits/memory/` — the MCP toolkit that serves it to every provider, so
  the discipline reaches Codex and OpenCode and not only Claude Code.
- `.ged/bin/land-gate.sh` — the structural guard.
- `apps/server/src/ged/playbooks/` — the lead playbook, grilling, verify, and the role briefs,
  served to every provider by `ged_playbook`; `apps/server/src/ged/starter/` is what Ged setup adds
  to a project.
- `.agents/skills/` — two Claude Code skills (`verify`, `sync-upstream`) alongside upstream's own.
  `.claude/skills` is a symlink to this directory.

v0.4's `ProjectContextRunChanges.ts` (913 LOC) is deliberately **not** being ported. It is being
rebuilt as an MCP toolkit following upstream's `apps/server/src/mcp/toolkits/` pattern. Known
trade-off: that drops v0.4's supervised-write review gate unless it is deliberately rebuilt.

## Toolchain

pnpm + Vite+ (`vp`), not Bun. Tests run through `vp test run`, not Vitest directly. Full details,
commands, and the scope-discipline rule live in [STANDARDS.md](./STANDARDS.md).

Cargo/Rust is **not** required for normal development — resource telemetry degrades gracefully. It
is needed only for desktop artifact builds and `test:resource-monitor`.

### Bootstrap

```sh
node --version                                   # must be 26.12.1
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
- Ged's release path is `.github/workflows/ged-release.yml`; upstream npm and hosted-infrastructure
  workflows must stay disabled in this fork. Do not push or publish without explicit authorization.
- macOS auto-update uses Sparkle with a stable EdDSA trust anchor and signed feeds. Preserve its
  verification policy and execute upstream compile-cache preparation before the after-pack signing
  hook. See [Sparkle updates](../docs/ged/sparkle-updates.md).
