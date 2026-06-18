import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { PositiveInt } from "../baseSchemas.ts";
import { ModelSelection, OrchestrationStageRole } from "../orchestration.ts";

/**
 * Minimal, **schema-only** HARD orchestrator config (Plan 018 WP-B; design
 * §7). This package carries no runtime logic — the pure resolution/merge
 * helpers (`ConfigResolver`, `deepMerge`) live in `@t3tools/shared/orchestrator`
 * and the enforcement lives in the server-side decider invariants (WP-E).
 *
 * **Config rides the existing `project.meta.update → project.meta-updated`
 * path** (design §14): there is intentionally **no new config event type**.
 * Likewise, **no PM tool maps to `project.meta.update`** (design §13, risk row
 * 3 / WP-G) — the LLM-driven PM therefore physically cannot edit this config,
 * so it cannot relax its own guardrails (flip a gate to `auto`, raise a worker
 * limit, or grant itself `full-access`). Only a human/client write path reaches
 * this object.
 *
 * Resolution order (enforced server-side, not here):
 *   per-task override > task-type > project > ServerSettings defaults > safe constant.
 * This file is the per-**project** layer; `OrchestratorGlobalDefaults`
 * (settings.ts) is the `ServerSettings` floor below it.
 */

/**
 * Per-gate policy for the slice's gates. `require-approval` means a
 * human/client-origin `task.gate.resolve` is required (the decider rejects
 * PM-runtime origin — WP-E); `auto` lets the engine resolve the gate without a
 * human. The `land` gate is hard-pinned to `require-approval` (design §7) — the
 * slice never auto-merges to main.
 */
export const OrchestratorGatePolicy = Schema.Literals(["auto", "require-approval"]);
export type OrchestratorGatePolicy = typeof OrchestratorGatePolicy.Type;

/**
 * Gate policy for a task type. The slice guards exactly two gates:
 * `plan` (default `require-approval`) and `land` (hard-pinned
 * `require-approval`). Both default to `require-approval` so a config that
 * omits them is safe-by-default.
 */
export const OrchestratorTaskGatePolicy = Schema.Struct({
  plan: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  land: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
});
export type OrchestratorTaskGatePolicy = typeof OrchestratorTaskGatePolicy.Type;

/**
 * One configurable task type. The slice ships a single type — `feature` —
 * whose stages reuse the existing closed `OrchestrationStageRole`
 * (`[classify, plan, work]`). Later phases extend the taxonomy (design §12,
 * Phase 4); the schema is already an array so that growth is additive.
 */
export const OrchestratorTaskType = Schema.Struct({
  id: Schema.Literal("feature"),
  stages: Schema.Array(OrchestrationStageRole).pipe(
    Schema.withDecodingDefault(
      Effect.succeed(["classify", "plan", "work"] as ReadonlyArray<OrchestrationStageRole>),
    ),
  ),
  gatePolicy: OrchestratorTaskGatePolicy.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type OrchestratorTaskType = typeof OrchestratorTaskType.Type;

export const DEFAULT_MAX_PARALLEL_WORKERS = 1;
export const DEFAULT_MAX_PARALLEL_TASKS = 1;
export const DEFAULT_MAX_STAGE_HANDOFFS = 8;

/**
 * Hard resource limits the decider enforces as invariants (design §7). These
 * are the fail-closed backstops a hallucinated or prompt-injected PM cannot
 * exceed, because the event-sourced engine is the only write path.
 *
 * `allowFullAccessWorkers` is the structural anchor for the runtime-mode clamp
 * (design §7, §13 risk row 4): it **defaults to `false`**, so worker stages can
 * never inherit the confirmed `DEFAULT_RUNTIME_MODE = "full-access"` hole unless
 * a human explicitly opts in. The provider command reactor resolves this flag
 * (the per-project value OR the global default) and feeds it to
 * `clampWorkerRuntimeMode` (`orchestration/workerSafety.ts`), which lowers a
 * `full-access` worker to `auto-accept-edits` whenever the flag is `false`; the
 * contracts invariant test pins the `false` default.
 */
export const OrchestratorResourceLimits = Schema.Struct({
  maxParallelTasks: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_PARALLEL_TASKS)),
  ),
  maxParallelWorkers: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_PARALLEL_WORKERS)),
  ),
  maxStageHandoffs: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_STAGE_HANDOFFS)),
  ),
  // Human-only opt-in. Defaults to `false` so the runtime-mode clamp (WP-E)
  // forbids `full-access` workers unless a human deliberately flips this.
  allowFullAccessWorkers: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type OrchestratorResourceLimits = typeof OrchestratorResourceLimits.Type;

/**
 * Per-project HARD orchestrator config (slice subset). Schema-only; persisted
 * on the project projection via `project.meta.update` (design §14).
 */
export const OrchestratorProjectConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // The PM brain's provider + model. Reuses the existing `ModelSelection`
  // schema (orchestration.ts) so the PM routes through the same provider
  // registry as every other model selection. The PM **API key** is resolved
  // later (WP-G) — it is intentionally NOT part of this config (017 delta #3):
  // no PM key → orchestrator mode is disabled for that project (fail-closed).
  pmModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  taskTypes: Schema.Array(OrchestratorTaskType).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([
        {
          id: "feature" as const,
          stages: ["classify", "plan", "work"] as ReadonlyArray<OrchestrationStageRole>,
          gatePolicy: { plan: "require-approval" as const, land: "require-approval" as const },
        },
      ]),
    ),
  ),
  resourceLimits: OrchestratorResourceLimits.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type OrchestratorProjectConfig = typeof OrchestratorProjectConfig.Type;

/**
 * Global orchestrator defaults nested on `ServerSettings` (design §7). This is
 * the **floor** of the resolution order: when a project (or task/task-type)
 * does not set a value, the resolver (WP-E, in `@t3tools/shared/orchestrator`)
 * falls through to here, and only then to the safe constants above.
 *
 * Like the per-project config, this is **schema-only** and reachable only by a
 * human/client write path — the PM has no tool that edits `ServerSettings`, so
 * it cannot move its own guardrail floor.
 *
 * Every field is optional/defaulted so existing on-disk `ServerSettings` (which
 * predate this key) decode unchanged and round-trip without the orchestrator
 * block — `ServerSettings` nests it with `withDecodingDefault(...{})`.
 */
export const OrchestratorGlobalDefaults = Schema.Struct({
  maxParallelTasks: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_PARALLEL_TASKS)),
  ),
  // Sizes the host-wide worker **start-admission** semaphore (WP-F,
  // `orchestration/Layers/WorkerStartAdmission`). That permit is held only for
  // the duration of `providerService.startSession`, so this bounds how many
  // worker stages may be *starting* concurrently — it smooths the startup/replay
  // thundering herd — and is NOT a cap on workers *running* concurrently (the
  // permit is released the moment a session has started, while the worker keeps
  // executing its turn). The running-worker ceiling is the pure decider, which a
  // prompt-injected PM cannot exceed: `maxParallelTasks` (active task worktrees)
  // plus the single-active-stage-per-task invariant, both enforced on every
  // command in `apps/server/src/orchestration/decider.ts`.
  maxParallelWorkers: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_PARALLEL_WORKERS)),
  ),
  maxStageHandoffs: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_STAGE_HANDOFFS)),
  ),
  // Floor for the runtime-mode clamp. Defaults to `false` so the safe default
  // holds even before a project sets its own `resourceLimits`.
  allowFullAccessWorkers: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type OrchestratorGlobalDefaults = typeof OrchestratorGlobalDefaults.Type;
