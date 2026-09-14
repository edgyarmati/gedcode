# Security-review blockers: native crypto boundary

## Contract / clarification
The explicit user contract and security review are sufficient; no unresolved implementation
choice needs user authorization. Sole writer; preserve all pending release changes.
Source findings: `.pi-subagents/artifacts/f9d6680c_improve-reviewer_0_output.md` (two medium
blockers). Aggregate lane approved locally in `aaa7e41b_improve-reviewer_0_output.md`;
publication remains held. This follow-up does not redo that lane.

## Goal
Close ordinary syntax/lexical bypasses of the inventoried native-crypto boundary:
- Recognize bare Node built-ins (including subpaths) as native for the frozen legacy inventory;
  canonicalize only the parsed module source, retaining exact bindings/import shape/count/order.
- Reject `Module.createRequire` from module/node:module, including renamed named Module and
  default/namespace forms, without blocking unrelated shadowed identifiers.
- Reject `globalThis.process` and ordinary const process aliases accessing native loaders, plus
  imported getBuiltinModule from process/node:process and process default/namespace imports.
- Use real Oxlint/parser/scope negative fixtures and positive controls, not mocked visitors.

## Constraints
No allowlist/config/diagnostic widening or new lint disabling policy. No crypto runtime/API,
algorithm, persisted fingerprints, auth state, dependency, CI, publication, staging or commit edits.
Retain existing default/namespace module-import restriction and nonescaping named createRequire
literal non-crypto loader control. Lexical resolution, not arbitrary dataflow/hostile-JS sandbox:
no reflective/eval/interprocedural/mutable-object capability tracking. Shadowed unrelated
process/module/require/globalThis and imported same-spelled names must remain usable.
No full release rerun requested: preserve prior valid full gate logs/hashes and prominently mark
changed-state full release revalidation pending. Inline oxlint-disable remains a review-policy
risk, not permission to change disable policy.

## Acceptance
Both reviewed repros and requested variants fail with this specific Oxlint rule; legacy inventory
and permitted crypto tests still pass; unrelated shadows and benign process/noncrypto loaders pass.
Run focused guard tests, bun fmt, bun lint, plugin/scripts typechecks and real compiler fixtures.
Record each gate immediately, source-preservation/diff evidence, empty index and residual risks.
Independent security re-review is required; this worker does not grant security signoff/publication.
