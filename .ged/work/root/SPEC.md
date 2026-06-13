# SPEC

## Goal

Backport compatible web markdown and visual polish from upstream `7f741a56` (`Misc markdown styling improvements (#3017)`).

## Scope

- Improve `ChatMarkdown` rendering, clipboard handling, markdown file tags, and related browser coverage.
- Port compatible web visual polish in timeline/composer/sidebar/status surfaces when it is part of the markdown usability slice.
- Update changelog and upstream decision bookkeeping.

## Non-Goals

- Do not port upstream mobile changes.
- Do not port `pnpm-lock.yaml` or package-manager/test-runner migration artifacts in this UI task.
- Do not broaden into the remaining composer/chrome/changed-files commits unless directly required by markdown compatibility.

## Acceptance Criteria

- Markdown-heavy chat content, file links, code blocks, and copied markdown behavior have focused coverage.
- Web package typecheck and required repo checks pass.
- `docs/upstream-decisions.md` records `7f741a56` as completed and removes it from Want To Implement.
