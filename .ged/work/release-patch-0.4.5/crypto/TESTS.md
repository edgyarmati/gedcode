# Verification

1. Configured compiler probes inherit the actual unmodified base tsconfig and use fresh processes.
   Positive: Effect Crypto/NodeCrypto secure primitives. Negative: named createHash, named HMAC/
   timingSafeEqual, and a real bounded platform adapter importing those native primitives.
   Expected evidence: exact exit/diagnostic codes. No configuration exceptions or alternate imports.
2. Focused existing auth tests: credential issuance/verification, corruption/tamper/expiry/revocation,
   secret-store reuse/concurrent creation/permissions/I/O errors, pairing digest. Existing command
   fingerprint and SSH tests protect durable hash semantics. New old/new vectors require an actual
   conforming implementation; do not label baseline behavior as migrated compatibility proof.
3. Node24.13.1/Bun1.3.11: frozen install; bun fmt; fmt check; bun lint; shared/SSH/server typechecks;
   three cold full configured typechecks (remove only generated .tsbuildinfo; cache disabled by
   existing turbo policy); bun run test; release versions/smoke/audit; Chromium install/browser;
   desktop build. Preserve every failure and note incomplete downstream compiler tasks.
4. Compare all pre-task pending-file hashes except appended durable context; runtime files remain
   ignored. No runtime/product/credential/config edits, no misleading changelog fix on a blocked
   investigation. Capture final diff/file manifest and git diff --cached --exit-code.

## Results (2026-09-14)

- Real Effect-loaded probe: supported API control passes; native SHA256/HMAC/timing-safe imports
  and bounded native adapter each fail exactly TS377057. Source/config/exit/output in runtime
  crypto/compiler-probes.json. Initial harness failed for missing Node types, then native-only
  control loaded no Effect and so did not exercise the rule. Both attempts preserved with correction.
- No runtime implementation or test-source edit. Known-answer old/new regression tests are NOT
  added/passed because no compliant new implementation exists. Do not mistake baseline suites
  or compiler probes for migration compatibility proof.
- Focused existing auth/fingerprint: 8 files / 40 tests; SSH command: 1 / 11; tooling: 1 / 5, all pass.
- Frozen install, fmt + fmt check, lint (76 existing warnings), shared typecheck pass. Independent
  SSH/server typechecks fail only the known crypto imports (1 SSH / 15 server error sites).
- Three cold configured full typechecks each fail at SSH: 6, 5, 7 successful tasks before stopping.
  No observed native crash in these attempts; NOT completed full-workspace stability evidence.
- Full `bun run test`: 459 files, 4130 passed / 1 existing skip, 11 tasks. Versions agree on 0.4.4,
  smoke/audit pass. Chromium install and browser suite pass: 23 files / 240 tests.
- Desktop build initially replays three cached tasks; explicit `bun run build:desktop --force`
  passes all three uncached tasks. No Electron launch/installed-app restart.
- Exact gate commands/times/exits/logs: .ged/runtime/release-patch-0.4.5/crypto/commands.jsonl.
