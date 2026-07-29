# SPEC — Codex PM Lifecycle Accountability

## Goal

Make Codex PM lifecycle re-entry reliably advance the orchestration workflow instead of silently
acknowledging a worker settlement and stopping.

## Contract

- Lifecycle-only Codex PM turns receive an explicit instruction to take the next orchestration
  action or report a concrete wait using a stable marker.
- A Codex lifecycle turn is dispositioned when it:
  - invokes at least one tool on the trusted orchestration MCP server; or
  - returns `[PM_WAITING: <reason>]` with a non-empty reason.
- If the first lifecycle turn does neither, the server sends exactly one bounded corrective prompt.
- The corrective turn is never recursively retried.
- User-message turns are not subject to automatic corrective prompting.
- Claude PM behavior remains unchanged.
- Provider runtime events remain the source of truth for orchestration-tool use.

## Constraints

- Preserve the durable settlement consumption and reconciliation ordering.
- Do not poll worker state.
- Do not infer success merely from a natural-language acknowledgement.
- Do not add a degraded or compatibility fallback.
- Run focused tests only, plus formatting, lint, narrow typecheck, and diff checks.
- Document the user-visible reliability change in `CHANGELOG.md`.

## Acceptance Criteria

1. Lifecycle prompts clearly require an immediate action or the stable waiting marker.
2. A Codex lifecycle turn with an orchestration tool call is not reprompted.
3. A Codex lifecycle turn with a valid waiting marker is not reprompted.
4. A Codex lifecycle turn with neither receives one corrective prompt.
5. A non-compliant corrective turn does not cause an infinite loop.
6. User turns and Claude lifecycle turns retain their current single-turn behavior.
7. Orchestration-tool evidence resets per PM turn and ignores unrelated provider tools.
