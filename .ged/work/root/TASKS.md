# TASKS — Driver-based Orchestrator PM (replace pi)

De-risk-ordered WPs, **each leaving the full monorepo gate green**. Implementation via the user's Codex
CLI (the background companion stalls); Claude (me) = spec/review/gate/commit. One WP at a time, in-main-tree.

> **W1 first on purpose:** it proves the two unwired driver capabilities (MCP tool-injection + enforced
> read-only) before anything is built on top. Claude driver first (most flexible permission + in-process
> MCP via the Agent SDK), Codex parity in W5.

## WP-W1 — Claude driver: inject orchestration tools as in-process MCP + enforced read-only [HIGH, foundation]

- Add the ability to start a Claude driver session that (a) exposes the orchestration tools
  (`pi/pmTools.ts` set) to the model as an **in-process MCP server** (Claude Agent SDK
  `mcpServers`/`createSdkMcpServer`), and (b) runs **enforced read-only**: a new read-only `runtimeMode`
  mapping (plan-mode and/or disallow Write·Edit·Bash·write-MCP), while ALLOWING read/grep/find + the
  orchestration MCP tools. The model must be unable to edit/exec even if prompted to.
- Prove it with a focused test/harness: a read-only Claude session can call an orchestration tool and
  CANNOT write a file. Don't wire it into the PM runtime yet — just the driver capability + a test.
- Verify: full gate green. **This is the make-or-break; if the SDK can't do per-session MCP + read-only cleanly, STOP and report.**

## WP-W2 — DriverPmAdapter on the Claude session, wired into PmRuntime [HIGH]

- Implement `DriverPmAdapter` satisfying `PiAgentAdapterShape` (events, prompt, followUp, compact,
  setModel, setResources, waitForIdle, isIdle, abort) by driving the read-only Claude session from W1,
  bridging driver events → `AgentHarnessEvent` for `PmEventProjection`, routing the orchestration tool
  calls, and resuming the session (resumeCursor) per project. Reuse `PmReEntryQueue` + `PmEventProjection`.
- Wire it into `PmRuntime` behind the seam (replace `makePiAgentAdapter`), keeping the settlement re-entry
  + persistent-session behavior. Session store: reuse/adapt for the driver session id.
- Verify: integration — PM starts on a Claude instance, processes a message, drives a tool call; gate green.

## WP-W3 — PM provider/model selection = worker ModelSelection [medium]

- Replace `pmModelSelection` (pi `PiModelSelection`) with the worker `ModelSelection` ({instanceId, model})
  in project config + global defaults; resolver picks the PM's provider instance + model (project ?? global).
- Web: the PM model picker becomes the worker-style picker (the correct one); update the project + global editors.
- Lenient decode of any legacy pi `pmModelSelection` → null. Verify: gate green.

## WP-W4 — Surface PM turn failures + PM composer cleanup [medium]

- The DriverPmAdapter/PmEventProjection surfaces turn failures (quota/rate-limit/auth/error) as an error
  message/activity in the PM conversation (fixes the silent freeze, issue G).
- PM chat composer (`OrchestratorRoutes`) drops the inert chat controls; show the config-driven PM model
  (read-only) or nothing. Verify: gate (+ test:browser) green.

## WP-W5 — Codex driver parity [medium-HIGH]

- Same as W1/W2 for the Codex driver (ACP/CodexSessionRuntime): inject orchestration tools via MCP +
  enforced read-only sandbox, so the PM can run on a Codex instance too. Verify: gate green.

## WP-W6 — Remove pi [medium]

- Delete the pi PM runtime + pi-provider config: `PiAgentAdapter`, `PmModelResolver`, `PiProviderCatalog`,
  `PiOAuthLoginBroker`/`PiOAuthCredentialStore`/`PiOAuthProviders`, the pi `DenyingExecutionEnv` +
  `SqliteSessionStorage` (if fully superseded), `piProviders` settings + the pi settings section + pi
  picker + the catalog/models WS + the pi OAuth RPCs, and the `@earendil-works/pi-ai` + `pi-agent-core`
  deps (if nothing else uses them — check `pmTools` AgentTool type first). Keep `pmTools`/`PmEventProjection`/
  `PmReEntryQueue`. Verify: full gate green; no dangling pi references.

## Gates (every WP)

`bun fmt` · `bun lint` · `bun typecheck` (re-run standalone once if tsgo flakes — different package each run)
· `bun run test` (never `bun test`) · `bun run build`. `test:browser` for web-touching WPs (I run it).
CHANGELOG `## Unreleased` updated.
