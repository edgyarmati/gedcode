# STATE

- **Phase**: implement
- **Phase**: complete
- **Active task**: none — all worker-thread continuation slices are `DONE`
- **Roadmap**: Worker Thread Continuation Policy
- **Clarified**: 2026-07-27
- **Completed**: 2026-07-27 — focused verification evidence is recorded in `TESTS.md`

## Worker Thread Continuation Completion

Completed 2026-07-27. The PM now prefers one bounded same-thread correction for a viable current
Plan/Work attempt, with explicit fresh-attempt boundaries and independent post-fix verification.

## PM Prompt Prefix Completion

Completed 2026-07-27. Global and project-scoped PM instructions now resolve into the immutable PM
system prompt, with explicit project blank values suppressing inheritance.

## Locked Decision

After explicit human approval, replacement landing updates the existing PR branch using
force-with-lease and replaces the PR title/body with the newly approved proposal. There is no
fallback that treats old completed landing state as permanently terminal.
