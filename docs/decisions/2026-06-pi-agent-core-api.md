# Decision Spike: `pi-agent-core` / `pi-ai` API verification (Plan 017)

> Superseded: GedCode no longer uses the legacy pi agent stack. The
> Orchestrator PM now runs on the Claude driver/native harness; this spike is
> retained only as historical context for the removed pi-era implementation.

- Status: accepted (verification spike — pins the dependency; no PM runtime built)
- Date: 2026-06-14
- Tracking: part of #32 (Epic: Orchestrator mode); gates plan 018
- Scope: confirm or refute, against the **real installed** packages, every API
  assumption the Orchestrator-mode design (`plans/orchestrator-mode-design.md`)
  depends on, before any contracts or services are written.
- Recommendation: **GO (with changes)** — proceed to plan 018 with the deltas in
  the "Divergences & impact on plan 018" section applied.

## Method

- Pinned `@earendil-works/pi-agent-core@0.79.3` and `@earendil-works/pi-ai@0.79.3`
  (exact, no caret) in `apps/server`.
- Read the published `.d.ts` for both packages (entry points + subpaths) and the
  package `exports`/`engines`/`type` metadata.
- Wrote a throwaway probe at `apps/server/src/orchestration/pi/__spike__/probe.ts`
  that statically imports every load-bearing symbol (runtime values + types) from
  both packages and the `/node` subpath, exercising each at the type level via
  `declare const` placeholders. **No network or LLM calls were made.**
- Ran the full repo toolchain gate with the probe present: `bun typecheck`
  (tsgo `--noEmit`, 13/13 packages), `bun run build` (3/3 tasks), `bun lint`
  (oxlint, exit 0 — only pre-existing repo warnings, zero referencing the probe).
- Deleted the probe (findings captured here).

Both packages are pure ESM (`"type": "module"`), `engines.node >= 22.19.0`
(Node 24.13.1 satisfies), TypeBox-based, ship complete `.d.ts`.

## Assumption verdicts

Evidence symbols are quoted from the installed `.d.ts` under
`apps/server/node_modules/@earendil-works/`.

