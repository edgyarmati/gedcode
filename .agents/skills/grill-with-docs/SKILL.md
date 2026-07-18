---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
disable-model-invocation: true
---

Run a `/grilling` session, using the `/domain-modeling` skill.

## GED integration

Before asking the first question, inspect the repository and the current files under
`.ged/work/root/`. Facts that the environment can answer are not clarification questions.

When a non-trivial request needs clarification:

1. Set the phase in `.ged/work/root/STATE.md` to `clarify` without discarding existing decisions.
2. Follow `/grilling` until the user confirms shared understanding. Keep `/domain-modeling` active
   throughout so resolved project language is captured immediately.
3. Use the repository's canonical root `CONTEXT.md` for glossary terms and `docs/adr/` for warranted
   decisions. Do not create `.ged/DECISIONS.md`, and keep implementation details in the task spec
   rather than the glossary.
4. Summarize the confirmed decisions, set the phase to `plan`, and continue with `/ged-planning`.

Do not plan or implement the requested change before the user confirms shared understanding. If the
request is already sufficiently precise, record that clarification was skipped because context was
sufficient and proceed directly to the planning phase.
