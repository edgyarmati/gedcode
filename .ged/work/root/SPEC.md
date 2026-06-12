# SPEC

## Goal

Backport upstream commit `6ce6f678` (`[codex] Avoid shell for Windows environment probe (#2951)`) so desktop Windows PowerShell environment probes spawn directly instead of routing through a shell.

## Requirements

- Remove `shell: true` from the Windows profile environment probe in `apps/desktop/src/shell/DesktopShellEnvironment.ts`.
- Keep PowerShell command selection, arguments, PATH merge behavior, POSIX shell probing, and launchctl fallback behavior unchanged.
- Tighten the focused desktop shell test to verify Windows probes no longer request shell execution.
- Add an unreleased `CHANGELOG.md` entry.
- Mark `6ce6f678` as completed in `docs/upstream-decisions.md` and remove it from the remaining reliability representative commit list.

## Non-Goals

- Do not backport `a74dfd4f` Node executable spawn hardening in this task.
- Do not change terminal shell startup, POSIX login shell behavior, launchctl environment hydration, or package manager/test workflow.
- Do not pull in broader provider/protocol sync from `ae7e88b0`.

## Acceptance Criteria

- The Windows environment probe no longer passes `shell: true`.
- Focused desktop shell tests and required repository gates pass.
