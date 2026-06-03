# Spec: Compact Ged thread mode selector

## Goal

Keep the composer’s explicit thread mode selector while reducing footer clutter.

- Show compact selected labels: `Normal` / `Ged`.
- Keep the mode control explicit and discoverable as “Thread mode”.
- Remove the inline green Ged explanation beside the model picker.
- Preserve Ged mode help through trigger title/dropdown descriptions.

## Approach

UI-only cleanup in the web composer. Continue using the existing `gedWorkflowEnabled` boolean and existing thread/model behavior.

Primary files:

- `apps/web/src/components/chat/ChatComposer.tsx`
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx`
- `apps/web/src/components/chat/CompactComposerControlsMenu.browser.tsx`

## Design

- Keep full option labels/descriptions for dropdown items.
- Shorten selected trigger labels:
  - Normal mode: `Normal`
  - Ged mode: `Ged`
- Keep `aria-label="Thread mode"` and descriptive `title`/dropdown copy.
- Remove inline helper span: `Main thread model; role agents use Ged settings`.
- Align compact overflow menu radio labels to `Normal` / `Ged` under the existing “Thread mode” heading.

## Non-goals

- No server changes.
- No protocol/contract changes.
- No changes to `gedWorkflowEnabled` semantics.
- No model fallback, settings, draft, or role-agent behavior changes.
