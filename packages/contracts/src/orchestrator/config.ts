import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { PositiveInt } from "../baseSchemas.ts";
import { PiModelSelection } from "../piProvider.ts";
import {
  ModelSelection,
  ORCHESTRATION_STAGE_ROLES,
  OrchestrationStageRole,
} from "../orchestration.ts";

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
 * Per-gate policy for task gates. `require-approval` means a
 * human/client-origin `task.gate.resolve` is required (the decider rejects
 * PM-runtime origin — WP-E); `auto` lets the engine resolve the gate without a
 * human. The `land` gate is hard-pinned to `require-approval` (design §7) — the
 * slice never auto-merges to main.
 */
export const OrchestratorGatePolicy = Schema.Literals(["auto", "require-approval"]);
export type OrchestratorGatePolicy = typeof OrchestratorGatePolicy.Type;

export const OrchestratorLandGatePolicy = Schema.Literal("require-approval");
export type OrchestratorLandGatePolicy = typeof OrchestratorLandGatePolicy.Type;

/**
 * Gate policy for a task type. `classify`, `plan`, `work`, and `review` may be
 * `auto` or `require-approval`. `land` is hard-pinned to `require-approval`.
 * Every gate defaults to `require-approval` so a config that omits gate policy
 * is safe-by-default.
 */
export const OrchestratorTaskGatePolicy = Schema.Struct({
  classify: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  plan: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  work: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  review: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  land: OrchestratorLandGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
});
export type OrchestratorTaskGatePolicy = typeof OrchestratorTaskGatePolicy.Type;

/**
 * One configurable task type. The slice ships a single type — `feature` —
 * whose default stages use the full canonical pipeline. Per-type config may
 * opt out of optional stages such as `review` and `verify`.
 */
export const OrchestratorTaskType = Schema.Struct({
  id: Schema.Literal("feature"),
  /**
   * Locked invariant: the stage list follows canonical order
   * `classify → plan → [review] → work → [verify] → land`; `classify`/`plan`/
   * `work` are mandatory, `review` and `verify` are individually optional,
   * `land` is terminal. Reordering / free composition is out of scope.
   */
  stages: Schema.Array(OrchestrationStageRole).pipe(
    Schema.withDecodingDefault(Effect.succeed(ORCHESTRATION_STAGE_ROLES)),
  ),
  gatePolicy: OrchestratorTaskGatePolicy.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type OrchestratorTaskType = typeof OrchestratorTaskType.Type;

export const DEFAULT_MAX_PARALLEL_WORKERS = 1;
export const DEFAULT_MAX_PARALLEL_TASKS = 1;
export const DEFAULT_MAX_STAGE_HANDOFFS = 8;
export const DEFAULT_MAX_RETRIES_PER_STAGE = 2;
export const DEFAULT_PM_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_WORKTREE_REAPER_INTERVAL_MINUTES = 5;
export const DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_ENABLED = true;
// Mirrors @earendil-works/pi-agent-core DEFAULT_COMPACTION_SETTINGS.
// Contracts intentionally stays schema-only and does not depend on pi runtime packages.
export const DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_RESERVE_TOKENS = 16_384;
export const DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS = 20_000;

export const OrchestratorAutoCompactionDefaults = Schema.Struct({
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_ENABLED)),
  ),
  reserveTokens: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_RESERVE_TOKENS)),
  ),
  keepRecentTokens: PositiveInt.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS),
    ),
  ),
  customInstructions: Schema.optionalKey(Schema.String),
});
export type OrchestratorAutoCompactionDefaults = typeof OrchestratorAutoCompactionDefaults.Type;

