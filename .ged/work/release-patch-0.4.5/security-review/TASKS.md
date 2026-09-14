# Bounded slices

- [ ] SR-01 (10–15m): Add actual Oxlint fixtures reproducing bare native inventory expansion,
  Module.createRequire forms, qualified/const/imported process loaders and shadow controls.
  Verify baseline fails new repros while existing fixtures remain identifiable; keep red log.
- [ ] SR-02 (10–15m): Normalize parsed native sources and close module loader export gap without
  changing JSON inventory or namespace/default import policy. Verify focused module/legacy cases.
- [ ] SR-03 (10–15m): Scope-resolve process/globalThis, direct const alias chains and imported
  capabilities; replace spelling-only process/module/require recognition with lexical checks.
  Verify complete focused guard suite incl. shadows; no generic dataflow engine.
- [ ] SR-04 (10–15m): fmt/lint, plugin and scripts configured typechecks, compiler fixture tests.
  Preserve failed logs; bounded repair only if a scoped gate fails. Checkpoint after every gate.
- [ ] SR-05 (5–10m): Update relevant boundary/project/release evidence docs; compare full checkout
  to baseline and preserve historical recovery evidence; empty index; exact handoff for re-review.
  Changelog only if an additional release/user-facing entry is warranted (existing promise retained).

If a slice fails, retain evidence, explain cause here, and tighten before proceeding.

## Ownership conflict: plan tightened before SR-02
SR-01 fixtures added, but baseline verification is contaminated by an unexpected external rule
edit (see runtime ownership-conflict.json). Pause all implementation and gates until exclusive
ownership is reconciled. No rule edit was made by this worker; do not revert the external work.
After reconciliation, verify the combined rule/fixtures and rerun requested gates; do not claim
the current red run characterizes the original reviewed baseline.
