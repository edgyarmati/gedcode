# Tests: Simplify Orchestrator settings

- `bun fmt`
- `bun lint`
- `bun typecheck`

Focused checks if needed:

- settings logic tests for Orchestrator defaults
- project orchestration settings logic tests

Manual acceptance:

- Global Orchestrator settings no longer show Stages or Gate autonomy.
- Project Orchestration settings no longer show Stages or Gate autonomy.
- Landing PR and Operational knobs remain available.
- Saving simplified settings does not erase existing hidden stage/gate config.
