# The Ged workflow

The Ged workflow is what GedCode adds on top of the orchestrator it inherits. It answers one
question: **how do you know the change an agent just made is actually correct?**

The usual answer is to ask the agent, which is the one source that cannot be trusted. An agent that
has just written code is the worst available judge of it — it will restate its own intent back to
you as evidence. Ged's answer is that the agent who wrote the code never gets to rule on it, and
that nothing lands without a ruling.

## How to start

1. **Set up Ged in the project.** Open the project's settings and choose **Set up Ged**, or run
   _Set up Ged_ from the command palette, or ask an agent to set it up. GedCode shows the starter
   `.ged/` files it will add, then adds them on confirmation. Existing files are never changed.
2. **Fill in the Checks.** `.ged/STANDARDS.md` has a Checks table for the format, lint, typecheck
   and test commands. Implementers and verifiers run what it names.
3. **Start a thread at the project root** and describe the work. The agent learns from GedCode that
   the project uses Ged and follows the lead playbook: it clarifies intent with you first, then
   delegates, then verifies.

The process itself is served by GedCode through the `ged_playbook` tool, so it is the same for every
provider and every project, and updates with GedCode rather than living as files you maintain.

## How work moves

Three levels, each with a different job:

```
PM thread            the project root, no code edits
  │                  talks to you, owns the backlog, decides what starts
  ▼
Task lead            its own worktree, one per unit of work
  │                  decides what to delegate and to whom
  ▼
Role children        planner / implementer / verifier, sharing the lead's checkout
```

Leads run in parallel without colliding, because each owns a private checkout. Within a lead, the
children are ordinary delegated tasks, so you can watch them, inspect them and cancel them from the
UI exactly like any other orchestrator work.

There is no state machine. A typo fix delegates nothing; a refactor might delegate a planner, two
implementers and three rounds of verification. The lead chooses, guided by the lead playbook. A small change
the lead may make itself; it still needs a verdict to land.

## Why the verdict can be trusted

Isolation is not a matter of asking politely. Each property below rests on something mechanical:

- **The verifier is spawned by the lead, never by the implementer.** A verifier spawned by the
  implementer inherits its provider and model, and is contextually its own creature.
- **The verifier never sees the implementer's summary.** It is handed the original acceptance
  criteria and the diff, and forms its own view of what the code does. The self-assessment is
  precisely the artifact that transmits bias, so it is withheld.
- **The verifier runs a different vendor than the implementer.** Shared training priors and
  self-consistency pressure are the main sources of agreement bias. A different vendor removes both.
  With only one vendor installed, a same-family verifier is accepted with a warning. Important
  changes, or a weak foreign option, get two verifiers in parallel: a strong same-family one and a
  foreign one.
- **The verifier reports; it does not fix.** It runs with the lead's access so it can run the
  project's checks unattended, and its brief forbids fixes. It cannot quietly patch a problem and
  then declare success.
- **You cannot argue a verifier into agreement.** Each review round is a fresh delegation with no
  memory of the last one, so pressure does not accumulate across rounds.
- **Verdicts are structured, never prose.** Each acceptance criterion gets `met`, `not_met` or
  `unverifiable`, with evidence — a test name, a `file:line`, or command output. `unverifiable` is
  not a pass: it means the criterion was never written to be checkable, which is a planning defect
  worth surfacing rather than hiding.

## The land gate

The verdict is recorded in `.ged/verdicts/`, one record per branch carrying the commit it judged and
every verifier's ruling on it. A ruling on a new commit starts the record over.
Before anything lands, `.ged/bin/land-gate.sh` checks it, and fails closed — anything it cannot
positively confirm blocks:

- the working tree is clean, because the verifier reviewed a commit, not your uncommitted edits
- the recorded commit is still the current head, so an amend or a rebase invalidates the verdict
- every recorded verifier passed, every criterion is `met`, and every criterion carries real
  evidence
- at least one verifier's vendor differs from the implementer's, unless GedCode recorded that no
  other vendor was installed, in which case it passes with a warning

The gate is a shell script that runs Node, so `node` must be on the `PATH` of whatever runs it.
Run it directly, or wire it into a pre-push hook so it is not something anyone has to remember:

```sh
.ged/bin/land-gate.sh            # exit 0 allowed, 1 blocked, 2 environment error

printf '#!/bin/sh\nexec .ged/bin/land-gate.sh\n' > .git/hooks/pre-push
chmod +x .git/hooks/pre-push
```

Agents reach the same script through the `ged_land_check` tool rather than a reimplementation of its
rules, so the tool and the hook cannot disagree.

## Models

There is no fixed model table. The lead picks each child's model from its own family, matched to
the task; the verifier is the exception and runs another vendor. Tell the lead which models you
prefer and it records them in `.ged/model-notes.md`, then tries those first. When one is
unavailable it uses the closest it can and says so in the thread, so a fallback is never silent.

## Project memory

`.ged/` is the project's durable memory, served to every provider through MCP tools so an agent
reads it rather than being re-told it each session:

| File             | What it holds                                                  |
| ---------------- | -------------------------------------------------------------- |
| `PROJECT.md`     | what this project is and what it is for                        |
| `STANDARDS.md`   | how work here is expected to be done                           |
| `DECISIONS.md`   | decisions that are hard to reverse, and why they went that way |
| `CONTEXT-MAP.md` | where things live                                              |
| `PROGRESS.md`    | what has happened, in order                                    |
| `model-notes.md` | the models you asked for, by kind of task                      |
| `plans/`         | specs, task lists and acceptance criteria for work in flight   |
| `verdicts/`      | verifier rulings (untracked — see below)                       |

## What this does not claim

Verdict records are self-asserted and unsigned. The gate stops **omission** — a lead that skipped
verification, verified a stale tree, or let a same-vendor reviewer wave it through. It does not stop
a deliberately dishonest agent, which would need an attestation the agent cannot mint. Records are
also untracked, so the gate is a local, pre-push control; CI cannot see them yet.

Both limits are recorded in `.ged/DECISIONS.md` and are worth closing before this is relied on
beyond a solo workflow. Ged makes verification hard to skip and hard to bias. It does not replace
reading the diff.
