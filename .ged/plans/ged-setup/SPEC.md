# Ged in any project

## Problem

The Ged workflow only works in this repository. Nothing creates `.ged/` elsewhere, the lead and
grilling playbooks exist only as this repo's `.agents/skills`, the briefs hard-code this repo's `vp`
commands, and nothing tells an agent that Ged exists. Grilling settles intent and then loses it in
the chat. Model choice is a fixed role table the maintainer does not want.

## Decisions (2026-10-17, with the maintainer)

1. **Playbooks and role briefs are served by GedCode**, not written into projects. A `ged_playbook`
   tool returns `lead`, `grilling`, `verify`, `planner`, `implementer` or `verifier`. They are generic and
   versioned with the app; a project customises them only through its own `.ged/` files.
2. **Discovery** uses the MCP server's `instructions` plus `ged_playbook`'s description: when
   `.ged/` exists, grill non-trivial requests first, then lead with the playbook. This touches
   `McpHttpServer.ts`, already on the modified-upstream list. Antigravity gets no MCP from upstream
   and does not see Ged.
3. **Grilling records what it settles.** Once the user confirms that you both understand the request
   the same way, agreed terms go into `.ged/CONTEXT-MAP.md` and real decisions into
   `.ged/DECISIONS.md`.
4. **Model choice is autonomous and stays in the lead's own family.** An Opus lead picks among Claude
   models and a GPT lead among GPT models, by task. There is no role table and no routing code.
   `.ged/model-notes.md` records the user's stated preferences. The lead tries them first; if one is
   unavailable, it uses what it knows it can and says so in the thread. `roles/model-policy.md` is
   retired.
5. **Verification is the exception to staying in-family, and stays light.**
   - Default: one verifier from another installed vendor.
   - Only one vendor installed: one same-family verifier with a fresh context. The verdict records
     why.
   - Important change, or the only foreign option is a weak model: two verifiers in parallel, one
     strong same-family and one foreign. Both must pass. "Important" covers auth and security, data
     and migrations, public API, destructive operations, or the user saying so.
   - Verifiers get only the diff and the criteria, and run one round each. There are no committee
     or debate loops.
6. **Setup** is a single server method `GedSetup` behind three entry points: Project settings, the
   command palette, and an `ged_init` MCP tool. It previews the files it would add and never
   overwrites.

7. **Process scales to the work** (lead playbook). Typo/rename/small fix: the lead does it itself.
   One clear change: one implementer plus a verifier, and a question round only if the intent is
   unclear. Anything the lead cannot write criteria for in a few lines: grill, plan, implement,
   verify. **Every change that lands still needs a verdict**; for small work that is one quick
   foreign verifier. No docs-only exemption.

## Starter `.ged/`

`PROJECT.md`, `STANDARDS.md` (with a **Checks** section for this project's format, lint, typecheck and
test commands, which the served verify playbook reads), `DECISIONS.md`, `CONTEXT-MAP.md`,
`PROGRESS.md`, `model-notes.md`, `plans/INDEX.md`, `verdicts/.gitignore`, `bin/land-gate.sh`
(the same script this repo runs; its driver-kind list is GedCode's providers, not this repo's).

## Out of scope

Per-turn prompt injection, Antigravity MCP support, a GED mode toggle, cost accounting, and
migrating this repo's own `.ged/` beyond retiring `model-policy.md` and the duplicated
`ged-lead`/`grilling` skills.
