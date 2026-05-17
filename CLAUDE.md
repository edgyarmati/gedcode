# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

GedCode is a fork of [t3code](https://github.com/pingdotgg/t3code) being rebranded. The goal is to make a custom workflow (from [ged-mono](https://github.com/edgyarmati/ged-mono)) work out of the box through GedCode's supported harnesses without modifying them.

**Branch strategy:** `gedcode` is the working branch. `main` stays clean for syncing upstream — never commit work directly to `main`.

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
