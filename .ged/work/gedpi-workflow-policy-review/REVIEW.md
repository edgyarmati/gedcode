# Review: GedPi workflow policy and enforcement

## Executive judgment

GedPi has the right high-level intent but the wrong enforcement granularity.

The strongest ideas are worth preserving:

- one user-facing decision owner;
- clarification before the agent guesses about product decisions;
- an accepted scope before broad or risky edits;
- bounded implementation slices;
- verification that becomes stale when the verified content changes;
- workers that cannot authorize their own acceptance or commit.

The current workflow weakens those ideas by attaching them to ceremony rather than risk. A binary
`trivial` / `non-trivial` decision controls an expensive fixed pipeline: visible clarification syntax,
mandatory skill-fit, mandatory explorer, mandatory planner, plan acceptance, optional human review,
optional plan critique, implementation, mandatory verifier, and commit lifecycle closure. At the same
time, the hard guards do not reliably prove the properties they claim to enforce: shell writes bypass
edit guards, successful subagent process completion is treated as semantic success, fallback records
need only a reason string, approval is not tied to plan content, and branch-scoped stale state can
authorize unrelated later work.

**Recommendation:** do not optimize the existing state machine as-is. Replace it with a small,
risk-based workflow built around three work modes (`read-only`, `direct-change`, `planned-change`),
content-bound verification, task-scoped identity, and optional role delegation. Enforce only safety
properties; keep workflow techniques advisory.

## Review scope and evidence

Primary policy and implementation sources:

- `packages/gedpi/README.md`
- `packages/gedpi/AGENTS.md`
- `packages/gedpi/docs/single-writer-intelligence-orchestration.md`
- `packages/gedpi/src/brain.ts`
- `packages/gedpi/src/orchestration.ts`
- `packages/gedpi/src/vendor/shared-checkpoints.js`
- `packages/gedpi/extensions/ged-core/index.ts`
- `packages/gedpi/src/agent-settings.ts`
- `packages/gedpi/src/preferences.ts`
- `packages/gedpi/src/commit-settings.ts`
- bundled skills, templates, work engine, and focused tests

Secondary GedCode parity sources:

- `apps/server/src/orchestration/chatGedPrompt.ts`
- `apps/server/src/orchestration/chatGedPrompt.test.ts`
- `docs/ged-workflow.md`
- `docs/artifact-lifecycle.md`
- vendored `grill-with-docs`, `grilling`, and `domain-modeling` skills
- prior `.ged/work/*` Ged workflow plans and `.ged/DECISIONS.md`

Operational evidence:

- GedPi's effective global setting currently has `agents.enabled: false`, so the normal active mode is
  prompt-governed solo mode rather than structurally guarded subagent mode.
- GedPi's own current package-local `.ged/` state was inspected. It contains an unrelated Sitegeist
  project description in `.ged/PROJECT.md`, a stale `main` state, a still-active trivial post-release
  checkpoint from 2026-06-15, and many mutually incompatible schema-v3 checkpoint shapes. This is
  direct evidence that durable context and branch-scoped runtime state do not currently remain
  trustworthy without lifecycle validation.
- One independent read-only adversarial pass was run. It reached the same main conclusion but hit its
  turn-budget wrap-up. Its accepted findings are incorporated below; omissions are noted under
  **Independent review adjudication**.

## Current policy as a state machine

### Mode 1: solo mode, currently the default

When `agents.enabled` is false:

1. GedPi injects the solo single-brain prompt.
2. The model is instructed to clarify, run skill-fit, update `.ged/`, plan slices, implement, verify,
   record progress, and follow commit preference.
3. Tool-call checkpoint guards return immediately and enforce none of those steps
   (`extensions/ged-core/index.ts:503-513`).

This is a prompted workflow, not a structurally enforced workflow.

### Mode 2: subagent mode

When `agents.enabled` is true, the intended flow is:

1. **Classify** every request as `trivial` or `non-trivial`.
2. **Trivial:** execute directly; the planner and verifier checkpoints are bypassed.
3. **Non-trivial clarification:** declare exactly `grill-me: needed` or
   `grill-me: skipped; reason: ...`; record evidence or a sufficiency reason.
