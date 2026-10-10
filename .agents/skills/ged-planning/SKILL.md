---
name: ged-planning
description: Produce an approach, dependency-ordered slices, and verifiable acceptance criteria for work you will not implement. Use before non-trivial implementation.
---

Plan work that someone else — likely a cheaper model, certainly without your context — will
implement.

The full role definition is `.ged/roles/planner.md`. Read it; this skill is the mechanics.

## Produce

Write to `.ged/plans/<slug>/`:

1. **SPEC.md** — goal, constraints, the approach, and the alternatives you rejected with reasons.
   Under 200 lines.
2. **TASKS.md** — dependency-ordered slices, each completable in one focused session and each
   independently verifiable.
3. **CRITERIA.md** — acceptance criteria per slice.

No placeholders. Every artifact gets real content or it is not done.

## Acceptance criteria are the point

A verifier will be handed these **verbatim** and asked to rule `met` / `not_met` / `unverifiable`
on each, from the diff alone, without trusting the implementer. Write them so that is possible.

`unverifiable` does not count as a pass and will block the land gate — and it is scored as a
planning defect, not an implementation one. A criterion like "ref parsing is robust" will earn it.
"`parseRef` returns `None` for an empty string, covered by a named test" will not.

## Constraints

- Respect the additive-only constraint in `.ged/STANDARDS.md`: prefer new files to edits of
  upstream ones, and call out explicitly any upstream file you believe must change.
- Do not write the implementation. Describe it.
- If the request is ambiguous in a way that changes the plan, stop and say so rather than picking a
  reading and planning confidently on top of it.
