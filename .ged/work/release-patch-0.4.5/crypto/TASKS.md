# Bounded slices

- [x] CR-01 — Read prior release/migration evidence and installed crypto/platform APIs; preserve
  pending-file hashes. Inspect only official named vendor documentation/source for API behavior.
  Verify exact installed API capabilities and native comparison semantics; no runtime edits.
- [x] CR-02 — Probe actual configured compiler for ordinary named HMAC/timing-safe imports in a
  bounded Node platform module, alongside supported Effect Crypto positive and hash negative
  controls. If blocked, retain probe evidence and report exact alternatives before any fallback.
- [ ] CR-03 — ONLY if CR-02 establishes a compliant architecture: centralize shared Node runtime,
  migrate callers preserving bytes/fingerprints, add fixed-vector and security/error-path regressions,
  run focused tests/fmt/lint/affected checks. Do not implement a partial migration if HMAC blocks.
- [x] CR-04 — Run requested independent release gates with exact logs; preserve failures, report
  blocker rather than claiming success. Verify preserved pending scope and empty index; record
  STATE, SESSION-SUMMARY and acceptance evidence for parent-owned independent review.

## Plan tightened after capability/security inspection

CR-03 is paused. No platform-only exemption is documented, and WebCrypto verification does not
preserve native constant-time comparison on the supported Node version. CR-02 must prove the
installed compiler behavior; if it rejects the necessary native adapter, request an upstream
Effect platform capability addition (new dependency authorization) or maintain the release hold.
A diagnostic exception/weakening is outside the approved contract and requires a changed decision.
Do not introduce wrappers/re-exports to hide node:crypto, custom JS comparisons or Bun-only paths.
CR-04 executes the explicit requested checks, but three failing full repeats cannot establish
whole-workspace compiler stability beyond the packages that are actually checked before failure.

CR-02 probe harness initially extended base tsconfig without the owning workspace's explicit Node
ambient types, causing TS2591 instead of the intended diagnostic. Preserve that failed run; change
only the fixture to extend the real shared workspace tsconfig (which inherits the unchanged base),
not severity/options. This is a probe setup error, not evidence of an application/compiler regression.

The Node-typed isolated native-only fixture compiles because no Effect package is loaded into that
small program; this does NOT model either actual Effect workspace. Add a separate Effect consumer
file to each probe, leaving the native module free of Effect imports, as a real platform adapter
would be. Retain the native-only control. Do not claim isolated no-Effect behavior is a supported
way to hide the platform adapter from the actual full workspace diagnostics.

CR-02 confirmed: in a real Effect-loaded TypeScript program, named SHA256/HMAC/timing-safe imports
and a separately bounded native platform module all fail TS377057. Supported Effect Crypto positive
control passes. CR-03 is BLOCKED, not implemented. Proceed only with CR-04 independent requested
checks and explicit upstream/hold alternatives; no runtime code, tests or diagnostic changes.

CR-04 execution/evidence complete, NOT release gates green. All three cold full typechecks fail the
known crypto diagnostic; independent server/SSH checks likewise fail. Other requested gates pass,
including a forced uncached desktop build. No native crash observed, but no full-workspace stability
claim. Parent decision and required independent security/aggregate reviewer remain outstanding.
