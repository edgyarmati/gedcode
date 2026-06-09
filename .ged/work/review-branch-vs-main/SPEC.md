# SPEC: Branch review versus main

## Goal

Perform a comprehensive, review-only code review of every change on the current branch compared to `main`, covering changed source, tests, configs, lockfiles, docs, generated files, package metadata, release/CI files, and assets.

## Baseline

Use `git diff main...HEAD` as the comparison, and record current branch, `HEAD`, local `main`, merge-base, and worktree status in the review report. If local `main` may be stale, note that explicitly instead of pretending the review is reproducible against remote state.

## Scope

Review all changed files and maintain an explicit coverage checklist/table assigning every changed path to a category and disposition.

Mandatory deep-dive areas:

- Effect beta.73 / `Crypto.Crypto` migration, including server auth/credential/session storage and service provisioning
- Orchestration, checkpoint reactor, provider runtime ingestion, and WebSocket command ID generation
- TSGo/typechecking migration and loop refactors, including ordering, short-circuit, mutation, async/error behavior, empty/null cases
- Claude SDK / Opus 4.8 / ultracode changes
- Vitest parallelism and test infra changes
- Web composer provider-instance/model selection
- Desktop settings rename, app identity, release/update behavior, and persisted compatibility
- Event NDJSON / schema JSON changes
- Source control, shell/process launching, SSH/Tailscale, and VCS provider changes
- Generated Codex/ACP protocol artifacts and generator reproducibility implications
- CI/release workflows, package metadata, scripts, and lockfile
- Rebrand completeness from T3 Code to GedCode, separating user-facing strings, package IDs, persisted keys/dirs, protocol names, telemetry identifiers, and legacy compatibility exceptions

## Constraints

- Review-only: do not edit source files.
- Do not commit or push.
- Do not run `bun test`; use `bun run test` only.
- Required verification unless impossible: `bun fmt:check`, `bun lint`, `bun typecheck`, and `git diff --check main...HEAD`.
- `bun run test` is desirable; if skipped due time/environment, document why and run focused suites if practical.

## Acceptance criteria

- Every changed file is accounted for in a coverage table or inventory disposition.
- Findings include path/line, severity, impact, and suggested remediation.
- Each mandatory risk area has a documented review conclusion.
- Required verification commands pass or failures/skips are explicitly documented.
- Final report includes baseline SHAs, summary verdict, blockers, non-blocking findings, questions, risk checklist, coverage summary, and verification results.
