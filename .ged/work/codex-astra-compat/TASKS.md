# Tasks

| ID | Status | Slice | Verification |
| --- | --- | --- | --- |
| CA-01 | DONE | Reproduce and fix closed PlanType enum drift with a generator compatibility transform and all generated occurrences; map known new auth labels. Add account/rate-limit regressions. | Original sanitized account fixture fails before fix; protocol tests and provider status tests pass after; unknown enum still rejected; generated definitions match transform. |
| CA-02 | DONE | Add verified Astra alias, preserve explicit catalog/custom selection and thread/turn propagation with regressions. No default/catalog injection. | Focused shared model, CodexProvider, CodexSessionRuntime tests pass including official ID and explicit custom selection. |
| CA-03 | DONE | Update CHANGELOG and verify bounded diff; run fmt/lint, affected package typechecks and focused tests; record outcome. | Re-run sanitized payload decoding and isolated real provider probe; required checks documented; no staged files, config/auth changes, app restart, or implementation commit. |

Out-of-scope findings: installed app's historical quota-stage resume conflicts; no automatic repair.

CA-03 tightened verification: shared typecheck has an intermittent unchanged-file `effect/Logger`
resolution failure. Retry that package in isolation once and record both outcomes; do not repair
unrelated observability tests/dependencies or broaden to workspace checks.