4. **Explorer:** run `ged-explorer` before source inspection and planning.
5. **Skill decision:** select, install, or create skills in the main brain.
6. **Planner:** run `ged-planner`; return to clarification if it refuses.
7. **Plan acceptance:** main brain writes `SPEC.md`, `TASKS.md`, and `TESTS.md`, then records
   `planAcceptance`.
8. **Review:** honor the human plan-review preference, then optionally run `ged-plan-reviewer` based
   on critique mode.
9. **Implement:** main brain writes by default; optional workers may implement suitable slices.
10. **Verify:** run planned checks and `ged-verifier`, adjudicate findings, fix, and rerun.
11. **Commit:** checkpoint guard validates planner and verifier records; successful commit closes the
    lifecycle and consumes planning authorization.

The policy is summarized in `src/brain.ts:41-67`, `src/orchestration.ts:295-353`, and
`docs/single-writer-intelligence-orchestration.md:94-124`.

## What should be preserved

### 1. Main-owned decision authority

The main brain should remain the user's only decision interface and should own scope, final artifacts,
finding adjudication, staging, commits, pushes, and PR decisions. Delegation should improve evidence
or throughput, not create competing authorities.

Use the canonical term **main-owned orchestration**, not **single-writer orchestration**. Optional
workers do write implementation files, and parallel workers are explicitly contemplated
(`docs/single-writer-intelligence-orchestration.md:90-92`). One writer per worktree is the actual safe
invariant.

### 2. Clarify decisions, discover facts

The one-question-at-a-time rule with a recommended default is good when a real decision is unresolved.
The equally important rule is to inspect available evidence instead of asking the user factual
questions (`skills/grill-me/SKILL.md:16-20`).

### 3. Accepted scope before broad or risky mutation

Separating a planner's draft from main-agent acceptance is sound. A planner can advise; it does not
own scope. The accepted plan must, however, be bound to the content accepted rather than merely to
path names.

### 4. Verification freshness

The intended invariant—changed content invalidates prior verification—is the strongest safety idea in
the current workflow (`src/vendor/shared-checkpoints.js:802-827`). Preserve it and make it tool-agnostic
and content-bound.

### 5. Worker output is non-authorizing

Worker completion must never substitute for review, verification, main acceptance, or commit
authority. Worker stop rules and acceptance evidence are useful supporting contracts.

### 6. Explicit commit and push policy

The `off | ask | on` commit preference is understandable. Never pushing without an explicit user
request is the right default (`src/commit-settings.ts:20-35`).

## Policy findings

### Critical — P1. The classification model is not a risk model

The policy classifies questions, docs, config tweaks, formatting, and comments as trivial, while every
bug fix and multi-file change is non-trivial (`src/orchestration.ts:295-305`). It auto-escalates only
after more than one source path is touched (`shared-checkpoints.js:875-892`).

Consequences:

- a security-sensitive one-line config change can bypass planning and independent verification;
- a clear two-file mechanical fix can enter the full pipeline after implementation has already begun;
- a small one-file bug fix pays explorer + planner + plan artifacts + verifier costs;
- a broad read-only review has no natural classification;
- file count substitutes for blast radius, ambiguity, reversibility, and verification difficulty.

**Change:** classify by intent, ambiguity, and risk—not request nouns or file count.

### Critical — P2. The policy treats role invocation as the safety property

Explorer, planner, and verifier checkpoints prove that a process returned successfully, not that
discovery was adequate, the plan was semantically sufficient, or findings were resolved. This makes
the workflow look stricter than it is while taxing every ordinary task.

**Change:** checkpoint evidence and content state. Roles are optional means of producing evidence.

### Critical — P3. Branch identity is not work-item identity

`currentWorkId()` maps the current branch directly to one active work namespace
(`src/ged-paths.ts:22-47`). A branch can contain multiple user requests, read-only investigations,
release follow-ups, and several commits. Closing happens only after a successful detected commit.

The inspected GedPi checkout demonstrates the failure: `.ged/runtime/main/checkpoints.json` still
contains an active `trivial` post-release tag/push task. That stale record can satisfy trivial guards
for an unrelated future request on `main`.

**Change:** every request/work item needs a unique durable ID; branch is metadata. State must be
explicitly paused, completed, abandoned, or superseded even when no commit occurs.

### High — P4. Mandatory explorer, skill-fit, and planner are excessive default ceremony

For all non-trivial work, the policy requires explorer reconnaissance, complete skill inventory,
possible ecosystem search, main-agent skill decisions, and a planner draft before edits
(`src/brain.ts:53-63`). These are useful techniques for unknown or broad work, not universal safety
requirements.

