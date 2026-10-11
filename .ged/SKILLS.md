# Skills

Claude Code skills in `.agents/skills/` (`.claude/skills` is a symlink to it). Four are ours;
`contribution-triage`, `test-t3-app`, and `test-t3-mobile` are upstream's.

## Ours

| Skill           | Does                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ged-lead`      | The task lead's delegation playbook: when to delegate, how to compose a child prompt, the verification rules, and the depth/fan-out caps the orchestrator does not impose itself. |
| `verify`        | The narrow mechanical check — format, lint, scoped typecheck, scoped tests. Never repo-wide.                                                                                      |
| `grilling`      | The one-question-at-a-time interview, for stress-testing a plan before any of it is delegated.                                                                                    |
| `sync-upstream` | Pull upstream `main` into this tree and reconcile the additive layer.                                                                                                             |

## Why there are not more

Role behaviour belongs in `.ged/roles/`, not in skills. A brief is served to any provider through
`ged_role_brief`; a skill only exists inside Claude Code. The planner, implementer, and verifier
each had a skill that restated its brief, which meant two copies of the same rules free to drift.
The briefs won.

Likewise, three overlapping interview skills collapsed to `grilling`, and the vendored
`domain-modeling` skill was dropped: it drove a root `CONTEXT.md` and a `docs/adr/` tree that do
not exist here, and instructed against the `CONTEXT-MAP.md` this project actually uses.

A new skill has to earn its place against a brief that would work everywhere.
