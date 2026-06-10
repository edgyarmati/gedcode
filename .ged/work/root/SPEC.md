# Spec

## Goal

Make the generated Ged workflow prompt explicitly tell the model that a task it initially classifies as trivial may later be upgraded to non-trivial by the harness/runtime after edits are observed.

## Background

`packages/ged-workflow/src/WorkflowPrompt.ts` already documents auto-escalation, and `packages/ged-workflow/src/CheckpointValidation.ts` already enforces trivial-to-non-trivial escalation when a trivial task changes multiple source files. The prompt currently does not emphasize that this may happen after the model's initial classification, which can leave the model confused about why non-trivial gates apply mid-task.

Native Ged subagent tools were unavailable in this harness session, so explorer and planner work is recorded by the main agent.

## Acceptance Criteria

- The workflow prompt says an initially trivial classification is provisional once source edits begin.
- The workflow prompt says the harness/runtime may upgrade a trivial task to non-trivial when edits exceed the trivial boundary.
- The workflow prompt tells the model to stop and follow non-trivial gates if that upgrade occurs.
- `WorkflowPrompt.test.ts` covers the new wording.
- `CHANGELOG.md` documents the unreleased behavior note.
