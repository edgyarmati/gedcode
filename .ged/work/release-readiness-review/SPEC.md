# Release Readiness Review: GedCode 0.1.0

## Goal

Resolve the current working tree responsibly, then perform an evidence-based release-readiness review for `feat/first-release-rebrand` / GedCode `0.1.0`.

## Scope

- Inspect all tracked and untracked changes before taking action.
- Validate the two known coherent change groups:
  - icon swap assets/resources
  - runtime warning detail surfacing
- Decide how to handle untracked `.ged/work` planning artifacts.
- Run required quality gates per `AGENTS.md`.
- Commit logical, conventional-commit groups when validated.
- Produce a concise release-readiness assessment with blockers, risks, and evidence.

## Non-goals

- Do not publish packages, push tags, create GitHub releases, or run release workflows.
- Do not discard user work without explicit confirmation.
- Do not broaden the release scope beyond review and cleanup.

## Acceptance Criteria

- Working tree is clean, or remaining untracked files are intentionally documented.
- No unrelated changes are silently included.
- Required checks pass: `bun fmt`, `bun lint`, `bun typecheck`.
- If tests are run, use `bun run test`, never `bun test`.
- Release-readiness report includes branch/HEAD, commits created, checks, blockers, risks, skipped checks, and final recommendation.
