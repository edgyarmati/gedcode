# Remove project-name header pill

## Goal

Remove the small active project-name pill/badge from the top chat header.

## Scope

- Target only `apps/web/src/components/chat/ChatHeader.tsx`.
- Remove the JSX block that renders `activeProjectName` in an outline `Badge` beside the thread title.
- Preserve `activeProjectName` prop usage for Open In picker, No Git badge, and Git actions.

## Non-goals

- Do not remove project awareness from the header.
- Do not remove the `No Git` badge.
- Do not change Open In picker or Git actions behavior.
