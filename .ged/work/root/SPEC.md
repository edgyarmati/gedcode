# SPEC

## Goal

Backport upstream commit `300f7fd1` (`[codex] Avoid shell for system executables (#2950)`) so trusted system executables are spawned directly instead of routed through the Windows shell.

## Requirements

- Remove `shell: process.platform === "win32"` from the targeted system executable spawns in diagnostics, environment labeling, repository identity resolution, and terminal process inspection.
- Keep command arguments and existing behavior unchanged.
- Use platform-specific executable names for direct SSH and Tailscale spawns where upstream does so:
  - `ssh.exe` on Windows, `ssh` elsewhere.
  - `tailscale.exe` on Windows, `tailscale` elsewhere.
- Update focused tests that assert shell options or command names.
- Document the user/operator-visible reliability fix in `CHANGELOG.md`.
- Mark `300f7fd1` as completed in `docs/upstream-decisions.md` and remove it from the remaining reliability representative commit list.

## Non-Goals

- Do not backport adjacent shell hardening commits `6ce6f678` or `a74dfd4f` in this task.
- Do not refactor process execution abstractions globally.
- Do not change user-requested terminal shell behavior or PTY startup semantics.
- Do not touch provider protocol sync, UI polish, build tooling migration, or release pipeline changes.

## Acceptance Criteria

- Direct system executable spawns no longer opt into the Windows shell in the targeted files.
- SSH and Tailscale command selection remains platform-correct.
- Focused tests and required repository gates pass.
