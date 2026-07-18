# Ged Workflow

The Ged workflow is GedCode's operating model for coding-agent sessions. It keeps work moving through a predictable loop: clarify, plan, implement, verify, then commit or continue.

GedCode is not just a place to send prompts to providers. It is a workspace for keeping agent work structured, inspectable, and recoverable when a task spans long-running turns, reconnects, restarts, or partial streams.

## Phases

### Clarify

Clarify the task, constraints, and success criteria before changing files. For simple requests this can
be quick. For larger work, the vendored `grill-with-docs` workflow inspects the repository for facts,
asks the user one decision at a time, and waits for shared understanding before planning. Resolved
project terms are recorded immediately in root `CONTEXT.md`; an ADR is offered only for a decision that
is hard to reverse, surprising without context, and the result of a real trade-off. For non-trivial
work, `.ged/work/root/STATE.md` records the `clarify` phase during the interview and moves to `plan`
only after the user confirms shared understanding.

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

GED mode does not eagerly create a `.ged/` directory. For non-trivial work, the selected model is
instructed to use the GED skills to create or refresh workflow files:

- root memory stores durable project context such as standards and architecture; canonical project
  vocabulary lives in root `CONTEXT.md`, while sparse architectural decisions live in `docs/adr/`
- work memory stores the current spec, task list, tests, notes, and state
- runtime memory stores ephemeral checkpoint state for the active session

The intent is simple: keep the agent's working contract visible in files, not buried in chat history.
See [GedCode Artifact Lifecycle](artifact-lifecycle.md) for exactly what creates `.ged/`, workspace
`.gedcode/`, and user `~/.gedcode/` data, along with retention and privacy guidance.

## Checkpoints

For non-trivial work, Ged asks the agent to record planning and verification checkpoints. File changes invalidate prior verification, so a task should be checked again before it is committed.

These checkpoints are workflow guardrails. They make the agent's state and evidence easier to inspect, but they do not replace human review or the repo's own tests.

## Native Agent Capabilities

GED mode supplies workflow guidance to the selected main model. GedCode does not force subagents,
select their models, or start managed child sessions for normal chat. If a provider harness offers
native delegation and the model chooses to use it, that behavior remains owned by the provider runtime.

## What This Does Not Mean

GedCode does not prove that every agent decision is correct, and it does not remove the need to inspect diffs or run the right checks. The public promise is more practical: GedCode makes the workflow visible, repeatable, and easier to operate.