| #   | Assumption                                                                                                      | Verdict                | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Agent constructed as `new AgentHarness({ env, session, model, tools, systemPrompt })` (or equivalent).          | **CONFIRMED**          | `agent-harness.d.ts`: `class AgentHarness { constructor(options: AgentHarnessOptions<…>) }`. `harness/types.d.ts` `AgentHarnessOptions` = `{ env: ExecutionEnv; session: Session; model: Model<any>; tools?; resources?; systemPrompt?; getApiKeyAndHeaders?; streamOptions?; thinkingLevel?; activeToolNames?; steeringMode?; followUpMode? }`. Single options object — matches the design's `PiAgentAdapter` lifecycle.                                                                                                                                                                                                                                                                                                                                                     |
| A2  | A **pluggable** `SessionStorage` interface exists with a small reimplementable method set.                      | **CONFIRMED**          | `harness/types.d.ts` `interface SessionStorage<TMetadata extends SessionMetadata>` with exactly: `getMetadata`, `getLeafId`, `setLeafId`, `createEntryId`, `appendEntry`, `getEntry`, `findEntries`, `getLabel`, `getPathToRoot`, `getEntries`. `Session` is `new Session(storage: SessionStorage)` and `AgentHarnessOptions.session` is injectable. Tree model is `parentId`/`leafId` over a discriminated `SessionTreeEntry` union (`message`, `compaction`, `branch_summary`, `label`, `leaf`, `model_change`, …). We can implement this over `NodeSqliteClient`.                                                                                                                                                                                                          |
| A3  | `prompt`/`followUp` phase semantics with an inspectable idle/busy state.                                        | **DIVERGES (soft)**    | There is **no public synchronous phase getter** — `AgentHarness.phase` is `private` and `AgentHarnessPhase = "idle" \| "turn" \| "compaction" \| "branch_summary" \| "retry"` is exported as a _type_ only. Idle/busy is observable instead via `waitForIdle(): Promise<void>` and the event stream (`SettledEvent {type:"settled"; nextTurnCount}`, `AgentEvent` `agent_start`/`agent_end`/`turn_start`/`turn_end`, `QueueUpdateEvent`). The harness also owns internal queues: `steer()`, `followUp()`, `nextTurn()` (each `=> Promise<void>`, with `QueueMode = "all" \| "one-at-a-time"`), while `prompt(text) => Promise<AssistantMessage>` resolves at turn end. Does **not** hit the STOP — idle/busy is reliably observable; the queue just isn't read from a getter. |
| A4  | `AgentTool.execute` may resolve **detached** (return a handle without awaiting the real-world effect).          | **CONFIRMED**          | `types.d.ts` `AgentTool.execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>` where `AgentToolResult = { content; details; terminate? }`. Nothing forces `execute` to await its effect — it can resolve immediately with an acknowledgement payload while the real handoff proceeds through gedcode's event log. `onUpdate` (an `AgentToolUpdateCallback`) is available but optional.                                                                                                                                                                                                                                                                                                                                                      |
| A5  | `subscribe()` yields a typed event stream (assistant deltas + tool activity) mappable to `OrchestrationEvent`s. | **CONFIRMED (richer)** | `subscribe(listener: (event: AgentHarnessEvent) => void \| Promise<void>) => () => void`. `AgentHarnessEvent = AgentEvent \| AgentHarnessOwnEvent`. `AgentEvent` carries streaming: `message_start` / `message_update {assistantMessageEvent}` / `message_end`, `tool_execution_start`/`update`/`end`, `turn_start`/`turn_end`. `AgentHarnessOwnEvent` adds `tool_call`, `tool_result`, `settled`, `queue_update`, `model_update`, `session_compact`, etc. More than enough to project to a `role='pm'` thread.                                                                                                                                                                                                                                                               |
| A6  | Skills load from `SKILL.md` via a documented loader / `setResources({ skills })`.                               | **CONFIRMED**          | `harness/skills.d.ts`: `loadSkills(env: ExecutionEnv, dirs: string \| string[]) => Promise<{ skills; diagnostics }>` and `loadSourcedSkills<TSource,TSkill>(env, inputs)`; `Skill` type + `formatSkillInvocation(skill, …)`. Resources are swapped at runtime via `AgentHarness.setResources(resources)` / constructor `resources?: AgentHarnessResources`, and invoked with `harness.skill(name, additionalInstructions?)`.                                                                                                                                                                                                                                                                                                                                                  |
| A7  | Context **compaction** is available (or we implement it) and invokable at idle.                                 | **CONFIRMED (richer)** | `AgentHarness.compact(customInstructions?) => Promise<{summary; firstKeptEntryId; tokensBefore; details?}>`. Standalone toolkit exported from `compaction`: `compact`, `shouldCompact`, `DEFAULT_COMPACTION_SETTINGS`, `estimateContextTokens`, `calculateContextTokens`, `getLastAssistantUsage`, `generateSummary`, `prepareCompaction`. Plus auto-compaction hook events (`session_before_compact`/`session_compact`) and branch summarization. We do not have to build this ourselves.                                                                                                                                                                                                                                                                                    |
| A8  | `pi-ai` exposes **per-turn token usage** + a model/provider selector for the PM brain.                          | **CONFIRMED (richer)** | `pi-ai/types.d.ts` `interface Usage { input; output; cacheRead; cacheWrite; totalTokens; cost: { input; output; cacheRead; cacheWrite; total } }`; `AssistantMessage.usage: Usage` and `prompt()` returns `AssistantMessage` — usage is available **per turn** with a cost breakdown (stronger than the assumed input/output/reasoning). `models.d.ts`: `getModel(provider, modelId)`, `getModels(provider)`, `getProviders()`, `calculateCost(model, usage)`. Credentials: `AgentHarnessOptions.getApiKeyAndHeaders?: (model) => Promise<{apiKey; headers?}\|undefined>`, plus `pi-ai` `getEnvApiKey(provider)` / `findEnvKeys(provider)`.                                                                                                                                   |
| A9  | Importing pi into `apps/server` does not break tsgo / build / lint.                                             | **CONFIRMED**          | With the probe importing both packages + the `/node` subpath present: `bun typecheck` 13/13 packages green; `bun run build` 3/3 tasks green; `bun lint` exit 0 (only pre-existing warnings, none referencing the probe). ESM + Node 24 + Effect + tsgo coexist cleanly. No CJS/ESM shim or worker boundary needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Divergences & impact on plan 018

