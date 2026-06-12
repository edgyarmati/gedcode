# SPEC

## Goal

Backport upstream commits `e1ce9f85` and `75257d64` so Claude SDK system messages are handled as structured runtime events or clearer diagnostics instead of flooding the UI with generic runtime warnings.

## Requirements

- Add a first-class `tool.denied` provider runtime event to the shared contracts.
- Handle Claude `system` message subtypes in the Claude adapter:
  - ignore `thinking_tokens`;
  - emit `tool.denied` for `permission_denied`;
  - emit a clear `runtime.error` for `mirror_error`;
  - use clearer unknown Claude SDK/system message wording with a short scalar preview.
- Project `tool.denied` events into orchestration activity as an error-tone tool-denied row.
- Preserve existing auth-warning message guidance while allowing runtime-warning activity summaries to reflect the adapter message.
- Add focused tests for contract decoding, Claude adapter mapping, and ingestion projection.
- Add an unreleased `CHANGELOG.md` entry.
- Mark `e1ce9f85` and `75257d64` as completed in `docs/upstream-decisions.md` and remove them from the Want To Implement representative list.

## Non-Goals

- Do not backport the broad app-server protocol/provider startup sync from `ae7e88b0`.
- Do not mix in provider/model catalog, UI polish, release tooling, or package-manager changes.
- Do not change unrelated Claude SDK message handling beyond this system-message slice.

## Acceptance Criteria

- Claude `thinking_tokens` produces no runtime warning.
- Claude `permission_denied` produces `tool.denied` with useful metadata.
- Claude `mirror_error` produces a clearer runtime error.
- Unknown Claude system messages use clearer wording and include a useful preview when available.
- Focused tests and required repository gates pass.
