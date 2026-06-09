# RepoPrompt CE — Prompt Staging Directory

Raw, faithfully-copied prompt source material extracted from
[`repoprompt/repoprompt-ce`](https://github.com/repoprompt/repoprompt-ce) for use as
**research input** — primarily to seed the prompts for the Ged-workflow subagents
(`ged-explorer`, `ged-planner`, `ged-verifier`, and the orchestrator).

> **Status:** staging dump for a downstream agent to work through. Nothing here is wired
> into gedcode. These are the *source of truth* Swift files (not paraphrases), so a
> downstream agent can render/port them without fidelity loss.

## Provenance & license

- **Source repo:** https://github.com/repoprompt/repoprompt-ce
- **Source commit:** see [`.source-commit`](./.source-commit) in this directory.
- **License:** Apache License 2.0. Porting the prompt wording into gedcode is permitted
  with attribution; preserve a NOTICE/credit when prompts are adapted into shipped code.
- **Stack note:** RepoPrompt CE is a native **macOS Swift** app. None of this code is
  reusable in gedcode (TypeScript/Effect). The **prompt text** is the asset; the Swift is
  just the carrier.

## Directory map

| Folder | What's in it | Relevance to Ged subagents |
|---|---|---|
| `workflows/` | The `rp-*` workflow prompts: orchestrate, deep-plan, investigate, review, refactor, optimize, oracle-export, reminder — plus the shared fragments, variant system, catalog, and ID/registry glue. | **Primary.** These are the orchestrator + role-driven workflows that map most directly onto the Ged pipeline. |
| `personas/` | System prompts (`SystemPromptService`), agent-mode role prompts (`AgentModePrompts`), and the XML edit-protocol factory (`PromptFactory`). | **Primary.** One-line identities + negative scope per role; explorer/engineer personas map onto ged-explorer/implementer. |
| `mcp/` | MCP `initialize` instructions and in-schema tool descriptions. | Secondary — useful if gedcode ever exposes tools to the model; great examples of tool-description craft. |
| `edit-formats/` | Legacy edit/diff prompt specs (whole-file, search/replace, selector diff, JSON diff, XML). | Secondary — reference for reliable edit-output formatting; gedcode delegates edits to Codex, so lower priority. |
| `context-assembly/` | How context is packaged/labeled/budgeted before send (XML wrappers, token accounting, git-diff de-dup). | Secondary — relevant only if gedcode later builds its own context bundles. |
| `codemap-goldens/` | Example CodeMap outputs (signatures-only API skeletons) across languages. | Reference — shows the compressed "codemap" format these prompts assume. |

## How these prompts are assembled (read before rendering)

The workflow prompts are **not** flat strings — they're composed at runtime. To render a
real prompt you must resolve three mechanisms:

1. **Variant** (`workflows/WorkflowPromptVariant.swift`) — every prompt renders in one of
   `.mcp`, `.cli`, or `.agent` flavors. The variant swaps tool names
   (`oracle_send`/`chat`/`ask_oracle`), toggles the `Phase 0: Workspace Verification`
   block (present for MCP/CLI, omitted for auto-mapped agents), and emits CLI-only
   reminders (`-w <window_id>`). The *prose is written once*; only surface syntax varies.
2. **Shared fragments** (`workflows/WorkflowPromptSharedFragments.swift`) — reusable blocks
   (decomposition governor, parallel-dispatch sibling warning, dispatch-brief philosophy,
   two-conversations rule, monitor-and-verify, final rollup, cleanup hints) are injected
   into multiple workflows. **Read this file first** — it carries most of the transferable
   craft.
3. **Frontmatter + `$ARGUMENTS`** (`workflows/RepoPromptWorkflowPrompts.swift`) — each
   prompt gets YAML frontmatter (`name`, `description`, version markers) and a
   `$ARGUMENTS` injection point near the top, followed by a one-line restatement of the
   single deliverable.

The actual prompt bodies live in the `WorkflowPrompt+<Name>.swift` files as large Swift
multiline string literals (`"""..."""`) with `\(interpolation)` for variant-specific
tokens. The interpolations are self-explanatory (`\(builderName)`, `\(chatLabel)`, etc.).

## Suggested entry points for the downstream agent

1. Read `ANALYSIS.md` (next to this file) — distilled prompting craft with verbatim quotes.
2. Read `workflows/WorkflowPromptSharedFragments.swift` — the reusable guardrails.
3. Read `workflows/WorkflowPrompt+Orchestrate.swift` and `+DeepPlan.swift` — closest analogs
   to the Ged orchestrator/planner.
4. Read `personas/AgentModePrompts.swift` (explore + engineer roles) and
   `personas/SystemPromptService.swift` (Discover/autonomous/pair personas).
5. Map findings against gedcode's existing `apps/server/src/gedWorkflow/GedRolePrompts.ts`.

## Not included (intentionally)

- RepoPrompt's own contributor tooling (`AGENTS.md`, `.agents/skills/*`) — those are *their*
  dev-process skills, not product prompts.
- Mechanical carriers with no prompt craft (`ACPPromptContentBuilder`,
  `ClaudeCodePromptDelivery`) — image-block/message plumbing only.
