# Tests

## Focused test cases

Schema / validation:

- Non-trivial state with no `clarification` fails clarification gate.
- `decision: "needed"` with `questionCount: 0` fails.
- `decision: "needed"` with `questionCount > 0` passes.
- `decision: "skipped-sufficient"` with `questionCount: 0` passes.
- `validatePlannerCheckpoint` fails when `ged-planner` exists but clarification is missing.
- Trivial tasks bypass clarification gate.

Prompt:

- `WorkflowPrompt` contains actual grill-me rules from `SkillRegistry`.
- Prompt includes both decisions: `needed` and `skipped-sufficient`.
- Prompt says non-trivial planning must not begin until clarification is recorded.
- Prompt includes checkpoint JSON shape for `clarification`.

Bootstrap / skills:

- Bootstrap writes `.claude/skills/grill-me/SKILL.md` when missing.
- Bootstrap skill file contains frontmatter and grill-me content.
- Bootstrap does not overwrite an existing grill-me skill file.

## Focused commands

```sh
bun run test packages/ged-workflow/src/CheckpointValidation.test.ts
bun run test packages/ged-workflow/src/WorkflowPrompt.test.ts
bun run test packages/ged-workflow/src/GedBootstrap.test.ts
```

## Required repo gates

```sh
bun fmt
bun lint
bun typecheck
```
