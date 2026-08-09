# Tasks: GedPi workflow policy review

## Status legend

- `[ ]` pending
- `[~]` active
- `[x]` complete

## Review slices

1. [x] Map the stated GedPi policy into states, transitions, gates, role ownership, and durable
   artifacts.
2. [x] Trace actual enforcement through system prompts, checkpoint validation, tool interception,
   settings, fallback paths, and focused tests.
3. [x] Stress-test the workflow against trivial requests, clear fixes, ambiguous features, read-only
   reviews, broad improvements, interrupted sessions, failed verification, disabled roles, and dirty
   worktrees.
4. [x] Obtain an independent read-only adversarial assessment and adjudicate its findings.
5. [x] Write `REVIEW.md` with ranked findings and a recommended target workflow; identify which
   questions belong to the later `improve` session.

## Done criteria

- Every material claim cites a policy document or implementation location.
- Policy defects are separated from enforcement defects.
- Recommendations say what to keep, change, or remove and why.
- No product/source code is modified.
