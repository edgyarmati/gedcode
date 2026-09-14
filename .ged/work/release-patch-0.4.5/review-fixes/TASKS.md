# Bounded slices

- [x] RV-01 — Add real Oxlint repros for all three process loader forms plus bare legacy fs;
  retain pre-fix failures. Extend negatives to ordinary imported/alias forms and positives to
  scope/shadowing and non-native modules. Verify failing output identifies the rule bypasses.
- [ ] RV-02 — Implement shared scope-aware capability classification and builtin inventory
  predicate, preserving exact policy. Update precise policy docs and publication-neutral
  changelog wording. Verify focused guard suite, compiler policy suite, narrow package
  typechecks and mandatory formatting/lint; retain/fix any failures within this scope.
- [ ] RV-03 — Verify source preservation, exact hashes, empty index and diff; record outcomes
  in runtime STATE/SESSION-SUMMARY and handoff. Full release gates are not repeated unless
  rule-only changes expose product/toolchain behavior requiring them; keep historical results.

## RV-01 checkpoint / tightened plan
The four real-Oxlint repros all failed as expected before implementation (exit1, 4 failed / 55
filtered skips). Preserve before-fix-repros.log. RV-02 must make those same tests pass without
altering inventory/config. Extend lexical positives to require/module shadows as well as process;
use Node isBuiltin for bare names while retaining the prior node: prefix check (no new allowance
for unknown node: specifiers). No product or full-release rerun is warranted by this rule-only scope.

## RV-02 unexpected concurrent-write stop
expanded-rule-check failed before tests/typecheck because another appended suite redeclared legacy.
Preserve current file/evidence; parent must restore sole-writer ownership and authorize reconciliation.
Do not satisfy its new normalization allowance; it contradicts exact approved policy semantics.
