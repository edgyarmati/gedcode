# Tests

Planned verification:

- `bun run test -- src/hostedPairing.test.ts src/components/settings/pairingUrls.test.ts` from `apps/web`
- Any focused Vercel config tests added for configurable router behavior
- `bun fmt`
- `bun lint`
- `bun typecheck`

Evidence:

- PASS: `bun run test -- src/hostedPairing.test.ts src/components/settings/pairingUrls.test.ts vercel.test.ts` from `apps/web` (14 tests).
- PASS: `bun fmt`.
- PASS: `bun lint` (existing warnings only; exit code 0).
- PASS: `bun typecheck` after retry. Initial root run hit a transient `effect-acp` package-resolution failure; `packages/effect-acp` typechecked directly and the second root run passed all 14 packages.
- PASS: Final rerun after verifier hardening: focused web tests (14), `bun fmt`, `bun lint`, and `bun typecheck`.
