# Crypto compatibility under unchanged Effect diagnostics

## Approved contract

The user explicitly approved a focused, independently security-reviewed compatibility repair
following TypeScript7.0.2 + Effect TSGo0.43.0. Preserve all pending release, dependency-security,
stage-receipt and tooling changes since eaa41bc72. No product ambiguity remains. Do not launch
workers; parent owns independent security and aggregate review and eventual publication.

Preserve exact credential bytes/encodings, SHA-256/HMAC-SHA256 algorithms, cryptographic entropy,
native timing-safe comparison, persistent fingerprints/canonicalization and SSH truncated hash
semantics. No credential rotation or edits to operator auth/config files. Shared runtime belongs
in a genuinely Node-only module, never schema contracts. No disguised imports/re-exports,
diagnostic suppression/weakening, compiler downgrade, unchecked platform files, custom crypto
or degraded behavior. If the installed supported APIs cannot meet all invariants, report exact
alternatives and stop before fallback implementation.

## Success / checked acceptance

A conforming fix requires known-answer old/new regression and security/error-path tests; focused
Vitest, formatting, lint and affected checks; all release gates on Node24.13.1/Bun1.3.11 including
three cold full-workspace typechecks, full `bun run test` (never native Bun tests), versions,
smoke, audit, Chromium browser tests and desktop build. Document real operator-visible fixes
in pending 0.4.5 notes and update the date when an implemented fix is ready for review.

No staging, commit, push, tag, dispatch, publication or installed-app restart. Record exact
commands/results, full changed-file scope, preserved baseline hashes and empty index. Passing
independent gates do not substitute for a failing typecheck or required reviewer acceptance.

## Investigation boundary

Installed Effect beta.73 Crypto/NodeCrypto supplies secure random bytes, UUIDs and SHA digests,
not HMAC or timing-safe equality. The module-reference diagnostic has no documented platform
implementation exemption. Ordinary named imports must be tested with the actual patched compiler.
WebCrypto HMAC verification is a candidate only if native timing-safe semantics hold on BOTH
supported runtimes: Node24.13.1 source uses ordinary memcmp, unlike its CRYPTO_memcmp-backed
timingSafeEqual. Bun1.3.11 uses constantTimeMemcmp but cannot stand in for Node support.
Do not adopt this candidate. This is a compatibility blocker, not an authorization to rewrite auth.
