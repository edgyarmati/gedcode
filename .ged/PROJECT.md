# Project

GedCode is an early-WIP desktop/web workspace for Codex, Claude, and OpenCode, with a durable
Orchestrator workflow. Server provider drivers bridge native runtimes to shared domain events;
Codex uses JSON-RPC over `codex app-server` stdio through `packages/effect-codex-app-server`.
`packages/contracts` is schema-only; shared runtime helpers belong in `packages/shared`.

Priorities: performance, reliability, predictable failures, maintainable shared logic. Follow
`AGENTS.md`: bounded focused Vitest checks (`bun run test`, never `bun test`), `bun fmt`, `bun lint`,
and affected-package typechecks. Document unrelated failures without expanding scope; update
CHANGELOG Unreleased for user/operator-visible changes. Do not introduce degraded/fallback behavior
without approval. Provider auth/config and running applications are operator-owned.

Codex model availability is account-specific and discovered through `model/list`; exact explicit model
IDs must survive normalization. Verify new IDs with the authenticated catalog or official OpenAI
documentation, not naming guesses. Compatibility changes to generated protocol schemas must also
survive regeneration, rather than only patching generated output.

Stable release preparation uses `docs/release.md`, `release.sh`, the version resolver, and the release
workflow as the policy sources. Inspect only `origin` (`edgyarmati/gedcode`); latest stable GitHub
release and synchronized package versions determine the next patch. Finalize the changelog before
publication, but leave package versions and Bun workspace metadata at the last published stable
version: build alignment and stable finalization update them automatically. Release gates include
the separate Chromium browser suite in addition to formatting, lint, typecheck, full Vitest tests,
version consistency, release smoke, and production audit. A failed gate or non-green current-main CI
blocks release; never weaken the gate to publish. Preparation does not authorize staging, committing,
pushing, tagging, dispatching, publishing, or restarting an installed app when publication is reserved
to the parent/operator.

Release blocker remediation must trace transitive dependency reachability before updating packages;
never add audit exemptions without operator approval. Server orchestration command IDs are durable
idempotency keys: retries must preserve semantic fingerprints; timeout/diff paths must share consistent
completion payload semantics while genuinely different commands remain rejected.

The compiler now uses pinned TypeScript7.0.2 plus Effect TSGo0.43.0 via the documented
`effect-tsgo patch --typescript` install hook and `tsc --noEmit` in every workspace. The hook
replaces the native host executable; package versions alone do not prove the patch is active.
Verify `tsc --version` and the installed executable hash against the exact supported distribution.
Base/web tsconfig diagnostic settings and serial uncached typecheck policy remain unchanged.
The broader 0.43.0 nodeBuiltinImport rule rejects existing node:crypto imports, including
security-sensitive HMAC, timing-safe comparison and persistent hashes. Parent authorization is
required for materially different crypto/API migration or diagnostic-policy changes; do not
suppress these errors or replace secure randomness with the non-cryptographic Random service.
Cold repeated configured checks plus full release gates are necessary for intermittent native
compiler failures; a single passing rerun is not a fix. Prior failed evidence remains intact.

The user has now authorized a focused security-reviewed crypto compatibility investigation/fix,
NOT diagnostic relaxation or disguised imports. Effect beta.73 Crypto/NodeCrypto has no HMAC or
timing-safe-equality API. Do not replace node:crypto.timingSafeEqual with WebCrypto HMAC verify
without checking each supported runtime: Node24.13.1's implementation uses ordinary memcmp,
whereas Bun1.3.11 uses constantTimeMemcmp. A bounded native platform implementation still must
pass the unchanged diagnostic with ordinary imports; if impossible, stop for upstream capability
support or a new explicit parent decision. Do not partially migrate persistent crypto to force green.

Current crypto blocker evidence and decision alternatives are in
`.ged/runtime/release-patch-0.4.5/crypto/SESSION-SUMMARY.md`; active bounded work plan is under
`.ged/work/release-patch-0.4.5/crypto/`. Do not treat the passing independent release gates as
resolution of the failed full typechecks or of the required security/aggregate review.

The latest explicit user decision supersedes the prior crypto hold: retain native crypto and the
supported pinned compiler, with exactly inventoried import-scoped nodeBuiltinImport exceptions
and mechanical error-level enforcement, not global relaxation. Existing broad exceptions are
frozen/accounted separately. Fail closed on persisted signing-key length mismatches on both read
paths, with no rotation/regeneration fallback. Publication atomicity/crash-write availability is
separate deferred work. Active spec/evidence: `release-patch-0.4.5/guarded-crypto/` under `.ged/work`
and `.ged/runtime`. Parent independent security/aggregate review remains mandatory before release.

Release recovery must inspect gate manifests/logs, not rely on a timed-out agent's last prose:
commands may have completed after that message. Final guarded-crypto local gates (including three
cold full checks and clean/repeat installation) passed on macOS ARM64 Node24/Bun. Recovery adds
per-gate durable checkpoints and exact-source/install preservation hashes; authoritative release
handoff is runtime `release-patch-0.4.5/SESSION-SUMMARY.md`. Local success still requires independent
security/aggregate review and does not establish remote compiler platforms or publication readiness.

Release 0.4.5 independent aggregate review approved the 64-path recovery snapshot; security review
approved signing-key validation but found ordinary process-loader and bare-builtin inventory bypasses.
Bounded guard-only fixes and real Oxlint/scope regressions are tracked in release-patch-0.4.5/review-fixes/.
Freeze policy JSON/config/exception counts; recognize native modules with both bare/node: spellings.
Keep release status in runtime evidence, not a changelog sentence that survives manifest finalization.
Prior full release checks attest their earlier source hashes only; targeted re-review and remote CI
remain parent-owned before commit/push/publication. No hostile-JavaScript sandbox claim.

Security re-review identified ordinary bare-builtin / Module.createRequire / process-loader lexical
bypasses in the new crypto boundary. Follow-up is confined to guard/tests/docs, not native runtime,
allowlist broadening or global disabling policy. Active plan/evidence: release-patch-0.4.5/security-review/.
Aggregate lane is locally approved; security re-review and changed-state full release revalidation
remain pending. Prior full release results apply to their sealed source snapshot, not later edits.
