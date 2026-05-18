# Spec

## Goal

Make the composer Ged workflow toggle chat-scoped instead of global.

## Acceptance Criteria

- Toggling Ged workflow in one chat only changes that chat's effective workflow setting.
- Existing chats retain their own workflow setting when switching between chats.
- A newly created draft chat inherits the active chat's current workflow setting, matching the way composer model state is carried forward.
- A chat created from a chat where Ged is disabled starts disabled without mutating any other chat.
- Server-side Ged prompt injection and checkpoint enforcement use the target thread's workflow setting, not only the global settings default.
- Existing historical threads decode as Ged-enabled by default so current behavior is preserved unless a thread opts out.

## Constraints

- Keep `packages/contracts` schema-only.
- Reuse the existing thread/composer draft state patterns for model/runtime/interaction settings.
- Preserve the global settings switch as the default for threads without a per-thread override.
- Do not run `bun test`; use `bun run test`.
