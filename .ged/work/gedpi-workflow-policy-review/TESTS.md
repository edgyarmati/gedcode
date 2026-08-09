# Tests: GedPi workflow policy review

## Evidence checks

- Compare README/architecture policy, injected brain instructions, role prompts, checkpoint schemas,
  tool-call guards, preferences, and tests.
- Verify each hard gate has a clear safety property, bypass/recovery behavior, and state invalidation
  rule.
- Verify each durable artifact has an owner, consumer, update point, and lifecycle.
- Run scenario analysis for trivial, non-trivial clear, ambiguous, read-only, failed, interrupted, and
  role-disabled work.
- Adjudicate an independent read-only review rather than copying it uncritically.

## Repository checks

- `bun fmt` — passed.
- `bun lint` — passed with 68 pre-existing warnings and 0 errors.
- `bun typecheck` — blocked by unrelated pre-existing `effect-codex-app-server` failures, including
  unresolved `effect/Context` / `effect/Exit` imports and cascading context/type errors. No product
  code changed in this review; the failure was documented without expanding scope.
- `git diff --check` — passed for the review diff.
- Final changed paths contain review artifacts only.

No product tests were run because no product behavior or source code changed.

## Acceptance

- The resulting target workflow is simpler where ceremony has no concrete value and stricter where
  correctness, recoverability, or user control require it.
- Remaining implementation questions are explicit inputs to the later `improve` session.
