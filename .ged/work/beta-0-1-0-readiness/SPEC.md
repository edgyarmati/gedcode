# Beta 0.1.0 Release Readiness Audit

## Goal

Produce a read-only release readiness audit for GedCode beta `0.1.0`. Collect evidence and produce a go/no-go report. Do not implement fixes unless later requested.

## Scope

- Git/branch/tag state and release cleanliness.
- Version, package metadata, toolchain consistency.
- Release workflow and docs parity.
- Rebrand consistency and user-facing Alpha/T3 leftovers.
- Quality gates: fmt check, lint, typecheck, tests, build.
- Desktop/npm artifact feasibility and smoke checks where practical.
- Functional prerequisites for providers and server/CLI startup.

## Output

Final report includes executive status, evidence table, findings by severity, skipped checks with reasons, and recommended follow-up tickets.
