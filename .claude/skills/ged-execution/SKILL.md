---
name: ged-execution
description: Execute a single bounded task slice from .ged/work/root/TASKS.md. Use during the implement phase.
---

Implement the current active task from .ged/work/root/TASKS.md.

## Rules

1. Read STATE.md to find the active task.
2. Implement ONLY that task — no scope creep, no drive-by refactors.
3. After implementation, run verification (format, lint, typecheck, test).
4. Update STATE.md: mark task complete, set next task as active.
5. If verification fails, fix issues before moving on.

## Scope Guard

If you discover something that needs fixing outside the current task, add it as a new task in TASKS.md instead of fixing it now.

## Completion

When the active task is done and verified, update STATE.md and move to the next task. If all tasks are complete, transition to the "verify" phase.
