# Tests

## Required

- `bun fmt` passed.
- `bun lint` passed with existing warnings only.
- `bun typecheck` failed in unrelated release-script work:
  - `scripts/resolve-release-version.ts` constructs `new Date()` where the repo lint/typecheck rule requires Effect `DateTime`.
  - `scripts/resolve-release-version.ts` passes optional `date`/`runNumber` fields as explicit `undefined`, which violates `exactOptionalPropertyTypes`.

## Focused

- `bun run test -- src/components/ChatView.logic.test.ts` from `apps/web` passed: 1 file, 31 tests.
- `bun run typecheck` from `apps/web` passed.

## Evidence

- Badge fix is verified at focused web scope.
- Full repository completion is blocked by unrelated script typecheck errors outside this badge patch.
