# Remove irrelevant Ged models button

## Goal

Remove the web UI **“Ged models”** header button and the dialog/menu it opens.

Gedcode no longer invokes or manages its own role subagents/models. Ged workflows use harness-native subagents, so this project-level Ged model UI is no longer relevant.

## Scope

- Remove the Ged models button/dialog from `apps/web/src/components/chat/ChatHeader.tsx`.
- Remove only the `ChatHeader` props and `ChatView` pass-through/derived callback plumbing that existed solely for this dialog.
- Keep shared provider/model logic, contracts, server handling, and settings schemas unless proven unused by local type/lint checks.

## Non-goals

- Do not remove `Project.defaultModelSelection` or related contracts/server handling.
- Do not remove global Ged main model settings or draft/composer model fallback behavior.
- Do not modify Ged workflow runtime behavior.
- Do not add a replacement model override UI.
- Do not migrate or clear existing stored project model selections.

## Risks

- Over-cleanup could break composer/draft model fallback behavior.
- The removed dialog may have been the only UI for one project-level override; that broader product decision is out of scope for this narrow removal.
