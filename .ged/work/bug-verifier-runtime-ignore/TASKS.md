# Tasks

## 1. Shared path helper

- [x] Add a helper in `packages/shared/src/path.ts` for detecting paths inside dot directories.
- [x] Keep it string-based and runtime-neutral; do not depend on Node path APIs.
- [x] Cover POSIX and Windows separators.

## 2. Reactor invalidation predicate

- [x] In `GedWorkflowEventReactor.ts`, add pure provider-neutral helpers to extract file-change path candidates from `payload.detail` and `payload.data`.
- [x] Add a pure predicate for whether a file-change event should invalidate verifier checkpoints.
- [x] Preserve fail-safe invalidation when paths cannot be determined.
- [x] Skip invalidation only when all known changed paths are inside dot directories.

## 3. Reactor integration

- [x] Apply the predicate before session lookup and checkpoint file I/O.
- [x] Leave checkpoint read/decode/invalidate/write behavior unchanged for invalidating events.
- [x] Do not modify checkpoint schemas or provider adapters.

## 4. Tests

- [x] Add/extend `packages/shared/src/path.test.ts`.
- [x] Add/extend reactor tests under `apps/server/src/gedWorkflow/Layers/`.
- [x] Test `.ged`, `.git`, arbitrary dot dirs, normal paths, mixed paths, unknown paths, and hidden files.

## 5. Verification

- [x] Run focused Vitest commands with `bun run test`.
- [x] Run `bun fmt`.
- [x] Run `bun lint`.
- [x] Run `bun typecheck`.
