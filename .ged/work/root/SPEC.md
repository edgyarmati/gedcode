# SPEC

## Goal

Create a durable upstream decision document referenced from `AGENTS.md` so future upstream-only work is categorized consistently and not forgotten.

## Requirements

- Add `docs/upstream-decisions.md`.
- Include the prior upstream comparison evidence: local `main` is current with `origin/main`, and `main...upstream/main` was `117 83` after fetch.
- Use decision categories:
  - Want to implement
  - Deferred indefinitely
  - Not doing for now
  - Needs decision
- Record the user-decided scope now:
  - Mobile is not doing for now.
  - Relay/cloud is not doing for now.
  - T3 Connect is not doing for now.
- Keep remaining upstream groups in Needs decision with enough explanation for the user to categorize next.
- Reference the document from `AGENTS.md`.
- Update `CHANGELOG.md` under `## Unreleased` because this is maintainer-facing process documentation.

## Non-Goals

- Do not categorize undecided groups without user instruction.
- Do not cherry-pick or implement upstream code.
- Do not run `bun test`; this docs-only change only requires the repo gates.
