# State

- Phase: publish
- Roadmap: Work Inbox and Reachable Force Landing
- Branch: `agent/inbox-force-land-finalization`
- Base: `origin/main` at `2afb9db72`
- Active task: PUB-02
- Completed tasks: IN-01, IN-02, IN-03, IN-04, IN-05, FL-01, FL-02, FL-03, FL-04, PUB-01
- Blockers: none

## Locked decisions

- Normal chat threads alone receive Active/Snoozed/Settled Inbox lifecycle.
- Archive remains separate.
- Orchestrator Inbox entries derive from existing task status and open project workspace.
- Force land is a durable PM-finalization request from Review/Verify, not a direct actuator.
- Dirty worktrees are allowed at request time; final normal landing remains clean and exact.
- Human reason is optional.
- The obsolete direct-force protocol is removed with no compatibility fallback.
