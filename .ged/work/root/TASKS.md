# Tasks

## 1. Settings Contract

- [x] Add a Codex Ged subagent preset field to `CodexSettings`.
- [x] Add patch decoding for the new Codex field.
- [x] Cover default, decode, and patch behavior in settings tests.

## 2. Prompt Injection

- [x] Extend `WorkflowPromptOptions` to accept provider and Codex preset context.
- [x] Render a Codex-only preset section when subagents are enabled and a preset is configured.
- [x] Pass the active provider session into prompt generation from the Ged workflow guard/interceptor.
- [x] Add tests for Codex-only prompt behavior and non-Codex omission.

## 3. Documentation

- [x] Update `docs/ged-workflow.md` with a brief Codex preset note if the behavior is user-facing.

## 4. Verification

- [x] Run focused tests for settings and workflow prompt behavior.
- [x] Run `bun fmt`.
- [x] Run `bun lint`.
- [x] Run `bun typecheck`.
- [x] Run Ged verifier review before committing.
- [x] Commit scoped changes with a conventional commit.
