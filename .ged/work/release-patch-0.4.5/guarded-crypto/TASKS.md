# Bounded slices

- [x] GC-01: Inventory/freeze existing broad exceptions and crypto imports; add 16 next-line
  directives and exact AST/scope Oxlint guard. Extend shared fixture harness; adversarial tests.
  Verify focused plugin tests, fmt/lint and plugin/server/SSH typechecks.
- [x] GC-02: Validate persisted key length on both paths; deterministic in-memory filesystem
  races/error tests. Preserve wx/permissions/no fallback. Verify focused secret/auth tests and
  server typecheck.
- [x] GC-03: Add byte characterization; Effect-loaded real compiler boundary probes; discover
  workspace manifests and execute actual runners. Bounded clean/repeat-install CI tooling on
  macOS arm64/Linux x64/Windows x64. Verify focused suites and scripts/SSH checks.
- [x] GC-04: Accurate release notes/context, requested full release gates and isolated local
  clean installation. Preserve failures, report remote pending, review total scope/preservation/
  unstaged status; write runtime STATE and SESSION-SUMMARY for independent review.

Recovery checkpoint: GC-04 execution actually completed all local gates and clean/repeat install
before timeout; only state finalization/handoff was lost. See parent TASKS.md RC-01..04 for bounded
continuation with per-gate checkpoints and exact-source preservation evidence, not reimplementation.
