# Tasks: Fix React update loop on new chat

## Goal

Creating a new chat must not trigger React error #185 / maximum update depth. The fix should avoid route/effect loops during draft creation and draft-to-server promotion.

## Clarified scope

- Users: web UI users creating a new chat.
- Scope: apps/web routing/state handling around new-chat draft and server thread routes.
- Constraints: preserve existing draft reuse/promotion behavior; avoid broad ChatView refactors unless required.

## Skill-fit

- Relevant existing guidance: ged-execution/ged-verification workflow, project React/TanStack Router/Zustand patterns.
- No external skill needed; this is a repo-local React bug fix.

## Recon findings

- New chat routes create fresh `threadRef` objects via route param selectors.
- Server thread route has effects depending on `threadRef` object identity and redirects to `/` when the route thread is absent but the environment has threads.
- Draft route navigates to canonical server thread when promotion is observed.
- Unstable route ref identity can repeatedly recreate selectors/effect deps and amplify redirect/promotion loops.

## Implementation slices

1. Stabilize route-derived thread refs in server and draft route components using primitive route params / memoized refs or stable keys.
2. Make redirect/promotion effects depend on stable primitive keys rather than fresh object references.
3. Add/adjust focused tests or type-level coverage where practical for helper behavior; otherwise rely on lint/typecheck and manual route reasoning.
4. Run `bun fmt`, `bun lint`, and `bun typecheck`.
