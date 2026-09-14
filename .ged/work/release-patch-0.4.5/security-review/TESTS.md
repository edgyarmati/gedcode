# Verification plan

Use Node24.13.1 PATH with Bun1.3.11; Vitest via bun run, never bun test.
- `bun run --filter=@t3tools/oxlint-plugin-t3code test rules/native-crypto-boundary.test.ts`:
  actual Oxlint diagnostics for every reviewed bypass/variant and passing allowlist/shadow controls.
  Capture initial expected red baseline, then all-green final suite.
- `bun fmt`, `bun run fmt:check`, `git diff --check`: no unrelated formatting changes.
- `bun lint`: unchanged error-level rule/policy; no errors (existing warnings recorded).
- `bun run --filter=@t3tools/oxlint-plugin-t3code typecheck` and
  `bun run --filter=@t3tools/scripts typecheck`: actual patched tsc, no altered options.
- `bun run --filter=@t3tools/scripts test compiler-toolchain.test.ts`: 14 existing real compiler
  probes, diagnostic/config freeze, executable identity and every workspace runner remain green.
- Baseline hash validator: only scoped source/tests/docs changed; no baseline path removed;
  inventory/config/dependencies/auth runtime untouched; historical recovery evidence byte-identical.
- `git diff --cached --exit-code` and unchanged HEAD: no staged files/commit/publication.

Full workspace/release/browser/build/install checks were valid for the prior source snapshot.
They are deliberately not rerun here and must not be represented as current changed-state gates.