Three items force concrete changes or additions to plan 018. None is a STOP.

1. **A3 — no synchronous phase getter (affects WP-G `PmReEntryQueue`).**
   The design assumed the re-entry queue could read an idle/busy getter to pick
   `prompt` vs `followUp`. Reality: `phase` is private. **Delta:** the
   `PiAgentAdapter` must maintain its own `idle/busy` flag, updated from the
   `subscribe` stream (`turn_start`/`agent_start` → busy, `settled`/`agent_end`
   → idle) and reconciled with `waitForIdle()`. The single-writer
   `PmReEntryQueue` reads that adapter-owned flag, not a harness getter. The
   harness's internal `followUp`/`steer`/`nextTurn` queues (`QueueMode`) are a
   correctness backstop — if we call `followUp` while busy, the harness buffers
   it; if we `prompt` while busy it will conflict, so the adapter flag governs.

2. \*\*PM `ExecutionEnv` must be a locked-down custom implementation (affects WP-G
   - the WP-E/WP-F guardrails).** `NodeExecutionEnv` (the `/node` subpath) is a
     full `ExecutionEnv extends FileSystem, Shell` — it can `exec()` arbitrary
     shell and write files. The PM brain must **only delegate**, never touch the
     repo. **Delta:** implement a `DenyingExecutionEnv: ExecutionEnv` whose
     `exec`/write/remove/`createTempFile` methods return the env's `Result` error
     variant (or throw), exposing only read-only metadata the PM legitimately
     needs. Do **not\*\* hand the PM a `NodeExecutionEnv`. This complements the
     existing hard guardrails (no PM tool maps to `project.meta.update` or
     `task.gate.resolve`; worker env-strip; push-block).

3. **PM brain needs its own LLM credentials, separate from worker CLI auth
   (affects WP-B config + WP-G).** The PM is a real `pi-ai` model call, so it
   needs `AgentHarnessOptions.model: Model<any>` (via `getModel(provider,
modelId)`) and `getApiKeyAndHeaders`. **Delta:** `OrchestratorProjectConfig` /
   `OrchestratorGlobalDefaults` must carry a **PM model selection** (provider +
   modelId) distinct from the per-role worker model selections, and the runtime
   must resolve a PM API key (via `getEnvApiKey(provider)` or explicit config)
   at adapter construction. If no PM key is configured, Orchestrator mode is
   disabled for that project (fail-closed; the existing
   `requireOrchestratorEnabled` guard covers the surface).

### Confirmations that _simplify_ plan 018 (no longer "build it ourselves")

- **Compaction (A7):** use `AgentHarness.compact()` + `shouldCompact` /
  `estimateContextTokens` directly. WP-G's "long-lived PM context economy" does
  not need a hand-rolled summarizer.
- **Usage/cost (A8):** `Usage` already includes a full cost breakdown and cache
  tokens. `ProjectionTaskSpend` can sum `AssistantMessage.usage` per turn and use
  `calculateCost` rather than reconstructing pricing. Token _and_ dollar budgets
  are both feasible from day one (turn-count caps remain the fail-closed default).
- **Events (A5):** projecting the PM thread can reuse the streaming
  `message_update`/`tool_execution_*` events; no polling needed.

## STOP conditions — none triggered

- A9 did not fail (no toolchain break; no isolation boundary needed).
- A2 did not diverge hard — `SessionStorage` is fully injectable.
- A3 diverged only softly — idle/busy is observable via events + `waitForIdle()`,
  so the single-writer re-entry queue remains viable.
- A8 is not absent — per-turn usage **and** cost are exposed.
- `0.79.3` is installed, not yanked; `engines.node >= 22.19.0` admits Node 24.

## Maintenance notes

- Pre-1.0 dependency pinned **exact** at `0.79.3`. Re-run this assumption table
  on every pi bump before upgrading; record divergences here.
- This doc is the contract plan 018's PM-runtime work builds against. If 018
  finds reality differs from a CONFIRMED row, fix this doc — do not silently work
  around it.
- Probe used during verification (now deleted):
  `apps/server/src/orchestration/pi/__spike__/probe.ts`.
