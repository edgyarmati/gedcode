# Project

GedCode is an early-WIP desktop/web workspace for Codex, Claude, and OpenCode, with a durable
Orchestrator workflow. Server provider drivers bridge native runtimes to shared domain events;
Codex uses JSON-RPC over `codex app-server` stdio through `packages/effect-codex-app-server`.
`packages/contracts` is schema-only; shared runtime helpers belong in `packages/shared`.

Priorities: performance, reliability, predictable failures, maintainable shared logic. Follow
`AGENTS.md`: bounded focused Vitest checks (`bun run test`, never `bun test`), `bun fmt`, `bun lint`,
and affected-package typechecks. Document unrelated failures without expanding scope; update
CHANGELOG Unreleased for user/operator-visible changes. Do not introduce degraded/fallback behavior
without approval. Provider auth/config and running applications are operator-owned.

Codex model availability is account-specific and discovered through `model/list`; exact explicit model
IDs must survive normalization. Verify new IDs with the authenticated catalog or official OpenAI
documentation, not naming guesses. Compatibility changes to generated protocol schemas must also
survive regeneration, rather than only patching generated output.
