# Provider-neutral dot-directory verifier invalidation guard

## Goal

Fix Ged workflow verifier checkpoint invalidation so provider file-change events do not invalidate verifier checkpoints when reported writes are inside dot directories, especially `.ged/**` and `.git/**`, generalized to any dot-directory path segment.

## Scope

- Update `apps/server/src/gedWorkflow/Layers/GedWorkflowEventReactor.ts`.
- Add reusable path-segment detection in `packages/shared/src/path.ts`.
- Add focused tests for dot-directory path detection and reactor invalidation decisions.
- Keep behavior provider-neutral and minimal.

## Non-goals

- No UI changes.
- No checkpoint schema changes.
- No provider-specific branches.
- No broad adapter rewrites.
- No runtime logic in `packages/contracts`.

## Approach

- Add a shared helper that detects whether a path is inside a dot directory, normalizing POSIX and Windows separators and excluding `.` / `..` navigation segments.
- Keep hidden files like `.env` and `.gitignore` from counting as dot directories unless they are directory segments with children.
- Add a pure reactor predicate that extracts path candidates defensively from `payload.detail` and common nested `payload.data` path keys.
- Preserve fail-safe invalidation when no path candidates are available.
- Skip invalidation only when all known changed paths are inside dot directories; mixed dot-dir and source writes invalidate.

## Acceptance Criteria

- `.ged/**` and `.git/**` file-change events do not invalidate verifier checkpoints.
- Other dot-directory paths such as `src/.cache/file` do not invalidate.
- Normal source paths such as `src/app.ts` still invalidate.
- Mixed dot-dir plus normal-source file-change events invalidate.
- Missing/unknown path data preserves old behavior and invalidates.
- No provider-specific branching is introduced.
- `bun fmt`, `bun lint`, and `bun typecheck` pass.

## Plan Review Refinements

- Treat `payload.detail` as a path candidate only when it is a single path-like value, not prose, multiline summaries, or ambiguous presentation text.
- Keep extraction intentionally bounded to explicit path-shaped keys and common containers. If traversal encounters unsupported/ambiguous shapes and no safe complete path set can be established, fail safe by invalidating.
- For multi-change payloads, invalidation is skipped only when every extracted path is inside a dot directory and no ambiguity is detected.
- Add realistic mixed-shape tests, including dot-dir detail plus normal source path in nested data, to prove source edits still invalidate.
