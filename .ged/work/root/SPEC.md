# SPEC — Driver-based Orchestrator PM (replace pi)

## Goal

Replace the pi-based PM brain with a PM that runs on the existing **Codex/Claude drivers**, **read-only
(enforced)**, with the orchestration tools injected. Keep the event-sourced orchestration core (decider,
projector, tasks/stages/gates, real-PR landing, worker execution) and the worker provider-instance
system. Remove pi (pi-provider config PI1–PI6 + the pi PM runtime).

## Decisions (grill-me, settled)

1. **Read-only is HARNESS-ENFORCED** (Claude plan-mode / disallow Write·Edit·Bash; Codex read-only
   sandbox) PLUS the system prompt — not prompt-only.
2. **PM reuses the worker provider-instance system**: a Codex/Claude/OpenCode instance + model,
   per-project + global default — replaces pi `pmModelSelection` + the pi picker. The bottom-of-chat
   worker picker becomes the correct one.
3. **Persistent resumable driver session** per project (resume on each human message + each worker-stage
   settlement) — mirrors pi continuity. Reuse `PmReEntryQueue` + `PmEventProjection` + a session store.
4. **Full rewrite chosen** (2026-06-29) despite the cost, after the feasibility finding below.

## Feasibility (grounded — the two gaps the rewrite must build)

- Drivers: Claude (`provider/Layers/ClaudeAdapter.ts`) + Codex (`provider/acp/AcpSessionRuntime.ts` /
  `CodexSessionRuntime.ts`). Both support session resume (`resumeCursor`); model switching works (Claude).
- **GAP 1 — custom-tool injection NOT wired.** Orchestration tools (`pi/pmTools.ts`) are pi `AgentTool`s.
  Claude SDK manages tools internally (`canUseTool` only approves); Codex/ACP hardcodes `mcpServers: []`.
  Both CAN take MCP servers in principle → build orchestration-tool injection as an **in-process MCP server**.
- **GAP 2 — enforced read-only NOT wired.** Claude `runtimeMode` → only `acceptEdits`/`bypassPermissions`
  (no read-only); Codex no permission model wired. Build a **read-only mode per driver** + read tools.
- Reusable: `pmTools` (defs), `PmEventProjection`, `PmReEntryQueue`, the orchestration core, the worker
  provider system. The `PiAgentAdapterShape` is the seam a new `DriverPmAdapter` implements.
- **Biggest risk:** the MCP injection + enforced read-only behaving correctly on each driver SDK/protocol.
  → W1 proves it on Claude FIRST before building on top.

## Acceptance criteria

- The PM runs on a configured worker provider instance (Codex/Claude) + model, **read-only — cannot
  write/edit/exec (enforced)** — with the orchestration tools available + read/grep/find for comprehension.
- The PM drives the SAME orchestration (create tasks, hand off planner/worker/verifier on the configured
  per-stage models, gates, landing) via the orchestration tools.
- Persistent PM session resumes on human messages + worker settlements (continuity preserved).
- PM turn failures (quota/rate-limit/auth/errors) **surface in the PM conversation** (no silent freeze).
- The PM chat composer uses the config-driven PM model; no inert controls.
- pi is removed (config + runtime + deps); full monorepo gate green.

## Non-goals (v1)

- Codex-PM parity may trail Claude-PM (W5) — Claude-first to de-risk.
- No change to worker execution, the decider/projector, gates, or landing.

## WPs (de-risk ordered — see TASKS.md)

W1 driver MCP tool-injection + enforced read-only (Claude, foundation/risk) · W2 `DriverPmAdapter`
(PiAgentAdapterShape) on the Claude session, wired into PmRuntime · W3 PM provider/model = worker
ModelSelection (contracts + resolver + picker) · W4 surface PM turn errors + PM composer cleanup · W5
Codex driver parity · W6 remove pi (modules + config + deps).
