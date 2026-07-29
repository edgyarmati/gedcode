# TASKS — Codex PM Lifecycle Accountability

Status values: `NEXT`, `TODO`, `DONE`, `BLOCKED`.

| ID | Status | Bounded slice | Verification |
| --- | --- | --- | --- |
| PM-01 | DONE | Add focused queue tests for lifecycle action instructions, waiting markers, one corrective retry, and user/Claude exclusions. | Focused `PmReEntryQueue` tests pin all retry boundaries. |
| PM-02 | DONE | Expose per-turn trusted orchestration-tool evidence from the driver PM adapter. | Adapter tests prove reset and trusted-server filtering. |
| PM-03 | DONE | Wire Codex-only lifecycle accountability into the PM runtime and strengthen its prompt contract. | Focused runtime tests prove Codex policy selection and no Claude behavior change. |
| PM-04 | DONE | Update changelog and run repository-required verification. | Format, lint, server typecheck, focused tests, and diff check pass. |
| PM-05 | NEXT | Commit, push, and open a detailed draft PR. | Draft PR targets the default branch with validation evidence. |
