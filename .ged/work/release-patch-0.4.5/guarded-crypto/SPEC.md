# Approved native crypto policy + fail-closed signing keys

The user explicitly supersedes the prior no-exceptions decision. No additional clarification is
needed: retain TypeScript 7.0.2, Effect TSGo 0.43.0, native cryptography, all pins, global
nodeBuiltinImport:error and every other diagnostic. Preserve all pending work since eaa41bc72.

## Implementation contract
- Exactly 16 new next-line exceptions (13 production, three tests), at the diagnostic's module
  line after formatting. No import relocation, disguise, re-export, runtime crypto migration.
- An error-level existing Oxlint plugin rule uses its shared AST/scope parser to enforce exact
  file/module/import binding/operation/directive placement. Inventory existing broader exceptions
  separately, preserving rather than extending them; include the already-exempt crypto sites.
- Negative tests reject wrong files, modules, operations, moved/copied/broad directives and
  alternate/escaped/computed imports or leaked namespace bindings. Actual compiler fixtures load
  Effect in a separate program file and prove TS/other Effect/neighboring built-ins still fail.
- ServerSecretStore.getOrCreateRandom checks exact requested length on initial read AND
  AlreadyExists reread. Missing reread and invalid lengths fail SecretStoreError. No regeneration,
  overwrite, rotation, retry/degraded fallback. Valid bytes, public API, 0700/0600, wx preserved.
- Deterministic in-memory paused-writer tests include zero/truncated/oversized keys on both paths,
  missing/error rereads, valid reuse without RNG and persistence error propagation. No real auth
  or secret access. Do not redesign publication: incomplete files can still cause unavailability
  after crash or during creation; document this remaining risk, not an automatic recovery path.
- Fixed-byte characterization of missing credential/durable fingerprint/SSH expectations only;
  no crypto behavior changes. Accurately update pending 0.4.5 notes and durable context.

## Verification / acceptance
Focused tests per slice; bun fmt/lint and affected typechecks. Then supported Node24/Bun frozen
install, fmt check/lint, three cold uncached full typechecks, full `bun run test` (never `bun test`),
versions/smoke/audit, Chromium, uncached desktop build. Verify actual compiler runner for every
workspace and clean/repeat local install in an isolated snapshot. Prepare bounded clean-install
compiler CI on release OS/architectures; do not dispatch or claim unexecuted remote success.
Record all command exits/logs, preserve failures, baseline pending work and empty index. Parent
owns independent security AND aggregate diff review. No stage/commit/push/tag/dispatch/publish or
installed app restart. Local success does not authorize release or establish Windows/Linux success.
