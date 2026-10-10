---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: true
---

Run a `/grilling` session, using the `/domain-modeling` skill.

## GED integration

Before asking the first question, inspect the repository and any existing plan under
`.ged/plans/`. Facts that the environment can answer are not clarification questions.

When a non-trivial request needs clarification:

1. Follow `/grilling` until the user confirms shared understanding. Keep `/domain-modeling` active
   throughout so resolved project language is captured immediately.
2. Use the repository's canonical root `CONTEXT.md` for glossary terms and `docs/adr/` for
   warranted domain decisions. Keep implementation details in the spec rather than the glossary.
   `.ged/DECISIONS.md` is reserved for decisions about the Ged layer itself — do not file ordinary
   domain ADRs there.
3. Summarize the confirmed decisions and continue with `/ged-planning`.

There is no phase state to update. The durable stage machine was dropped; see
`.ged/ORCHESTRATION.md`.

Do not plan or implement the requested change before the user confirms shared understanding. If the
request is already sufficiently precise, record that clarification was skipped because context was
sufficient and proceed directly to the planning phase.
