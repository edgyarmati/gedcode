# SPEC

## Goal

Backport the accepted Cursor model discovery behavior from upstream commit `d78e02cd`.

## Scope

- Decode Cursor's `cursor/list_available_models` ACP extension response.
- Discover Cursor model slugs, labels, and per-model config options from that extension method.
- Remove the older per-model capability probe loop from provider enrichment.
- Keep custom Cursor models merged through local settings.
- Update tests, mock ACP agent behavior, changelog, and upstream decision bookkeeping.

## Non-Goals

- Do not add the Grok provider.
- Do not change package manager, test runner, or provider UI behavior beyond the model catalog data returned by the server.
- Do not remove Cursor custom model support.

## Acceptance Criteria

- Cursor provider checks use `cursor/list_available_models` for discovered model catalog and capabilities.
- The managed provider background enrichment no longer spawns additional ACP sessions for model capabilities.
- Focused Cursor provider and ACP extension tests pass.
- Required repository checks pass.
- Completed upstream item is removed from `docs/upstream-decisions.md`.
