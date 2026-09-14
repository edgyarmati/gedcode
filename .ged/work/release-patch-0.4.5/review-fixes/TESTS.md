# Verification plan

Use PATH=/Users/edgy/.local/share/mise/installs/node/24.13.1/bin:$PATH (Node24.13.1/Bun1.3.11).

1. Before fix: focused Vitest via actual Oxlint harness with only four blocker reproductions;
   expect all four fail (incorrectly accepted source); save unabridged output.
2. After fix: bun run --filter=@t3tools/oxlint-plugin-t3code test rules/native-crypto-boundary.test.ts.
   Expect all old/new negative/positive fixtures pass; assertions name guard-specific diagnostics.
3. bun run --filter=@t3tools/scripts test compiler-toolchain.test.ts — 14 real compiler policy,
   formatted import placement, installed binary/runner identity and frozen config tests pass.
4. bun run --filter=@t3tools/oxlint-plugin-t3code typecheck and
   bun run --filter=@t3tools/scripts typecheck — native configured compiler passes unchanged flags.
5. bun fmt; bun run fmt:check; bun lint; git diff --check — pass, only existing lint warnings.
6. Compare final tracked/untracked source hashes to entry snapshot, permit only named scoped
   edits, preserve policy/config/dependency/product bytes and HEAD, require empty git index.

Do not rerun full Vitest/browser/build/install/audit/stress for rule/test/doc-only changes.
Prior complete full-gate recovery logs remain valid only for their recorded earlier hashes;
remote exact-commit/platform CI and independent targeted reviewer are parent-owned gates.