/**
 * Hard resource limits the decider enforces as invariants (design §7). These
 * are the fail-closed backstops a hallucinated or prompt-injected PM cannot
 * exceed, because the event-sourced engine is the only write path.
 *
 * `allowFullAccessWorkers` is the structural anchor for the runtime-mode clamp
 * (design §7, §13 risk row 4): it **defaults to `false`**, so worker stages can
 * never inherit the confirmed `DEFAULT_RUNTIME_MODE = "full-access"` hole unless
 * a human explicitly opts in. The provider command reactor resolves this flag
 * (the per-project value, falling back to the global default) and feeds it to
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
  maxRetriesPerStage: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_RETRIES_PER_STAGE)),
  ),
  // Human-only opt-in. Defaults to `false` so the runtime-mode clamp (WP-E)
  // forbids `full-access` workers unless a human deliberately flips this.
  allowFullAccessWorkers: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type OrchestratorResourceLimits = typeof OrchestratorResourceLimits.Type;

const decodePiModelSelectionOption = Schema.decodeUnknownOption(PiModelSelection);
const NullablePiModelSelectionWire = Schema.NullOr(PiModelSelection);

/**
 * PM model selection is pi-native. Legacy persisted worker-shaped selections
 * (`{ instanceId, model, ... }`) must stay replayable in the append-only event
 * store, but they no longer identify a valid PM runtime credential source, so
 * decode them as an unconfigured PM (`null`) instead of failing the event.
 */
export const NullablePiModelSelection = Schema.Unknown.pipe(
  Schema.decodeTo(
    NullablePiModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        if (raw === null) {
          return Effect.succeed(null);
        }
        const decoded = decodePiModelSelectionOption(raw);
        return Effect.succeed(
          Option.isSome(decoded)
            ? ({
                piProvider: String(decoded.value.piProvider),
                model: decoded.value.model,
              } satisfies typeof NullablePiModelSelectionWire.Encoded)
            : null,
        );
      },
      encode: (value) => Effect.succeed(value),
    }),
  ),
);
export type NullablePiModelSelection = typeof NullablePiModelSelection.Type;

/**
 * Per-project HARD orchestrator config (slice subset). Schema-only; persisted
 * on the project projection via `project.meta.update` (design §14).
 */
export const OrchestratorProjectConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // Inheritable project-level landing default. The raw sparse project config can
  // omit this to inherit `OrchestratorGlobalDefaults.openPrAsDraft`; decode
  // defaults it for typed canonical config consumers.
  openPrAsDraft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // The PM brain's pi provider + model. The PM **credential** is resolved from
  // `ServerSettings.piProviders` (or pi-ai's env lookup) by the server runtime;
  // it is intentionally NOT part of this schema-only project config.
  pmModelSelection: NullablePiModelSelection.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  taskTypes: Schema.Array(OrchestratorTaskType).pipe(
    Schema.withDecodingDefault(
      Effect.succeed([
        {
          id: "feature" as const,
          stages: ORCHESTRATION_STAGE_ROLES,
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
  stages: Schema.Array(OrchestrationStageRole).pipe(
    Schema.withDecodingDefault(Effect.succeed(ORCHESTRATION_STAGE_ROLES)),
  ),
  gatePolicy: OrchestratorTaskGatePolicy.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
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
  maxRetriesPerStage: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_RETRIES_PER_STAGE)),
  ),
  pmReconciliationIntervalMs: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PM_RECONCILIATION_INTERVAL_MS)),
  ),
  worktreeReaperIntervalMinutes: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_WORKTREE_REAPER_INTERVAL_MINUTES)),
  ),
  autoCompaction: OrchestratorAutoCompactionDefaults.pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  // Floor for the runtime-mode clamp. Defaults to `false` so the safe default
  // holds even before a project sets its own `resourceLimits`.
  allowFullAccessWorkers: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // Landing opens ready PRs by default. Projects may explicitly override this
  // field in their raw sparse config; omitted project values inherit this
  // global floor before falling back to `false`.
  openPrAsDraft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  pmModelSelection: NullablePiModelSelection.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  defaultWorkerModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type OrchestratorGlobalDefaults = typeof OrchestratorGlobalDefaults.Type;
