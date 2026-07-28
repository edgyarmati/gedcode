# GedCode Orchestration

GedCode coordinates user-approved task pipelines and bounded PM-owned repository operations.

## Language

**Forced landing**:
A human-authorized task landing that skips only the fresh Verify requirement while preserving the
current land gate, exact content identity, clean inspected worktree, branch ownership, and normal PR
publication.
_Avoid_: Force push, unsafe land, bypass landing

**Direct publication**:
A PM-owned, taskless operation that publishes one existing commit to an explicit destination branch
and creates or updates its pull request under bounded repository safeguards.
_Avoid_: Force landing, direct task, arbitrary Git operation

**Normal landing**:
Task landing authorized by a current content-matched land gate after the configured pipeline,
including fresh Verify when Verify is enabled.
_Avoid_: Regular push
