# Role briefs

The real role definitions. The orchestrator's `role` parameter is **vestigial** — it expands to a
single prompt line (`Act as the ${role} sub-agent for this task.`) and carries no behavior. A task
lead that wants a role to mean something must put the meaning in the prompt itself.

A lead composes a child prompt as:

```
<role brief, verbatim>

## Task
<the specific work>

## Acceptance criteria
<the criteria, verbatim from the plan — never a restatement>
```

Briefs are versioned here so they diff and improve like code. See
[../ORCHESTRATION.md](../ORCHESTRATION.md) for the topology these roles sit in, and
[model-policy.md](./model-policy.md) for which model and privilege each role gets.
