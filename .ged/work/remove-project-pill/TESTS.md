# Verification

```sh
bun fmt
bun lint
bun typecheck
```

Optional targeted test:

```sh
cd apps/web && bun run test src/components/chat/ChatHeader.test.ts
```

Manual expectation: active project chats no longer show a project-name pill in the header; unrelated header controls remain available.
