# Context Map

What lives where in `.ged/`.

## Durable, committed

| Path                                                                       | Holds                                                          |
| -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `PROJECT.md`                                                               | What this is, the base it sits on, the toolchain               |
| `STANDARDS.md`                                                             | Working standards; defers to upstream on toolchain and process |
| `ORCHESTRATION.md`                                                         | How plan/implement/verify is expressed on the V2 orchestrator  |
| `DECISIONS.md`                                                             | ADRs about the Ged layer itself, not ordinary domain decisions |
| `roles/`                                                                   | Role briefs pasted verbatim into delegated child prompts       |
| `verdicts/`                                                                | Verdict records, branch-keyed with SHA provenance              |
| `bin/`                                                                     | The land gate                                                  |
| `plans/`                                                                   | Plans: SPEC.md, TASKS.md, CRITERIA.md per slug                 |
| `specs/`, `tasks/`, `research/`, `project-skills/`                         | Supporting artifacts                                           |
| `ARCHITECTURE.md`, `PATTERNS.md`, `GLOSSARY.md`, `IDEAS.md`, `PROGRESS.md` | Accumulated context                                            |

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

`apps/server/src/mcp/McpHttpServer.ts` is the one upstream file we modify — ten lines to register
that toolkit. Keeping the exception to a single file and a single hunk is what keeps upstream
merges cheap.

## Removed

`work/` held per-branch stage-machine state (`STATE.md` and its phases). The durable stage machine
was dropped; see `ORCHESTRATION.md` and the ADRs in `DECISIONS.md`. Plans now live in `plans/`, and
sequencing is a lead's delegation choice rather than enforced state.