Costs include model latency, provider/configuration failure, context duplication, and a tendency to
produce artifacts merely to satisfy the workflow. The independent review agent itself first failed
because its configured provider credential was unavailable; a safe review should not depend on that
role existing.

**Change:** activate roles by need and risk. The main brain may inspect and plan directly.

### High — P5. Explorer-first source blocking conflicts with good clarification

`grill-me` says to inspect the code when facts are discoverable, but non-trivial mode forbids main-agent
source inspection until after clarification and explorer completion (`src/brain.ts:49-56`). The main
brain must decide what to ask before it is allowed to inspect the facts that determine whether a
question is necessary.

**Change:** read-only inspection should always be allowed. Guard mutation, not learning.

### High — P6. Human approval and machine critique are ordered incorrectly

The main brain accepts/writes the plan, then human review runs, then `ged-plan-reviewer` critique runs
(`src/brain.ts:60-62`). A later machine critique can require plan changes after human approval. Neither
human approval nor critique is content-hashed or part of hard validation.

**Change:** machine critique first, main adjudication second, human approval last. Any material plan
change invalidates approval.

### High — P7. Disabled-role fallback does not preserve the safety property

A fallback checkpoint is valid when it has `source: "fallback"`, an allowed status, and any non-empty
reason (`shared-checkpoints.js:236-279`). The validator does not establish that the role was actually
disabled or require equivalent files inspected, reasoning, commands, or verification output.

**Change:** stop checkpointing role names. Record the evidence the role would have produced.

### High — P8. Durable memory has too many overlapping sources of truth

GedPi eagerly creates placeholder `PROJECT`, `ARCHITECTURE`, `PATTERNS`, `GLOSSARY`, `DECISIONS`,
`IDEAS`, `SKILLS`, three plan files, `PROGRESS`, plan index, task artifacts, runtime `STATE`, session
summary, and checkpoints (`src/templates.ts:8-273`). Several are injected or parsed, while others are
mostly aspirational.

The observed package-local memory includes the wrong project's description and stale runtime state,
showing that “durable” can become “persistently misleading.” Eager empty stubs also look authoritative
despite containing no facts.

**Change:** create artifacts lazily; assign one owner and consumer to each; validate provenance and
freshness before injecting them.

### High — P9. The skill lifecycle creates task paraphrases, not reusable skills

When a task has no desired/matched skill, `ensureTaskSkillDependencies()` automatically creates a
project skill that repeats the task objective, done criteria, and context
(`src/skills.ts:629-673`). It later deletes managed skills with no active task references
(`src/skills.ts:759-794`).

This contradicts the bundled skill-authoring rule that skills should capture reusable, non-obvious
knowledge and not one-off tasks (`skills/skill-creator/SKILL.md:16-27`). It adds file churn without
improving capability.

**Remove:** never create a skill merely because none matched. Create one only for confirmed reusable
knowledge, with user-visible provenance; do not auto-delete genuinely durable project knowledge.

### High — P10. “Sole writer” conflicts with optional parallel workers

README says the main brain remains the sole writer (`README.md:141-143`), while runtime policy lets
workers edit and permits parallel workers with worktree isolation merely preferred/optional
(`docs/single-writer-intelligence-orchestration.md:90-92`). Max parallelism and isolation are prompt
guidance, not enforced by GedPi's checkpoint layer.

**Change:** one active writer per worktree. Parallel writers require isolated worktrees and explicit
merge/adjudication ownership.

### Medium — P11. Commit boundaries and work boundaries are conflated

Every successful detected commit consumes planner state and closes the lifecycle
(`shared-checkpoints.js:759-773`; `extensions/ged-core/index.ts:680-693`). This conflicts with the policy
of bounded slices and atomic commits: a planned work item may legitimately need several verified
milestone commits.

**Change:** keep the work item open across commits. Close it when its acceptance criteria are met or
the user abandons it.

### Medium — P12. Mandatory visible control syntax leaks machinery into normal conversation

For every non-trivial request, the model must visibly emit one of two exact `grill-me` declarations.
The decision is useful; exact user-facing syntax is not. It creates repetitive ceremony even for a
fully specified request and conflicts with the instruction not to expose internal handoffs.

