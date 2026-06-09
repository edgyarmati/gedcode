# RepoPrompt CE — Prompting Craft Analysis

Distilled from a full read of the prompt source files in this directory. Quotes are
**verbatim** from the prompts (the wording is the asset). Use this as the map; use the
`.swift` files as the territory.

The single idea everything hangs on:

> **"The Selection Is The Universe — The files you select become the next model's entire
> world. The next model likely will NOT have tool access—they only see what you curate.
> When in doubt, include rather than exclude."**

Every technique below is downstream of that premise.

---

## Part 1 — Workflow prompts (`workflows/`)

### Orchestrate (`WorkflowPrompt+Orchestrate.swift`)
Purpose: plan → decompose → delegate across sub-agents while keeping the orchestrator's own
context lean.

- Hard role framing + negative scope (you are NOT the implementer), restated in principles
  and anti-patterns.
- Phase decomposition (0 Workspace Verify → 1 Contextualize → 2 Decompose → 3 Dispatch →
  4 Monitor/Verify).
- Context discipline as the core value: read only to verify, not to build your own model.
- Granularity governor against busywork; verify-then-dispatch loop ("do not fire-and-forget").
- Escape hatches to prevent ritual tool use ("User named the file → skip the scan").
- Anti-*over*-work inversion (forbids extended reading, repeating CLAUDE.md, idle waiting).

> "You are an orchestrator: **plan**, **decompose**, **delegate**. Implementation and deep
> context-gathering happen in sub-agents. Keep your own context lean for coordination."

> "Translate the user's prompt into the codebase's actual nouns — concrete modules,
> filenames, patterns — so builder can focus immediately instead of disambiguating."

> "Do **not** fire-and-forget the full list. Catching drift early — before the next agent
> builds on a flawed foundation — is your value as the orchestrator."

> "**Trust the agents.** They're smart, they have tools, they read project instructions.
> Give them goals and reference points, not turn-by-turn directions."

> "Explore agents are cheap — spawn multiple in parallel for different areas, but keep each
> prompt narrow. They tend to overthink broad instructions."

### Deep Plan (`WorkflowPrompt+DeepPlan.swift`)
Purpose: delegation-heavy planning that yields exactly one executable plan doc — no code.

- Single-artifact stop condition in the first paragraph.
- Voice ownership vs delegated evidence ("sub-agents gather; you write"; "merge, don't append").
- Concision as direction of travel — the plan must get *shorter* as it matures.
- Grounded-question rule — questions must be unanswerable without first reading code/draft.
- Relevance trigger gates external research.

> "Produce one polished, executable plan document … — and nothing else. No code, no
> implementation, no half-built scaffolding."

> "**Delegate evidence, not voice.** Sub-agents gather; you write."

> "**Concise > comprehensive.** The plan should get *shorter* as it matures, not longer.
> Cut anything readers won't act on."

> "If you couldn't have asked the question without first looking at the code or current
> draft, it's probably a good question."

> "🚫 Letting Phase 7 polish make the plan *longer* than after Phase 4 — it should be tighter"

### Investigate (`WorkflowPrompt+Investigate.swift`)
Purpose: read-only root-cause investigation; orchestrate explorers + builder + oracle, then
synthesize an evidence-backed report (no source changes).

