---
name: ged-verification
description: Rule on acceptance criteria against a diff and record a verdict that satisfies the land gate. Use as an independent verifier, or as a lead wiring one up.
---

Independent verification. The full role definition is `.ged/roles/verifier.md`; this skill is the
mechanics and the record format.

## If you are the verifier

You are given the original acceptance criteria verbatim and the diff — and **deliberately not** the
implementer's summary, because self-assessment is the main vector for agreement bias. Read the code
and form your own account of what it does. If you catch yourself reasoning about what the author
intended, stop and rule on what the code does.

You run at `approval-required` and cannot edit. Describe defects precisely; do not fix them.
Finding and fixing are separated so a verifier cannot patch a problem and then declare success.

Rule on **every** criterion, in order — never a prose summary:

| `verdict`      | Means                                                                   |
| -------------- | ----------------------------------------------------------------------- |
| `met`          | Confirmed from the diff or a check you ran. "The author says so" is not evidence. |
| `not_met`      | Confirmed unsatisfied. Say concretely what fails, under what input.     |
| `unverifiable` | Not written so it can be checked. **Not a pass.** A planning defect — report it as one. |

Every `met` needs real evidence: a test name, a `file:line`, or command output. Overall status is
`pass` only if every criterion is `met`; you have no discretion to pass a partial result.

## If you are the lead

Spawn the verifier yourself — never let the implementer do it. Set `target.driverKind` to a
different vendor than the implementer used, and `runtimeMode: "approval-required"`. Pass the
criteria verbatim and the diff; withhold the implementer's summary.

Each review round is a fresh `delegate_task` with its own `taskId`. There is no session-preserving
follow-up API, which is what prevents arguing a reviewer into agreement across rounds. Cap at three
rounds, then escalate.

## Record the verdict

Write `.ged/verdicts/<branch-with-dashes>.json` per `.ged/verdicts/README.md`, then:

```sh
.ged/bin/land-gate.sh
```

The gate requires a record for the branch, `headSha` equal to the live head, `status: "pass"`,
every criterion `met` with evidence, and `verifier.driverKind` different from
`implementer.driverKind`. It fails closed.

Any amend or rebase after verification invalidates the record. Re-verify — editing the recorded SHA
is forging evidence.
