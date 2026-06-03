# Tests

Required before completion:

```sh
bun fmt
bun lint
bun typecheck
```

Use Vitest only via `bun run test` if running focused tests.

Focused targets where practical:

- `packages/contracts/src/settings.test.ts` for Codex structured default/control metadata and patch acceptance.
- Shared helper tests for role defaults, partial normalization, and stable prompt order.
- Server workflow tests for default preset, explicit instance override, global fallback when instance lacks preset, and non-Codex omission.
- UI/component test or typecheck coverage for model/reasoning changes writing expected structured values.