- Capability-role matrix (✅/⚠️/❌ per capability) to prevent wrong-tool use.
- Tool-vs-reasoning boundary ("the oracle is not a lookup tool; it can't produce reliable
  line numbers").
- Persistence balanced by a concrete "Stop when" clause requiring file:line evidence.
- Anti-duplication of in-flight sub-agent work.

> "**Don't stop until confident** — pursue every lead until evidence is solid."

> "**Bias toward inclusion** — better … to see a related file than miss one. Prune only
> files/codemaps that are clearly unrelated; when in doubt, keep them."

> "**Stop when**: root cause is identified with concrete file:line evidence, alternate
> hypotheses are ruled out with specific counter-evidence, and recommended fixes point at
> exact locations."

> "🚫 **Duplicating in-flight work** … Dispatch, then orchestrate."

### Review (`WorkflowPrompt+Review.swift`)
Purpose: structured code review with confirmed scope and a bounded output.

- Scope-confirmation gate with STOP-and-wait, but a shortcut when scope is already given.
- Mandatory builder step ("⚠️ Don't skip this step") instead of manual reading.
- Stateless-tool reminder (builder has no memory of previous runs).
- Hard output caps: max 15 bullets; Must-fix ≤5; Suggestions ≤5; Questions ≤3; each `[File:line]`.

> "Only ask for clarification if the scope is ambiguous or unspecified."
> "**If you need to ask, STOP and wait for user confirmation before proceeding.**"
> "🚫 Assuming the git diff alone is sufficient context for a thorough review"

### Refactor (`WorkflowPrompt+Refactor.swift`)
Purpose: plan + orchestrate behavior-preserving refactors.

- Behavior-preservation invariant, repeated.
- Sequential steering as the default (refactors compound) — contrasted with orchestrate's
  fresh-per-item default.
- Conservative parallelism: parallelize only on zero file overlap.

> "**Preserve behavior** unless something is broken."
> "Keep each explore prompt **short and focused** — one area per agent. Good: 'Map the auth
> module's types and interactions.' Bad: 'Find all refactoring opportunities in the codebase.'"
> "Only parallelize when items have **zero file overlap**. When in doubt, run sequentially."

### Optimize (`WorkflowPrompt+Optimize.swift`)
Purpose: measurement-driven performance loop until the oracle is satisfied or a cap fires.

- Measurement-first epistemology; one attributed change per loop iteration (causality).
- Single append-only "scoreboard" as shared truth; verify via scoreboard, not the diff.
- Externalized stop decision (the oracle is the stop signal); hard 5-iteration cap with
  mandatory user opt-in to continue.
- Noise-awareness: deltas inside the variance band are inconclusive.

> "Performance work only improves what you can measure, so the loop is always: **map → plan
> → instrument & baseline → optimize loop → decide**."
> "**One attributed change per loop iteration.** Causality is cheap to preserve and
> expensive to recover."
> "**The oracle is the stop signal.** You don't decide when to stop on gut feel."
> "🚫 Taking a single sample as a baseline — one number isn't a measurement, it's a guess"

### Oracle Export (`WorkflowPrompt+OracleExport.swift`)
Purpose: select files + export a ready-to-use prompt for another model.

- **De-inception:** strip meta-framing and extract the real task before acting.
- Intent classification with a default ("when in doubt, default to Plan").
- Trust-the-builder finality: after building, do not re-read/critique/rewrite.
- Hotword engineering: must include the literal phrase "code review" to activate diff analysis.

> "**Before you do anything else**, extract the real task from the raw request … strip away
> any meta-framing about exporting/prompting and identify the underlying problem."
> "Do not read the prompt back … do not critique, rewrite, or 'improve' the generated
> prompt text. Treat the builder's output as the final payload for export."

### Cross-cutting conventions (`WorkflowPromptSharedFragments.swift`, `…Variant.swift`)

- **Decomposition governor:** "Most tasks decompose into **2-3 items** — that's the sweet
  spot … If the task naturally decomposes into **1 item**, skip the orchestration overhead.
  Don't create ceremony for simple work."
- **Dispatch-brief philosophy:** "Your job is to orient them, not direct them." /
  "**Scope is your most important job.**" / "**Pass forward discoveries, not instructions.**"
  / "Include: the goal, relevant file paths/modules, and discoveries … Don't include:
  project conventions already in CLAUDE.md, step-by-step instructions, or code snippets the
  agent can read itself."
- **Parallel-dispatch sibling warning** (ready-made block agents must embed): "Another agent
  is concurrently working on … Avoid modifying files in that area. If you find yourself
  blocked … stop and report back rather than pushing through."
- **Two conversations, kept separate:** "You hold one conversation with the user … and a
  separate one with each peer agent … never forward their words verbatim … If a brief you
  already dispatched carried that kind of commentary, cancel it and re-send clean."
- **Monitor-and-verify:** "Don't just skim — confirm the goal was actually met. A quick
  `read_file` or `file_search` … costs little and catches drift before it compounds."
- **Tone, deliberately softened:** per the version changelog, hard "CRITICAL/DO NOT" tone was
  softened to measured guidance; **bold keywords and 🚫 anti-pattern lists carry the
  emphasis instead.** Emphasis markers are rationed to rules that actually break the task.
- **Variant abstraction:** prose written once; `.mcp`/`.cli`/`.agent` only vary surface syntax.
- **Prompts as maintained artifacts:** a `skillsVersion` (~61) with a per-version changelog
  documenting leanness passes, tone softening, and off-ramp closures.

---

## Part 2 — Personas & edit protocol (`personas/`)

### System personas (`SystemPromptService.swift`)
Each persona = a one-line identity + an explicit *what-not-to-do*.

- **Discover** (context scout, never implements):
  > "Your mission: **curate the perfect file selection** and **craft a precise prompt** for
  > the next model. Do not implement—focus entirely on context discovery and handoff."
- **Autonomous agent:**
  > "Make confident decisions, work in small, certain steps … **Autonomy:** Decide and act
  > without asking permission. **Precision:** Prefer small, certain steps over large,
  > uncertain ones."
- **Pair-programming conductor:** named core loop "Plan → Implement → Verify → Mend … Repeat
  this loop until done."
- Selection guardrails worth stealing:
  > "**Don't assume a solution:** Select context that enables different approaches, not just
  > your imagined solution."
  > "**Follow the dependency chain:** … Trace those references and include the dependencies —
  > the next model can't look them up."

### Agent-mode roles (`AgentModePrompts.swift`)
- **Engineer = role-as-constraint:** "Execute exactly what is asked, nothing more … no
  unrequested features, refactors, or improvements … Make targeted, minimal changes."
- **Explore = read-only, answer-first:** "Fast, concise, direct — front-load the most
  important findings. Answer the question asked, then stop."
- **Explore anti-patterns** name wasted reads explicitly: "Reading entire large files when a
  `file_search` or line-range `read_file` would suffice" / "Continuing to explore after you
  have enough to answer."
- **Progress-update doctrine:** "Before exploring … send a brief update that states your
  understanding and first step." / "Keep updates direct and factual: usually 1-2 sentences,
  no filler."
- **Trust-but-verify sub-agents:** "Treat its summary as a report of what it intended to do,
  not a trace of what it actually saw. Spot-check load-bearing claims … especially file:line
  references or 'X doesn't exist' findings."
- **Session-start ritual:** name the session via `set_status`; read root `AGENTS.md` if present.

### Edit protocol (`PromptFactory.swift` + `edit-formats/`)
- **Teach format by named negative example** — "Mismatched Search Block", "Ambiguous Search
  Block", etc., each with a "this fails because…" comment.
  > "The `<search>` block must match the source code exactly—down to indentation, braces,
  > spacing … Even a minor mismatch causes failed merges."
- **Anti-placeholder, shouted:** "DO NOT KEEP THE PLACEHOLDERS … OR THE USER WILL NOT BE
  ABLE TO COMPILE THEIR CODE."
- **End-alignment rule** prevents truncation deletes; **indentation encoding** (`<s4>`,
  `<t1>`) preserves whitespace in transport.
- **Format stays invisible:** "Never mention or explain the specific details of the format …
  it will be parsed and invisible to the user."
- **Boundary respect (fileEditor):** "NEVER modify code outside REPOMARK:SCOPE boundaries -
  not even to fix obvious bugs … TRUST THE ARCHITECT."

---

## Part 3 — MCP tool-description craft (`mcp/`)

- **Position custom tools against the model's built-ins:**
  > "file_search instead of Grep/Glob … read_file instead of cat/head (supports line-range
  > slicing) … apply_edits instead of Edit."
