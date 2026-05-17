---
name: ged-verification
description: Post-implementation verification and checkpoint state update. Use before committing non-trivial work.
---

Verify the implementation meets the spec and update checkpoint state.

## Steps

1. Run all project checks:
   - `bun fmt` (format)
   - `bun lint` (lint)
   - `bun typecheck` (type check)
   - `bun run test` (tests — NEVER use `bun test`)
2. Review changes against SPEC.md acceptance criteria.
3. Record evidence in .ged/work/root/TESTS.md (which tests pass, what was manually verified).
4. Update STATE.md to reflect verification status.

## On Failure

If any check fails, fix the issues and re-run verification. Do not commit until all checks pass and acceptance criteria are met.