**Change:** ask a question when needed; otherwise record sufficiency silently or summarize scope in
natural language.

### Medium — P13. Read-only work is not first-class

Reviews, audits, research, and explanations can be broad and high-value without requesting source
mutation. The binary classifier tends either to call them trivial questions (losing structured review
support) or route them through an implementation-shaped plan/verify/commit lifecycle.

**Change:** add an explicit read-only mode with optional report artifacts and no mutation/commit gates.

### Medium — P14. Recovery defaults to retry/narrow without adequate failure classification

The work engine uses a numeric retry limit and then says to tighten/narrow the slice
(`src/work.ts:44-55, 283-335`). The verification skill says to distinguish implementation failure from
environment failure, but the state machine does not require that diagnosis before retry.

**Change:** classify failure as implementation, specification, test/validation, environment,
dependency, or provider failure. Do not retry the same path without changed evidence.

## Enforcement findings

### Critical — E1. The hard edit guard is bypassed by shell mutation and alternate tools

Planner validation and verifier invalidation run only for tools named `write` or `edit`
(`extensions/ged-core/index.ts:567-639`). Bash is checked for pre-explorer inspection and `git commit`,
but after explorer clearance a command such as `sed -i`, `cat > file`, a formatter with writes, or an
arbitrary script can modify source without planner validation or verifier invalidation
(`extensions/ged-core/index.ts:641-669`). Other mutation-capable extension tools are likewise outside
the guard.

Therefore the claim that all source edits are structurally guarded and cannot be bypassed except by
the configured escape hatch is false (`src/orchestration.ts:307-318`). Treat the interceptor as
accident prevention, not a security boundary, until mutation detection is tool-agnostic.

### Critical — E2. Successful subagent execution is mistaken for a successful semantic checkpoint

Checkpoint recording marks a recognized role complete when the subagent process reports success
(`extensions/ged-core/index.ts:160-199`). It does not parse the role's output.

Specific failures:

- A planner that returns `outcome: refused-needs-clarification` is recorded with no `outcome`. The
  validator accepts missing outcome for backward compatibility (`shared-checkpoints.js:477-493`).
- A verifier that reports commit blockers is auto-recorded with `blocksCommit: undefined`; the code
  explicitly assigns `undefined` (`extensions/ged-core/index.ts:92-95`). Commit validation therefore
  allows it unless the main agent manually edits the record.
- Explorer completion proves neither inspected scope nor evidence coverage.

This directly contradicts changelog and prompt claims that planner refusal and verifier blockers are
structural gates.

### Critical — E3. Stale branch-scoped trivial state authorizes unrelated work

The guard has no request/session fingerprint. Any active trivial checkpoint in the current branch
passes planner and commit validation (`shared-checkpoints.js:422-424, 618-620`). New-user-request
classification is a prompt instruction, not a runtime-detectable transition.

The active GedPi `main` checkpoint observed during this review is a concrete stale authorization
example.

### High — E4. Initial source inspection is allowed before classification

The explorer-first interceptor blocks only when a checkpoint exists and is non-trivial or closed
(`extensions/ged-core/index.ts:528-565`). With no state, source reads pass. This contradicts the
“classification first” and “no source inspection before explorer” prompts, while still causing the
worse UX after a non-trivial classification has been written.

### High — E5. Plan acceptance is path- and timestamp-shaped, not content-bound

Validation requires an accepted status, source, timestamp, non-empty path list, and ordering after the
planner (`shared-checkpoints.js:299-345`). It does not verify that files exist, that all canonical plan
files are named, that content matches what was reviewed, or that later edits invalidate acceptance.

### High — E6. Fallback acceptance is not checked against effective role settings

Any fallback with a reason is accepted even when the role is enabled. Tests explicitly encode
reason-only validity (`tests/orchestration.test.ts:409-440, 761-778`). The hard guard can therefore be
satisfied by hand-written fallback narration.

### High — E7. Commit authorization is not tied to the staged diff or verified content

Verifier checkpoints have no required tree/diff hash. The normal commit prompt asks the model to
stage “files that belong” (`templates/managed-prompts/commit.md:5-13`), but the guard cannot prove that
the staged content is what tests or verifier reviewed. Unrelated dirty changes can be included, and
shell edits after verification may not invalidate the checkpoint.

### High — E8. Commit success and task closure are inferred too loosely

