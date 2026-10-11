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

## 2026-10-11 — Memory toolkit, and the land gate hardened

The two TypeScript components are built and tested.

- `apps/server/src/ged/ProjectMemory.ts` — a `t3/ged/ProjectMemory` service confined to
  `<root>/.ged`. Document keys are _validated_, not sanitized: anything with `..`, an absolute
  path, a backslash, a NUL, or an extension other than `.md`/`.json` is refused rather than
  quietly rewritten. 256KB per document.
- `apps/server/src/mcp/toolkits/memory/` — `ged_memory_list`, `ged_memory_read`, `ged_role_brief`,
  `ged_verdict_write`, `ged_land_check`. The memory root is `thread.worktreePath ?? workspaceRoot`,
  so a lead editing briefs on its branch reads its own version.
- `ged_land_check` **runs** `bin/land-gate.sh` rather than reimplementing its rules. The tool and
  the pre-push hook therefore cannot drift apart. A test pins the verdict-slug rule on both sides.

The gate itself was rewritten after review. The fail-open worth naming: a non-string `driverKind`
in the record passed the independence check. It now has to be a string, normalized, and one of the
eight real `ProviderDriverKind` values. Also fixed: option injection through the ref, refs that
resolve to non-commits, symlinked records, zero-width characters standing in for evidence, and a
dirty-tree check that masked every other failure because the record itself is untracked. Thirty-three
cases run in a scratch repo, all behaving as specified.

**Correction to the entry above:** the re-land is no longer zero-modified-upstream-files.
`apps/server/src/mcp/McpHttpServer.ts` gains ten lines, because the layer merge there is the only
assembly point for MCP toolkits. The exception is bounded and recorded in `DECISIONS.md`.

**Next:** exercise the MCP tools against a running server — they are unit-tested but have not been
called over the wire.
