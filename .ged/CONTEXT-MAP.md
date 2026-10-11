# Context Map

What lives where in `.ged/`.

## Durable, committed

| Path               | Holds                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `PROJECT.md`       | What this is, the base it sits on, the toolchain                    |
| `STANDARDS.md`     | Working standards; defers to upstream on toolchain and process      |
| `ORCHESTRATION.md` | How plan/implement/verify is expressed on the V2 orchestrator       |
| `DECISIONS.md`     | ADRs about the Ged layer itself, not ordinary domain decisions      |
| `roles/`           | Role briefs pasted verbatim into delegated child prompts            |
| `verdicts/`        | Verdict records, branch-keyed with SHA provenance                   |
| `bin/`             | The land gate                                                       |
| `plans/`           | Plans: SPEC.md, TASKS.md, CRITERIA.md per slug, indexed in INDEX.md |
| `PROGRESS.md`      | Dated log of what changed and why                                   |
| `CONTEXT-MAP.md`   | This file                                                           |

## Ephemeral, gitignored

`runtime/` and `reports/` — session state. Nothing durable belongs here.

`verdicts/*.json` — verdict records, via a nested `verdicts/.gitignore` so the upstream root
`.gitignore` stays untouched. The records are local evidence for a local pre-push gate; see the ADR
in `DECISIONS.md` for why they are not committed.

## Code outside `.ged/`

The Ged layer is mostly plain files, but two pieces are TypeScript in `apps/server`:

| Path                                   | Holds                                                           |
| -------------------------------------- | --------------------------------------------------------------- |
| `apps/server/src/ged/ProjectMemory.ts` | Path-confined reader/writer for the `.ged/` tree; runs the gate |
| `apps/server/src/mcp/toolkits/memory/` | The MCP toolkit that serves it to every provider                |

Eight upstream files are modified: ten lines in `apps/server/src/mcp/McpHttpServer.ts` to register
that toolkit, `.github/pull_request_template.md`, the three that drop the out-of-scope Expo app
from the workspace (`pnpm-workspace.yaml`, `knip.jsonc`, and the generated `pnpm-lock.yaml`), and
the three that carry the fork's identity (`README.md`, `CONTRIBUTING.md`, `LICENSE`).
`STANDARDS.md` carries the full list with line counts, and keeping it short is what keeps upstream
merges cheap.

## User-facing documentation

`docs/` is upstream's and stays unedited — it documents the same harness. GedCode's own user
documentation is additive at `docs/ged/`, starting with `workflow.md`, and is linked from the root
`README.md` rather than from upstream's `docs/README.md` index. Root `THIRD_PARTY_NOTICES.md` covers
attribution that the generated in-app license manifests cannot reach, because it is not an npm
package.

## Not here

There is no `ARCHITECTURE.md`, `PATTERNS.md` or `GLOSSARY.md`. Architecture and conventions are
upstream's and documented upstream; a second empty copy under `.ged/` only invites drift. Add one
when there is something to say that upstream does not say.

## Removed

`work/` held per-branch stage-machine state (`STATE.md` and its phases). The durable stage machine
was dropped; see `ORCHESTRATION.md` and the ADRs in `DECISIONS.md`. Plans now live in `plans/`, and
sequencing is a lead's delegation choice rather than enforced state.

`specs/`, `tasks/`, `research/` and `project-skills/` were README-only directories carried from v0.4
holding nothing. Recreate one when something actually needs storing.

`MANIFEST.json`, `SKILLS-STATE.json` and `IMPORT-STATE.json` were state files for v0.4 tooling that
no longer exists; nothing read them. The one fact `IMPORT-STATE.json` carried — that upstream's
`AGENTS.md` and `CLAUDE.md` are deliberately deferred to in place rather than copied — is an ADR in
`DECISIONS.md`.
