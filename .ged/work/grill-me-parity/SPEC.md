# Gedcode/GedPi grill-me parity

## Goal

Make `grill-me` real in Gedcode runtime: bundled grill-me content must be available to provider prompts/skills, and every non-trivial workflow must make an explicit clarification decision before planning: `needed` or `skipped-sufficient`.

## Scope

- Use `packages/ged-workflow/src/SkillRegistry.ts` as the source for grill-me content, informed by the original `mattpocock/skills` grill-me semantics: relentless one-at-a-time questioning, recommended answers, and codebase exploration instead of asking when the answer is discoverable.
- Inject grill-me instructions into `WorkflowPrompt`.
- Install/expose `.claude/skills/grill-me/SKILL.md` from bundled content during Ged bootstrap without overwriting user edits.
- Extend checkpoint clarification state and validation so non-trivial planning is invalid until a clarification decision exists.
- Add focused tests.

## Non-goals

- No generalized skill marketplace/manager.
- No UI changes.
- No provider-specific workflow rewrite.
- No semantic AI classifier beyond explicit prompt instructions and checkpoint validation.

## Acceptance Criteria

- `SkillRegistry` is used by runtime prompt/skill exposure paths.
- Grill-me content preserves the original skill intent: interview relentlessly, one question at a time, recommend an answer, and inspect code instead of asking discoverable questions.
- Workflow prompt contains real grill-me behavior, not only a one-line reference.
- Non-trivial planning validation fails without explicit clarification decision.
- Both clarification outcomes are documented in the prompt and accepted by validation.
- `.claude/skills/grill-me/SKILL.md` is created when missing and not overwritten when present.
- Focused Vitest coverage added.
- `bun fmt`, `bun lint`, `bun typecheck`, and focused `bun run test ...` pass.
