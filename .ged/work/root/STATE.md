# STATE

- **Phase**: implement
- **Active task**: `WORKER-FULL-01` — remove worker network controls end to end
- **Roadmap**: Full-access Codex workers and dismissible helper results
- **Clarified**: 2026-07-23

## Locked Decisions

- Codex Plan, Work, and Verify workers use true full access: approval policy `never`,
  `danger-full-access`, unrestricted network, and inherited host environment including credentials.
- Remove global/per-handoff worker-network controls with no compatibility facade or dual mode.
- Keep task worktrees, ownership checks, worker admission/concurrency, and protected-ref push blocking.
- Claude and OpenCode remain unchanged. PM policy remains unchanged. Exploration helpers remain
  provider-enforced read-only.
- Keep capability pauses only for unexpected external/provider approvals; remove ordinary
  sandbox/network/credential choreography and messaging.
- A Codex-only destructive out-of-worktree tripwire is optional and best effort. Implement it only if
  the server-owned hook can be narrowly trusted without trusting unrelated hooks or prompting.
- The PM surface pins only the newest PM helper. A newer helper replaces it without stacking.
- Active helper cards cannot be dismissed. Terminal cards have an X and persist dismissal locally by
  environment/project/helper across reload and reconnect.
- Dismissed or replaced PM helpers remain in project Helper history. Task helpers remain in Task
  history.
- No full suite during ordinary implementation. Required completion gates are focused tests,
  `bun fmt`, `bun lint`, narrow package typechecks, and `CHANGELOG.md`.
- Implementation uses Terra subagents with high reasoning. Parallel work must be independently scoped;
  shared contracts, prompts, state, tests, and changelog edits are sequenced or reconciled explicitly.

## Compatibility Decision

The product is unreleased. Removed worker fields may remain harmless unknown data in historical
settings/events, but they receive no runtime fallback, UI, or migration behavior. Do not add an
alternate degraded path if the optional hook is infeasible.

## Prior State

The completed Durable PM Lifecycle and Landing Automation roadmap remains available in Git history.
This active plan intentionally replaces its completed root planning artifacts.
