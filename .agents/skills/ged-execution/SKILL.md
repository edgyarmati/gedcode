---
name: ged-execution
description: Implement a single bounded slice against its acceptance criteria. Use during implementation of a planned task.
---

Implement exactly one slice. The full role definition is `.ged/roles/implementer.md`; this skill is
the mechanics.

## Rules

- Implement the assigned slice only — not the next one, not an adjacent cleanup you noticed.
- Follow `.ged/STANDARDS.md`: Effect patterns, strict TypeScript, immutability, no duplicated
  logic, contracts packages schema-only, new files over upstream edits.
- Run narrow checks for what you touched — see the [verify](../verify/SKILL.md) skill. Not
  repo-wide.
- Never weaken a test, widen a type, or relax a lint rule to reach green. If a check is wrong, say
  so and stop.
- Never add a fallback or degraded path because the intended approach is blocked. Report and stop.

## You are not your own check

An independent verifier will review this diff against the acceptance criteria **without seeing your
summary**. That is deliberate, and it means your summary cannot help you — spend the effort on the
code instead.

## Report

What changed, which criteria you believe are satisfied, and explicitly what you could not verify or
left out. Unfinished work reported honestly is cheap; reported as done, it is found later and costs
much more.
