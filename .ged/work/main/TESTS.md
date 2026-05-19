# Tests: Fix React update loop on new chat

- `bun fmt`
- `bun lint`
- `bun typecheck`

Manual acceptance:

- Creating a new chat does not throw React error #185.
- Draft route can still promote to the canonical server route after the first message.
- Missing thread routes still redirect safely when appropriate.
