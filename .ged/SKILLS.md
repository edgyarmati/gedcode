# Skills

Claude Code skills in `.agents/skills/` (`.claude/skills` is a symlink to it). Two are ours;
`contribution-triage`, `test-t3-app`, and `test-t3-mobile` are upstream's.

## Ours

| Skill           | Does                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------- |
| `verify`        | The narrow mechanical check — format, lint, scoped typecheck, scoped tests. Never repo-wide. |
| `sync-upstream` | Pull upstream `main` into this tree and reconcile the additive layer.                        |

## Why there are not more

The Ged process is served by GedCode, not written into skills. `ged_playbook` gives every provider,
in every project, the lead playbook, grilling, the verify checks, and the planner, implementer and
verifier briefs; a skill only exists inside Claude Code and only in this checkout. The `ged-lead`
and `grilling` skills, and the briefs in `.ged/roles/`, were copies of what is now served, so they
are gone. `verify` stays because it names this repo's commands.

Earlier, three overlapping interview skills collapsed to `grilling`, and the vendored
`domain-modeling` skill was dropped: it drove a root `CONTEXT.md` and a `docs/adr/` tree that do
not exist here, and instructed against the `CONTEXT-MAP.md` this project actually uses.

A new skill has to earn its place against a brief that would work everywhere.
