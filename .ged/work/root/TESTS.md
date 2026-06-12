# TESTS

## Planned

- `bun run test -- src/components/chat/MessagesTimeline.logic.test.ts` from `apps/web`
- `bun run test -- src/components/chat/MessagesTimeline.test.tsx` from `apps/web`
- `bun run test:browser -- src/components/chat/MessagesTimeline.browser.tsx` from `apps/web`
- `bun run test -- src/session-logic.test.ts` from `apps/web`
- `git diff --check`
- `bun fmt`
- `bun lint`
- `TURBO_DAEMON=false bunx turbo run typecheck --concurrency=1`

## Evidence

- PASS: `bun run test -- src/components/chat/MessagesTimeline.logic.test.ts src/components/chat/MessagesTimeline.test.tsx src/session-logic.test.ts src/reviewCommentContext.test.ts` from `apps/web` (4 files, 94 tests)
- PASS: `bun run test:browser -- src/components/chat/MessagesTimeline.browser.tsx` from `apps/web` (1 file, 10 tests)
- PASS: `git diff --check`
- PASS: `bun fmt`
- PASS: `bun lint` (existing warnings only)
- PASS: `bun run typecheck` from `apps/web`
- PASS: `TURBO_DAEMON=false bunx turbo run typecheck --concurrency=1`
- NOTE: Earlier full typecheck retries failed in unrelated packages due transient module-resolution misses; the serialized rerun passed all 14 packages.
- PASS: Main-thread verifier fallback reviewed the diff and found no blocking issues for this slice.
