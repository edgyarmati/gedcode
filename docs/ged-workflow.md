# Ged Workflow

The Ged workflow is GedCode's operating model for coding-agent sessions. It keeps work moving through a predictable loop: clarify, plan, implement, verify, then commit or continue.

GedCode is not just a place to send prompts to providers. It is a workspace for keeping agent work structured, inspectable, and recoverable when a task spans long-running turns, reconnects, restarts, or partial streams.

## Phases

### Clarify

Clarify the task, constraints, and success criteria before changing files. For simple requests this can be quick; for larger work it prevents the agent from guessing its way into the wrong scope.

### Plan

Break non-trivial work into a concrete spec, task list, and verification plan. GedCode uses `.ged/` work artifacts so the current scope and next step are visible across turns.

### Implement

Apply focused changes in bounded slices. The goal is to keep progress understandable while preserving the ability to inspect provider output, changed files, and session state.

### Verify

Run the relevant checks and record the result before treating the work as finished. Verification should match the risk of the change: small documentation edits need lighter checks than cross-package behavior changes.

### Commit Or Continue

When the work is verified, commit it with a clear message or continue with the next bounded task. The workflow keeps the handoff explicit instead of letting long sessions drift.

## What GedCode Helps With

GedCode gives coding-agent work a structured workspace:

- provider sessions for supported coding-agent providers
- streamed events and conversation state in one place
- `.ged/` memory for durable project context, active task plans, and runtime checkpoints
- workflow status so the current phase and checkpoint state stay visible
- source-control actions for reviewing, committing, pushing, and opening pull requests

This matters most when agent work becomes operational rather than conversational: multi-step changes, interrupted sessions, handoffs between runs, or tasks where verification evidence needs to be easy to find.

## `.ged/` Memory

GedCode bootstraps a `.ged/` directory in each workspace that uses the workflow:

- root memory stores durable project context such as standards, architecture, decisions, and vocabulary
- work memory stores the current spec, task list, tests, notes, and state
- runtime memory stores ephemeral checkpoint state for the active session

The intent is simple: keep the agent's working contract visible in files, not buried in chat history.

## Checkpoints

For non-trivial work, Ged asks the agent to record planning and verification checkpoints. File changes invalidate prior verification, so a task should be checked again before it is committed.

These checkpoints are workflow guardrails. They make the agent's state and evidence easier to inspect, but they do not replace human review or the repo's own tests.

## Subagents

When a harness provides native subagent or worker tools, Ged can ask for role-specific help such as exploration, planning critique, and verification review. The parent agent still owns the final scope, source edits, verification judgment, and commit.

When those tools are not available, the same roles can be performed in the main thread.

Codex instances can also define a Ged subagent preset in provider settings. Use one line per role, for example:

```text
ged-explorer: model=gpt-5.4-mini, reasoning=medium
ged-planner: model=gpt-5.4, reasoning=high
ged-verifier: model=gpt-5.5, reasoning=xhigh
```

GedCode injects this preset only into Codex workflow prompts. The Codex harness still decides which subagent models and reasoning levels are available at runtime.

## What This Does Not Mean

GedCode does not prove that every agent decision is correct, and it does not remove the need to inspect diffs or run the right checks. The public promise is more practical: GedCode makes the workflow visible, repeatable, and easier to operate.
