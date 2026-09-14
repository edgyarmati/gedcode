# Release 0.4.5 targeted review fixes

## Goal / clarified contract
Close the two security-review guard blockers: ordinary alternate process crypto loaders and
bare Node builtin imports escaping the frozen legacy inventory. Aggregate review approved all
64 pending paths/hashes; key-length validation is approved. Independent targeted re-review is
required after this writer; parent alone owns commit/push and remote CI.

## Constraints
- Sole writer; preserve all pending application/security/dependency/toolchain/stage changes.
- Scope: native-crypto-boundary rule, regression fixtures, precise policy documentation,
  changelog pending-sentence cleanup and durable context/evidence only. No broad refactor.
- Shared AST/scope-aware classifier following repository unwrapExpression/getPropertyName and
  lexical-binding conventions. Handle direct globals, globalThis.process, process imports and
  straightforward initializer aliases; respect shadowed/local lookalikes. Not a hostile-JS sandbox.
- Use Node builtin classification for bare and node: static imports under legacy directives;
  retain exact import/text/order comparisons. No inventory/config/exception/crypto changes.
- Replace pending changelog sentence with durable publication-neutral wording. Do not claim
  published state; manifests/lock remain 0.4.4 for parent finalization.
- No staging/commit/push/tag/dispatch/publish/credential edits or installed-app actions.

## Acceptance
1. Real Oxlint regression failures reproduce both blockers before the fix and pass afterward;
   direct/imported/aliased loader negatives and scope/shadowing/nonloader positives pass.
2. Existing 55 guard fixtures and 14 actual compiler policy tests remain green; narrow plugin
   and scripts typechecks, bun fmt/fmt:check/lint and diff/index checks pass without allowances.
3. Record exact command exits/logs, hashes and preservation proof. Retain prior full release
   evidence as earlier-snapshot evidence, never same-SHA/current-source full-gate evidence.
4. Return changed files/tests/invariants/residual risks and required reviewer handoff.
