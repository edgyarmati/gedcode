# SPEC: GedPi workflow policy review

## Goal

Determine whether GedPi's enforced workflow is logically coherent, proportionate to task risk, and
pleasant enough to use repeatedly. Treat policy quality as the primary subject, then trace current
implementation to identify where enforcement is weaker, stronger, or different from the stated
policy.

## Audience

- GedPi maintainers deciding what the workflow should require.
- GedCode maintainers who mirror or expose parts of the Ged workflow.
- Users who need reliable agent behavior without unnecessary ceremony.

## Scope

- Task classification and clarification.
- Skill-fit and codebase discovery.
- Planning, plan acceptance, human review, and critique.
- Main-brain, explorer, planner, worker, and verifier ownership boundaries.
- Slice execution, verification, retry/recovery, durable state, commits, pushes, and PR decisions.
- Prompt guidance, checkpoint state, tool-call interception, preferences, and focused tests that
  enforce the workflow.
- Parity and contradictions between GedPi policy and GedCode's lightweight GED chat prompt.

## Non-goals

- Do not modify GedPi or GedCode product code in this review.
- Do not run the later codebase-wide `improve` workflow yet.
- Do not propose ceremony without a concrete reliability, correctness, or user-control benefit.

## Review principles

1. Gates should be risk-based, not merely task-size-based.
2. The user-facing brain owns decisions; delegation may improve evidence and throughput.
3. Durable artifacts should have a clear consumer and lifecycle.
4. Enforcement must be recoverable after interruption, partial completion, stale state, or failure.
5. A disabled role must preserve the underlying safety property, not just record that the role was
   skipped.
6. Policy, prompts, hard guards, preferences, and tests should describe the same state machine.

## Clarification checkpoint

- Status: completed.
- User emphasis: review both policy and enforcement, with policy as the main subject.
- Success: produce an evidence-backed keep/change/remove assessment and a recommended target
  workflow suitable as input to a later `improve` session.

## Skill-fit checkpoint

- Selected: `grill-with-docs`, `ged-planning`, and `pi-subagents`.
- Deferred: `improve` until the policy direction is accepted.
- No external skill search or project skill creation is warranted; current coverage is sufficient.
- No `ged-explorer`, `ged-planner`, or independent `reviewer` role is registered in this session, so
  discovery and planning use the main-agent fallback. The registered read-only `ged-brain` will be
  used for one independent adversarial pass.

## Deliverable

Write `REVIEW.md` containing:

- an executive judgment;
- the current policy as a state machine;
- strengths worth preserving;
- evidence-backed problems ranked by severity;
- concrete scenarios and failure/recovery analysis;
- a recommended target workflow with explicit gates and ownership;
- policy-versus-enforcement gaps;
- deferred codebase-improvement questions for the later `improve` session.
