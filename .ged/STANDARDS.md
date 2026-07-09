# Imported Standards

These standards were imported from other harness-specific instruction files and approved for Ged use.

## AGENTS.md

```md
# AGENTS.md

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).
- Document relevant unreleased changes in `CHANGELOG.md` before considering a task complete. If the change should matter to users, operators, or release notes, update the `## Unreleased` section as part of the task.
- Do not implement fallback behavior or alternate degraded paths without asking the user first when a requested approach is blocked.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.

## Codex App Server (Important)

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

How we use it in this codebase:

- Session startup/resume and turn lifecycle are brokered in `apps/server/src/codexAppServerManager.ts`.
- Provider dispatch and thread event logging are coordinated in `apps/server/src/providerManager.ts`.
- WebSocket server routes NativeApi methods in `apps/server/src/wsServer.ts`.
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent` (provider runtime activity is projected into orchestration events server-side).

Docs:

- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Upstream Decision Tracking

Before categorizing, cherry-picking, or reimplementing upstream-only work from `pingdotgg/t3code`, check `docs/upstream-decisions.md`. Keep that document updated when upstream work is accepted, deferred, or ruled out. After completing a task from the document's "Want To Implement" section, remove that completed item from the list in the same change.
```

## CLAUDE.md

```md
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

GedCode is a fork of [t3code](https://github.com/pingdotgg/t3code) being rebranded. The goal is to make a custom workflow (from [ged-mono](https://github.com/edgyarmati/ged-mono)) work out of the box through GedCode's supported harnesses without modifying them.

**Branch strategy:** `main` is the working branch. Upstream (t3code) is tracked via the `upstream` remote — sync with `git fetch upstream`.

## Build & Verification

All of these must pass before considering any task complete:

```sh
bun fmt        # format (oxfmt)
bun lint       # lint (oxlint + custom plugin)
bun typecheck  # TypeScript strict mode + Effect diagnostics
bun run test   # Vitest — NEVER use `bun test` (it bypasses Vitest)
```

## Monorepo Structure

Bun workspace monorepo. Requires Bun 1.3.11 and Node.js 24.13.1 (`mise install`).

- `apps/server` — Node.js WebSocket server, wraps Codex app-server (JSON-RPC over stdio), manages provider sessions
- `apps/web` — React 19 / Vite UI, connects to server via WebSocket
- `apps/desktop` — Electron wrapper around server
- `apps/marketing` — Marketing site
- `packages/contracts` — Effect/Schema contracts. **Schema-only — no runtime logic.**
- `packages/shared` — Runtime utilities. **Explicit subpath exports only** (e.g. `@t3tools/shared/git`) — no barrel index

## Code Conventions

- **Effect ecosystem** (4.0.0-beta.59) is used pervasively — follow Effect patterns for error handling, dependency injection (Layers), and composable runtimes
- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, Effect Language Service diagnostics enabled
- **Immutability preferred** — create new objects rather than mutating
- **No duplicate logic** — extract shared code to `packages/shared` or `packages/contracts`
- Custom oxlint rule: `t3code/no-inline-schema-compile` — don't inline Schema.compile calls

## Architecture

Codex-first: the server starts `codex app-server` per provider session, streams structured events to the browser via WebSocket push on channel `orchestration.domainEvent`.

Key files: `apps/server/src/codexAppServerManager.ts` (session lifecycle), `apps/server/src/providerManager.ts` (provider dispatch), `apps/server/src/wsServer.ts` (WebSocket routes).

@AGENTS.md
```