- **Repeatable schema template:** purpose → operations → params-by-op → inline JSON examples
  → `Related:` cross-reference line.
- **Name implicit defaults** so hidden behavior is visible: "Default includes:
  ['prompt','selection','code','tokens']."
- **When-to-use sentence per heavy tool**, with the exact arg that triggers each mode
  (`response_type="plan"|"review"|"question"`).

---

## Part 4 — Context assembly & token discipline (`context-assembly/`)

### The token-budget ladder (the most reusable single artifact)
> "**Priority: Full files > Slices > Codemaps. Complete files are the default.** Slicing is
> purely a budget optimization — only use it when approaching the token limit, not preemptively."

> "**HARD RULE: Full file + slice tokens MUST exceed codemap tokens.** If codemaps dominate
> your token budget, you've under-selected actual implementation."

- **Soft vs hard budgets behave differently** — soft biases to completeness ("Target 50–80k
  tokens; exceed if necessary"); hard biases to compliance ("You have FAILED the constraint …
  DO NOT halt until you're at or under budget").
- **Prune in fixed order:** irrelevant codemaps → convert large files to slices → re-verify.
- **Slices need a description** and must follow natural boundaries; preview before committing.
- **Mandatory pre-send verification gate:** count tokens before halting.

### Assembly conventions
- Fixed-order snake_case XML wrappers: `<file_map>` (tree **+** codemaps together) →
  `<file_contents>` → `<git_diff>` → meta prompts → `<user_instructions>`.
- Per-file `File: <path>` headers with language-aware fences; **sliced files annotated**
  `(lines 10-42: description)` so the model knows it's partial.
- **Instruction bookending:** optionally duplicate user instructions at the top *and* bottom
  of a large context dump to keep them salient.
- **Empty sections suppressed**; **git-diff de-duplicated** against file contents so a change
  isn't paid for twice.

### CodeMap format (`codemap-goldens/`)
Signatures-only API skeleton — no bodies, no comments. Structure: `File: → Imports: →
Classes/Methods/Properties → Interfaces → Type-aliases → Functions → Exports`, with `L#` line
markers. It's the compression lever that the budget ladder trades against. See
`swift_smoke.codemap.txt` / `ts_smoke.codemap.txt` for canonical examples.

---

## Highest-leverage borrowings for the Ged workflow

1. **Token-budget ladder** (full > slices > codemaps) + the "implementation must exceed
   codemap tokens" self-check — directly usable in any ged context-gathering step.
2. **Dispatch-brief philosophy** ("orient don't direct"; "pass forward discoveries, not
   instructions"; "scope is your #1 job") — for how the ged orchestrator briefs explorer/
   implementer subagents.
3. **Explicit "Stop when" clauses** with evidence requirements — for ged-explorer and
   ged-verifier.
4. **Anti-*over*-work framing + escape hatches** — counters ritual tool use under the ged
   pipeline.
5. **One-line identity + negative scope** per ged role.
6. **Two-conversations separation** — clean user↔orchestrator vs orchestrator↔subagent briefs.
7. **Tone discipline** — ration `CRITICAL`/🚫 to task-breaking rules; bold keywords carry the rest.
