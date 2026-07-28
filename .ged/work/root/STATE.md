# STATE

- **Phase**: complete
- **Roadmap**: Forced Landing and Direct PM Publication
- **Branch**: `agent/force-land-direct-publish`
- **Base**: `main` at `854a14139`
- **Active task**: none — published
- **Published commit**: `640a37118`
- **Published branch**: `agent/force-land-direct-publish`
- **Draft PR**: https://github.com/edgyarmati/gedcode/pull/68
- **Clarified**: 2026-07-28

## Locked Decisions

- Forced landing bypasses only fresh Verify and requires a human reason.
- Gate identity/content, exact PR proposal, inspected clean worktree, matching HEAD, review/idle
  status, lifecycle lock, landing idempotency, and normal PR publication remain mandatory.
- Forced landing never means force push.
- Direct publication is a separate PM-owned, taskless, one-existing-commit workflow.
- Direct publication uses explicit branches/proposal, isolated worktree, normal push, and existing
  source-control providers; no generic Git or multi-commit support.
- This PR is independent of replay-hardening PR #67.