The tool-result handler closes state after any non-error bash result whose input contains a detected
`git commit` (`extensions/ged-core/index.ts:680-693`). It does not use the available
`detectRecentCommits()` helper or compare HEAD. A compound command that masks commit failure can close
the task without a new commit.

### Medium — E9. Runtime verifier records do not map to planned slices

Auto-recording stores every verifier under task key `auto`
(`extensions/ged-core/index.ts:83-101`). The validator can model task IDs, but actual runtime recording
does not connect verifier evidence to `T01`, `T02`, or a current slice. “Verify every slice” is not
structurally represented.

### Medium — E10. Tests validate strings and hand-built states more than end-to-end safety

Focused tests thoroughly assert prompt text and pure validator behavior, but the gaps above are not
covered: shell mutation, alternate write tools, planner refusal parsing, verifier finding parsing,
plan content invalidation, staged-diff binding, stale request reuse, or masked commit failure. For
example, the “full workflow” integration test manually constructs semantic metadata rather than
driving the extension through real role outputs (`tests/orchestration.test.ts:1288-1364`).

### High — E11. GedPi's own `.ged/` state demonstrates schema and freshness drift

The inspected package-local runtime contains many `schemaVersion: 3` files that place clarification
and plan acceptance inside `planCheckpoints`, use names such as `gedExplorer`, `ged-explorer`,
`explorer`, and `planner`, or even set `lifecycleStatus: "non-trivial"`. Most do not conform to the
current validator's top-level `clarification` and `planAcceptance` schema. Most completed historical
tasks remain `active`.

Because `.ged/runtime/` is ignored, migration and validation must happen at runtime; current behavior
mostly returns null or treats the active branch's surviving state as authoritative. The memory model
is not delivering its promised recoverability.

### High — E12. GedCode and GedPi currently implement different policies under the GED name

GedCode intentionally removed its prior managed workflow subsystem and now prepends lightweight
guidance only. Its prompt:

- uses `grill-with-docs`, not the exact `grill-me` checkpoint declaration;
- writes `.ged/work/root/STATE.md`, while GedPi uses `.ged/runtime/<work-id>/STATE.md`;
- treats root `CONTEXT.md` and `docs/adr/` as canonical, while GedPi initializes
  `.ged/CONTEXT-MAP.md`, `.ged/GLOSSARY.md`, and `.ged/DECISIONS.md`;
- does not enforce checkpoint JSON, role dispatch, plan acceptance, verifier freshness, or commit
  authorization;
- leaves provider-native delegation discretionary
  (`apps/server/src/orchestration/chatGedPrompt.ts:1-17`).

This can be a valid lightweight product mode, but it is not enforcement parity. Shared terminology
and artifact contracts must not imply guarantees GedCode does not provide.

## Scenario stress test

| Scenario | Current result | Target result |
| --- | --- | --- |
| Explain one module | Trivial, but subagent-mode prompt still asks for classification paperwork. | Read-only; inspect and answer. |
| Broad architecture review | Either “trivial question” with no structured path or full implementation ceremony. | Read-only review; optional durable report. |
| Clear one-file bug fix | Full non-trivial explorer/planner/verifier pipeline. | Direct-change with regression check; independent review only if risk warrants. |
| Clear two-file mechanical fix | May begin as trivial, then auto-escalate after the second write. | Classify before mutation using blast radius and verification difficulty, not observed file count. |
| One-line auth/security config | Can be trivial because it is a config tweak. | Planned/high-risk regardless of line count. |
| Ambiguous UI behavior | Clarification pipeline is directionally correct, but fact inspection is blocked first. | Inspect facts, ask unresolved product decision, then planned-change. |
| Planner provider unavailable | Role failure can stall or requires reason-only fallback paperwork. | Main brain plans directly and records the actual scope/evidence. |
| Planner says more clarification is needed incorrectly | Prompt gives planner an unconditional veto. | Main brain adjudicates; ask only if a real user decision remains. |
| Verifier reports blocker in prose | Process success can still create a commit-authorizing checkpoint. | Structured findings make blocker state machine-readable; fixes invalidate evidence. |
| Shell edit after verifier | May not invalidate verifier. | Any content change invalidates content-bound verification. |
| Several atomic commits for one work item | First commit closes task and consumes plan. | Work item stays open; each commit verifies its staged content. |
| Read-only task or tag/push with no commit | Lifecycle may remain active indefinitely. | Explicit completion closes/supersedes the work item. |
| New request on same branch | Stale checkpoint can authorize it. | New task ID/request fingerprint; old state cannot authorize. |
| Parallel workers | Optional shared-worktree writes can conflict. | Parallel writers require isolated worktrees and enforced concurrency. |
| Dirty worktree with user edits | Verification is not tied to scoped staged content. | Capture baseline, preserve unrelated changes, stage only scoped verified paths. |

