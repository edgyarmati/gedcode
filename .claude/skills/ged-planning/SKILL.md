---
name: ged-planning
description: Write SPEC.md, TASKS.md, and TESTS.md in .ged/work/root/ with bounded implementation slices. Use after clarification is complete.
---

Create the planning artifacts in .ged/work/root/.

## Steps

1. Write **SPEC.md** — Clear contract for what will be built. Include: goal, constraints, acceptance criteria.
2. Write **TASKS.md** — Bounded implementation slices. Each task should be completable in one focused session (2-15 minutes). Include verification criteria per task.
3. Write **TESTS.md** — Verification plan. What to test, how to test it, expected outcomes.
4. Update **STATE.md** — Set phase to "implement", active task to first task from TASKS.md.

## Constraints

- No placeholders — every artifact must have real content.
- Tasks must be ordered by dependency.
- Each task must be independently verifiable.
- Keep SPEC.md under 200 lines.
