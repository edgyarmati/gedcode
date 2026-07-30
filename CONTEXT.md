# GedCode Work Inbox and Orchestration

GedCode presents normal conversations and orchestrated work through one durable work inbox while
keeping their lifecycle models distinct.

## Language

**Inbox**:
The workspace view that presents normal chat threads and active Orchestrator tasks as separate work
categories.
_Avoid_: Sidebar V2, task board

**Normal task**:
A normal chat thread presented with work-inbox semantics; it remains a thread rather than becoming
an Orchestrator task.
_Avoid_: Orchestrator task, chat history item

**Inbox lifecycle**:
The Active, Snoozed, or Settled work state of a normal task, independent of archival.
_Avoid_: Archive status, task status

**Orchestrator entry**:
An active or attention-requiring Orchestrator task surfaced in the Inbox as a shortcut to its
project workspace.
_Avoid_: Normal task, project group

**Force-land request**:
A human request for the PM to finalize the intended task changes and prepare immediate normal
landing while skipping remaining Review or Verify work.
It is available during Review or Verify with an optional reason. An active stage or dirty worktree
is allowed only when requesting it; the PM must durably settle the stage, finalize only scoped task
changes, and satisfy the ordinary clean exact-HEAD land gate and publication path.
_Avoid_: Force push, direct landing, verification override

**Direct publication**:
A PM-owned, taskless operation that publishes one existing commit to an explicit destination branch
and creates or updates its pull request under bounded repository safeguards.
_Avoid_: Force landing, direct task, arbitrary Git operation

**Normal landing**:
Task landing authorized by a current content-matched land gate after the configured pipeline,
including fresh Verify when Verify is enabled.
_Avoid_: Regular push