## Recommended target policy

### A. Classify work on three axes

#### Intent

- **Read-only:** explanation, review, audit, research, recommendation; no repository mutation requested.
- **Direct-change:** clear, bounded, reversible work with obvious focused verification and no unresolved
  product/security/API/data decision.
- **Planned-change:** broad, risky, multi-session, migration/security/data/API/architecture work, or
  any change with unresolved user decisions.

#### Ambiguity

- **Sufficient:** facts and decisions are concrete enough to proceed.
- **Decision-needed:** a user-owned choice remains unresolved.

#### Risk

- **Low:** small blast radius, easy rollback, focused deterministic check.
- **Normal:** meaningful code behavior with ordinary regression risk.
- **High:** security, privacy, authentication, data loss/migration, public API, release/infra,
  irreversible operation, broad concurrency, or difficult verification.

File count is evidence, never the classifier.

### B. Target state machine

1. **Open work item**
   - Create a unique task/work ID tied to the request or thread; store branch/HEAD as metadata.
   - Inspect dirty state and preserve unrelated user changes.
2. **Understand**
   - Read-only inspection is always allowed.
   - Ask one concise question only for an unresolved user-owned decision; include a recommended
     default.
   - Record durable project knowledge only when genuinely reusable.
3. **Choose workflow depth**
   - Read-only: investigate and report; optionally save a report.
   - Direct-change: record a concise scope and verification contract; no mandatory three-file plan.
   - Planned-change: write SPEC/TASKS/TESTS and obtain any required review/approval.
4. **Critique and approve planned work**
   - Optional/risk-based machine critique first.
   - Main brain adjudicates and finalizes.
   - Human approval last when configured or when unresolved high-impact choices remain.
   - Bind approval to a plan content digest; material edits invalidate it.
5. **Delegate only when useful**
   - Explorer: unknown/broad context or parallel read-only scopes.
   - Planner: complex decomposition or independent plan challenge.
   - Plan reviewer: high-risk plan or worker delegation.
   - Worker: low-ambiguity mechanical slice in an isolated worktree.
   - Verifier: independent review for normal/high-risk changes or configured always-review.
6. **Implement**
   - One active writer per worktree.
   - Execute one coherent slice/milestone at a time; parallelize only isolated work.
   - Stop on scope expansion or a new user-owned decision.
7. **Verify content**
   - Every code/config mutation receives risk-appropriate checks before commit.
   - Record command, exit/result, relevant output, baseline/staged diff digest, and residual risks.
   - Any content change invalidates evidence for that content.
   - Independent verifier is risk-based; main-agent verification is valid when it produces the same
     evidence, not because a role was “disabled.”
8. **Commit or continue**
   - Respect `off | ask | on` preference.
   - Stage only scoped, verified content.
   - Keep the work item open across coherent milestone commits.
   - Never push without explicit user authorization.
9. **Close or recover**
   - Mark completed, paused, abandoned, or superseded independently of commit occurrence.
   - On failure, classify cause before retrying. Change the plan/evidence, escalate, or ask the user;
     do not repeat blindly.

### C. Hard enforcement versus advisory guidance

#### Enforce structurally

- A stale/other work item cannot authorize the current request.
- Planned/high-risk mutation requires accepted current scope.
- Commit requires verification bound to the staged content being committed.
- Mutating content invalidates matching verification regardless of tool used.
- Parallel writers use isolated worktrees and enforced concurrency limits.
- Staging excludes unrelated user changes unless the user explicitly broadens scope.
- Push and destructive Git operations require explicit authorization.

#### Keep advisory or risk-based

- Exact clarification wording.
- Whether an explorer, planner, or reviewer role is used.
- Skill-fit inventory and ecosystem search.
- Three-file planning artifacts for small direct changes.
- Human plan-review UI for ordinary low-risk work.
- A fixed number of retries or slices.

### D. Artifact model

