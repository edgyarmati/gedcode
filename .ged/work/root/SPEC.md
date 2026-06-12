# SPEC

## Goal

Backport the accepted Codex app-server protocol, service-tier, and provider-startup fixes from upstream commit `ae7e88b0`.

## Scope

- Sync the local `effect-codex-app-server` generated protocol/schema metadata where compatible.
- Port Codex model option/service-tier handling used by provider and text-generation paths.
- Port provider startup and managed-server behavior fixes from the upstream slice.
- Add or adapt focused tests for protocol client behavior, Codex adapter/provider startup, model options, and text generation.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not change non-Codex providers except where shared registry startup behavior requires it.
- Do not adopt unrelated upstream UI, cloud, mobile, Grok, or package-manager changes.
- Do not remove current Bun workflow requirements.

## Acceptance Criteria

- Codex app-server contracts match the accepted local subset of upstream `ae7e88b0`.
- Codex provider startup/service-tier behavior is covered by focused tests.
- Required repository checks pass.
- Completed upstream item is removed or narrowed in `docs/upstream-decisions.md`.
