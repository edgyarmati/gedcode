# Tasks

## 1. Clarification schema and validation

- [ ] Add `ClarificationDecision` to `CheckpointSchema.ts`.
- [ ] Extend `ClarificationRecord` with `decision` and optional `reason`.
- [ ] Add `validateClarificationGate` in `CheckpointValidation.ts`.
- [ ] Make `validatePlannerCheckpoint` fail for non-trivial tasks until clarification gate passes.

## 2. Grill-me content source of truth

- [ ] Update `SkillRegistry.ts` grill-me content with concrete rules aligned to the original `mattpocock/skills` grill-me skill:
  - interview relentlessly until shared understanding
  - walk the decision tree branch by branch
  - one question per turn
  - recommended answers
  - inspect code instead of asking when answer is discoverable
  - semantic sufficiency dimensions
  - `needed` vs `skipped-sufficient`
  - checkpoint recording expectation
- [ ] Add small helpers to fetch/render the bundled grill-me skill.
- [ ] Avoid duplicating grill-me prose in `WorkflowPrompt`.

## 3. Runtime prompt exposure

- [ ] Import/render grill-me content in `WorkflowPrompt.ts`.
- [ ] Update workflow checkpoint instructions to include clarification examples.
- [ ] Explicitly forbid non-trivial planning before clarification decision is recorded.

## 4. Claude skill exposure

- [ ] Add bootstrap support for missing `.claude/skills/grill-me/SKILL.md`.
- [ ] Render the skill file from `SkillRegistry`.
- [ ] Do not overwrite existing user skill files.
- [ ] Keep this limited to grill-me.

## 5. Tests and verification

- [ ] Add/update schema and validation tests.
- [ ] Add/update workflow prompt tests.
- [ ] Add/update bootstrap skill-install tests.
- [ ] Run focused `bun run test` commands.
- [ ] Run `bun fmt`, `bun lint`, `bun typecheck`.
