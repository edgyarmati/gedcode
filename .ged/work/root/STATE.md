# State

- Phase: complete
- Work: Triage backlog of orchestrator UX/reliability fixes — clarified and filed as GitHub issues
- Active task: none
- Completed tasks: SC-01, SC-02
- Blockers: none

## Locked decisions

- Mid-turn checkpoint capture remains enabled.
- Only terminal provider lifecycle events authorize stage completion.
- No compatibility path preserves pre-terminal PM pickup.

## Clarified decisions (2026-08-21 triage)

- Tickets live on GitHub, one per ticket, pulled into .ged planning when picked up.
- PM wake reliability split into three tickets: wake liveness (watchdog + supervised
  subscriptions), durable stage-settlement redrive, long-uptime hygiene.
- Gate staleness: one ticket, full supersede lifecycle; decider-time validation lands first.
- Verifier early-stop: prompt-only fix; structured findings deferred as a maybe.
- Post-land follow-up display: UI-only via the existing stale landing flag; no new task status.
- PM-owned rebase ladder: identical-tree rebase re-pins verification without re-verify; conflicts
  confined to .ged/** and *.md are PM-resolved without re-verify; any other conflict returns the
  task to Work with fresh verification. See CONTEXT.md "PM-owned rebase".
- Reasoning level display: friendly labels via a static id-to-label map, no live capability
  threading.
- Turn-diff correctness ticket precedes the embedded diff local turn filter; hide-chips is the
  fallback if correctness stalls.
- Orchestrator-as-default-view + beautify filed as backlog issue only; no work scheduled.
