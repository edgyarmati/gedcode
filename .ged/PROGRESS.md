# Progress

Ongoing log of project progress.

## 2026-10-11 — Ged layer re-landed on the V2 orchestrator base

Rebuilt `.ged/` and the Ged skills on a fresh T3 Code checkout (`9afde1c6d`, #17848) after v1's
fork point proved unmergeable. **Zero upstream files modified**, which is the constraint the
re-land exists to satisfy.

Built and working (plain files, no build step):

- `roles/` — planner, implementer, verifier briefs plus model policy
- `ged-lead` skill — delegation playbook, including the depth and fan-out caps the orchestrator
  does not impose itself
- `verdicts/` — branch-keyed records with SHA provenance
- `bin/land-gate.sh` — tested against all six failure modes plus the passing case

Rewrote the carried v1 memory and realigned six skills that still drove the dropped
`.ged/work/root/STATE.md` phase machine.

Toolchain bootstrapped: Node 24.13.1 via nvm, Vite+ `vp` 1.1.0 installed globally. Note the repo
pins `vite-plus@1.0.0` locally while the global CLI is 1.1.0.

**Next:** the memory MCP toolkit (`apps/server/src/mcp/toolkits/`) and the `ProjectMemory` service.
Both are TypeScript and were blocked on the install until now. v1's `ProjectContextRunChanges.ts`
is deliberately not being ported — it is being rebuilt as a toolkit, which drops its supervised-write
review gate unless that is deliberately rebuilt too.
