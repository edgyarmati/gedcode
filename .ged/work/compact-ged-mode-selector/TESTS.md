# Tests

## Focused checks

- `cd apps/web && bun run test:browser -- src/components/chat/CompactComposerControlsMenu.browser.tsx`

## Required repo checks

- `bun fmt`
- `bun lint`
- `bun typecheck`

## Manual checks

- Composer footer shows explicit thread mode selector.
- Selected state is compact: `Normal` / `Ged`.
- Ged inline green helper is gone.
- Dropdown/title still explains Ged mode uses the selected model for the main thread and role models come from Ged settings.
