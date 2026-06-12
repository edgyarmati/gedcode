# SPEC

## Goal

Complete the upstream `de58ec8e` Claude Fable 5 model update in this fork.

## Requirements

- Gate the built-in `claude-fable-5` model behind Claude Code `2.1.169` or newer.
- Give Claude Fable 5 the same reasoning and context-window picker capabilities upstream expects.
- Preserve `xhigh` effort for Claude Fable 5 when invoking Claude, while keeping older model compatibility mappings unchanged.
- Show an upgrade message for Claude Code versions that are too old for Fable 5.
- Add focused provider registry and adapter tests.
- Add an unreleased `CHANGELOG.md` entry.
- Mark `de58ec8e` as completed in `docs/upstream-decisions.md` and remove it from the Want To Implement provider/model representative list.

## Non-Goals

- Do not backport Grok provider support or Cursor dynamic model probing in this slice.
- Do not restructure the Claude effort option constants unless required for the Fable behavior.
- Do not change package manager, test runner, or broader provider startup behavior.

## Acceptance Criteria

- Claude Fable 5 is visible only on supported Claude Code versions.
- Fable 5 exposes reasoning options including `xhigh`, `max`, `ultracode`, and `ultrathink`, plus 200k/1M context windows.
- Fable 5 `xhigh` reaches the Claude SDK as `xhigh`.
- Focused tests and required repository gates pass.
