# TASKS — Replacement Landing for Existing Pull Requests

Status values: `NEXT`, `TODO`, `DONE`, `BLOCKED`.

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| RELAND-01 | DONE | Extend durable landing state/events with backward-compatible approved/published hash metadata and invalidate completed landing when later Work/Verify begins. | Focused contracts and projector tests prove legacy decode plus stale transition. |
| RELAND-02 | DONE | Make landing service and decider idempotency hash-aware so a matching replacement gate is actionable while same-hash repeats no-op. | Focused decider and `taskLanding` tests cover replacement and idempotency. |
| RELAND-03 | DONE | Add safe force-with-lease branch publication and source-control PR proposal updates. | Focused Git driver/workflow and GitHub provider tests pin command/API behavior. |
| RELAND-04 | DONE | Teach the landing reactor to update an existing PR and record the replacement published hash. | Focused reactor and landing integration tests prove same-PR replacement publication. |
| RELAND-05 | DONE | Align web projection/presentation with stale replacement landing and add regression coverage. | Focused store/route logic/browser tests show the new gate is actionable. |
| RELAND-06 | DONE | Document the fix and run final focused quality gates. | Changelog, formatting, lint, relevant package typechecks, and focused tests pass; evidence is recorded in `TESTS.md`. |
| PM-PREFIX-01 | DONE | Add the inheritable PM prompt-prefix contract and runtime resolution with focused tests. | Legacy decode defaults safely; project override/global fallback and exact prompt append are covered. |
| PM-PREFIX-02 | DONE | Add global and per-project PM prompt-prefix settings UI with focused logic/component coverage. | Draft/patch inheritance semantics and rendered controls are covered. |
| PM-PREFIX-03 | DONE | Document and verify the completed feature. | Changelog and required quality gates pass with evidence in `TESTS.md`. |
| THREAD-CONTINUE-01 | DONE | Refine PM prompt, tool descriptions, and feature playbook to prefer one bounded same-thread correction while retaining explicit fresh-attempt cases. | Focused PM prompt and tool metadata tests pin the decision rule. |
| THREAD-CONTINUE-02 | DONE | Align architectural decisions and unreleased notes with the refined continuation policy. | Documentation clearly distinguishes a turn from an attempt and preserves independent verification. |
| THREAD-CONTINUE-03 | DONE | Run final focused verification and record evidence. | Formatting, lint, relevant server typecheck, focused tests, and diff review pass. |
