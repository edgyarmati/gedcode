# Tests

## Required

- `bun fmt` passed.
- `bun lint` passed with existing warnings only.
- `bun typecheck` failed in unrelated release-script work:
  - `scripts/promote-stable-update-manifests.test.ts` imports Node `fs`/`path`.
  - `scripts/promote-stable-update-manifests.ts` imports Node `fs`/`path` and uses `console.log`.

## Focused

- `bun run test -- src/components/ChatView.logic.test.ts` from `apps/web` passed: 1 file, 30 tests.
- `bun run typecheck` from `apps/web` passed.

## Evidence

- Badge fix is verified at focused web scope.
- Full repository completion is blocked by unrelated script typecheck errors outside this badge patch.
