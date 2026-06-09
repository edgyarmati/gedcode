# Spec: Expose Claude Fable 5

## Goal

Expose the existing Claude Code model id `claude-fable-5` in GedCode's model picker so users can select it without adding a custom model manually.

## User-visible behavior

- Claude provider model lists include `claude-fable-5` with display name `Claude Fable 5`.
- Model normalization accepts convenient Fable aliases and resolves them to `claude-fable-5`.
- Existing Claude model selection, option descriptor, and custom model behavior remains unchanged.

## Non-goals

- Do not change the default Claude model.
- Do not implement or validate Claude-side model support; the user confirmed Claude Code already has it.
- Do not add new Claude Code version gates unless existing code or SDK behavior requires one.
- Do not change Codex, Cursor, or OpenCode model behavior.

## Acceptance Criteria

- `claude-fable-5` appears in the Claude built-in model list.
- `normalizeModelSlug("fable", claudeAgent)` returns `claude-fable-5`.
- Required repo checks pass: `bun fmt`, `bun lint`, `bun typecheck`.
