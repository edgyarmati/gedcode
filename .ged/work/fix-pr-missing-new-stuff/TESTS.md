# TESTS

Required checks before completion:

- `bun fmt`
- `bun lint`
- `bun typecheck`
- `bun run test`

Additional checks:

- `git diff --check main...HEAD`
- Focused tests discovered for theme registry, role prompts, role invocation, role settings, and Ged subagent mode.

Never run `bun test`; use `bun run test`.
