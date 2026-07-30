# TASKS — Work Inbox and Reachable Force Landing

Status values: `NEXT`, `TODO`, `DONE`, `BLOCKED`.

| ID | Status | Vertical slice | Verification |
| --- | --- | --- | --- |
| IN-01 | DONE | Add normal-task Inbox lifecycle contracts and one settle/reopen tracer through decider/projector. | Public command/event round-trip; new user turn reopens settled thread. |
| IN-02 | DONE | Persist lifecycle fields and expose them through thread shell snapshots/replay. | Migration, repository/projector restart, snapshot tests. |
| IN-03 | DONE | Add snooze, explicit reopen, and deadline wake behavior. | Clock-controlled transition and idempotency tests. |
| IN-04 | DONE | Add pure flat Inbox selectors for Normal tasks and Orchestrator entries. | Classification, selected-row retention, status filtering, route tests. |
| IN-05 | DONE | Build Inbox/Orchestrator pill and Normal/Orchestrator category UI without grouping. | Focused component/browser navigation tests. |
| FL-01 | DONE | Replace direct force landing with durable force-land request contracts/decider/projection. | Review/Verify acceptance; dirty/no-gate acceptance; optional reason; rejection cases. |
| FL-02 | DONE | Deliver force-land request to PM live and replay, using safe finalization guidance. | Exactly-once runtime tests and blocked-ambiguity guidance. |
| FL-03 | DONE | Add Review/Verify Force land now UI and remove gate-card direct force action. | Browser confirmation, optional reason, duplicate/pending state tests. |
| FL-04 | DONE | Prove finalization reaches unchanged normal landing safeguards. | Focused integration test through scoped commit, proposal, approval, landing. |
| PUB-01 | DONE | Update changelog/upstream decision docs and run final verification. | Format, lint, contracts/server/web typechecks, focused tests, diff check. |
| PUB-02 | TODO | Commit, push, and open the final detailed draft PR. | Independent branch targets current main; CI is monitored by Terra. |
