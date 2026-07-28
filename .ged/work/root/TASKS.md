# TASKS — Forced Landing and Direct PM Publication

Status values: `NEXT`, `TODO`, `DONE`, `BLOCKED`.

| ID | Status | Bounded slice | Verification |
| --- | --- | --- | --- |
| FL-01 | DONE | Add public contract/decider RED for force-land bypassing only stale/missing Verify with reason. | Normal approval remains rejected; dedicated force command succeeds only on preserved invariants. |
| FL-02 | DONE | Implement durable force-land command/event audit and atomic landing transition. | Contracts, decider, projection, replay, and idempotency tests pass. |
| FL-02A | DONE | Permit a pending land-gate request before Verify while retaining proposal and clean matching-HEAD evidence. | Request creates only a pending gate; normal approval still requires Verify and force remains distinct. |
| FL-03 | DONE | Expose force-land RPC/service and explicit UI confirmation/reason action. | WebSocket and browser tests prove dedicated human action and normal Approve remains primary. |
| DP-01 | DONE | Add public PM tool RED for one-commit direct publication without `task.create`. | Tool schema and execution test fail before implementation and pin explicit inputs. |
| DP-02 | DONE | Implement bounded direct-publication service with isolated worktree, validation, push, PR create/update, cleanup, and idempotency. | Focused VCS/provider/service tests cover success and typed failure cleanup. |
| DP-03 | DONE | Wire PM tool, activity projection, and PM guidance for taskless trivial commit routing. | PM tests prove direct publish emits audit activity and never creates a task. |
| PUB-01 | DONE | Update glossary/changelog/docs and run final verification. | Focused tests, format, lint, contracts/server/web typechecks, and diff check pass. |
| PUB-02 | DONE | Commit, push, and open a detailed independent draft PR. | Branch and PR target `main` and do not depend on PR #67. |