#### Durable project context

Create only when substantive. Pick one canonical domain-document model across GedPi and GedCode.

**Recommended default:** root `CONTEXT.md` for project/domain vocabulary and sparse `docs/adr/` records
for durable trade-off decisions, while `.ged/PROJECT.md` holds the concise agent-oriented project
summary. Remove duplicate `.ged/CONTEXT-MAP.md`, `.ged/GLOSSARY.md`, and `.ged/DECISIONS.md` from the
shared contract once migrated.

#### Work artifacts

- Read-only: optional `REVIEW.md` / research report.
- Direct-change: one concise work record containing scope and checks is sufficient.
- Planned-change: `SPEC.md`, `TASKS.md`, and `TESTS.md` remain useful.
- Work ID is task/thread-based, not branch-based.

#### Runtime state

Use one machine-authoritative state record with lifecycle, current slice, approvals, evidence digests,
and recovery status. Derive UI/status summaries from it. Write a session summary only when a real
cross-session handoff is needed; do not maintain several competing progress ledgers every turn.

## Keep / change / remove

| Keep | Change | Remove |
| --- | --- | --- |
| Main-owned decisions | Binary classification → intent/ambiguity/risk | Explorer-first read blocking |
| One-question clarification when needed | Role checkpoints → evidence checkpoints | Mandatory visible `grill-me` prefix |
| Accepted scope for planned work | Machine critique before human approval | Automatic one-off task skill creation |
| Bounded slices | Approval and verification bound to content | Reason-only fallback authorization |
| Verification invalidation on changes | Branch work ID → task work ID | Close/replan after every commit |
| Worker non-authorization | Single writer → one writer per worktree | Claims that narrow tool interception is unbypassable |
| Commit preference / explicit push | Eager stubs → lazy substantive artifacts | Universal subagent/skill-fit ceremony |

## GedCode implications

Do not restore the removed 4,000-line managed Ged workflow subsystem merely to claim parity. GedCode's
lightweight normal-chat mode can remain prompt-directed, but it should share:

- the same three work modes and risk vocabulary;
- the same clarification principle;
- the same canonical durable artifact locations;
- honest language about which guarantees are advisory versus enforced;
- the same content-bound verification contract when GedCode does enforce commits.

Provider-native delegation may remain discretionary in lightweight chat. If GedCode later advertises
hard GED checkpoints, those checkpoints must be owned by trusted server state rather than model-written
JSON.

## Independent review adjudication

Accepted from the independent pass:

- the workflow has a strong safety core but overbuilt mandatory ceremony;
- solo and managed modes provide materially different guarantees;
- classification and explorer-first behavior are inconsistent;
- reason-only fallback is insufficient;
- per-commit closure harms iterative work;
- GedCode and GedPi artifact/clarification vocabulary has drifted.

Corrections/additions made by the main review:

- “single-writer” was narrowed to the enforceable one-writer-per-worktree invariant;
- verifier freshness is worth preserving, but is not currently reliable because shell/alternate-tool
  mutation bypasses invalidation;
- successful role execution does not parse planner refusal or verifier blockers;
- active branch state can authorize unrelated work;
- automatic project-skill creation is task paraphrase churn;
- GedPi's own local durable/runtime state provides concrete evidence of stale and incompatible state.

## Inputs for the later `improve` session

The later codebase review should plan implementation against the target policy above, not repair every
piece of the current checkpoint pipeline independently. It should answer:

1. What trusted component owns task IDs, lifecycle transitions, plan digests, and verification digests?
2. How can mutation detection be tool-agnostic—e.g. Git/tree snapshots around guarded operations—while
   remaining performant?
3. Which current `.ged/` artifacts have real readers/consumers, and what can be migrated or removed?
4. How should old branch-scoped and schema-incompatible runtime state be quarantined safely?
5. What is the smallest shared policy/contract surface GedPi and GedCode should actually share?
6. Which enforcement tests should exercise real tool events, staged diffs, subagent outputs, failure
   recovery, and stale-request boundaries end to end?

## Bottom line

GedPi should be strict about **scope, user decisions, writer isolation, verified content, unrelated
changes, and publication authority**. It should be flexible about **which agent performs discovery,
whether a formal planner is used, how many markdown files are written, exact clarification syntax, and
whether a skill exists**.

That is the policy baseline recommended for approval before running the codebase `improve` session.
