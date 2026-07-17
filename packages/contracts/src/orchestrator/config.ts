import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { PositiveInt, TrimmedNonEmptyString } from "../baseSchemas.ts";
import {
  ModelSelection,
  ORCHESTRATION_CAPABILITY_TIERS,
  ORCHESTRATION_STAGE_ROLES,
  OrchestrationCapabilityTier,
  OrchestrationStageRole,
} from "../orchestration.ts";

const CAPABILITY_TIER_SET = new Set<string>(ORCHESTRATION_CAPABILITY_TIERS);

const CapabilityPresetSource = Schema.Record(Schema.String, ModelSelection);
const CompleteCapabilityPresetMap = Schema.Struct({
  cheap: ModelSelection,
  smart: ModelSelection,
  genius: ModelSelection,
});
const CapabilityPresetOverrideMap = Schema.Struct({
  cheap: Schema.optionalKey(ModelSelection),
  smart: Schema.optionalKey(ModelSelection),
  genius: Schema.optionalKey(ModelSelection),
});

const makeCapabilityPresetMap = <Target extends Schema.Top>(target: Target) => {
  return CapabilityPresetSource.pipe(
    Schema.decodeTo(
      target,
      SchemaTransformation.transformOrFail({
        decode: (value: Record<string, unknown>) => {
          const unknownKeys = Object.keys(value).filter((key) => !CAPABILITY_TIER_SET.has(key));
          if (unknownKeys.length > 0) {
            return Effect.fail(
              new SchemaIssue.InvalidValue(Option.some(unknownKeys.join(", ")), {
                message: `Unknown capability preset key(s): ${unknownKeys.join(", ")}`,
              }),
            );
          }
          return Effect.succeed(value as typeof target.Encoded);
        },
        encode: (value) => Effect.succeed(value as typeof CapabilityPresetSource.Type),
      }) as never,
    ),
  );
};

/** All three global presets are atomic: partial maps are invalid. */
export const OrchestratorCapabilityPresets = makeCapabilityPresetMap(CompleteCapabilityPresetMap);
export type OrchestratorCapabilityPresets = typeof OrchestratorCapabilityPresets.Type;

/** Projects may override any independent preset and inherit the rest globally. */
export const OrchestratorCapabilityPresetOverrides = makeCapabilityPresetMap(
  CapabilityPresetOverrideMap,
).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type OrchestratorCapabilityPresetOverrides =
  typeof OrchestratorCapabilityPresetOverrides.Type;

export const OrchestratorCapabilityTier = OrchestrationCapabilityTier;

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
 * human. Publishing gates are hard-pinned to `require-approval` (design §7) —
 * the slice never auto-merges to main or publishes a release.
 */
export const OrchestratorGatePolicy = Schema.Literals(["auto", "require-approval"]);
export type OrchestratorGatePolicy = typeof OrchestratorGatePolicy.Type;

export const OrchestratorLandGatePolicy = Schema.Literal("require-approval");
export type OrchestratorLandGatePolicy = typeof OrchestratorLandGatePolicy.Type;

/**
 * Gate policy for a task type. Plan approval may be automatic or human-gated;
 * publishing gates stay hard-pinned to human approval.
 */
export const OrchestratorTaskGatePolicy = Schema.Struct({
  plan: OrchestratorGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  land: OrchestratorLandGatePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("require-approval" as const)),
  ),
  release: Schema.optionalKey(OrchestratorLandGatePolicy),
});
export type OrchestratorTaskGatePolicy = typeof OrchestratorTaskGatePolicy.Type;

/**
 * One configurable task type. The schema preserves the branded task-type id;
 * the server-owned registry decides which ids are installed and rejects
 * unknown ids at command boundaries. Keeping registry policy out of contracts
 * lets new task types be added without weakening event replay.
 */
export const OrchestratorTaskType = Schema.Struct({
  id: TrimmedNonEmptyString,
  /**
   * The enabled worker-role set. Stage execution order remains PM-controlled;
   * landing separately requires fresh verification after the latest work.
   */
  stages: Schema.Array(OrchestrationStageRole).pipe(
    Schema.withDecodingDefault(Effect.succeed(ORCHESTRATION_STAGE_ROLES)),
  ),
  gatePolicy: OrchestratorTaskGatePolicy.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type OrchestratorTaskType = typeof OrchestratorTaskType.Type;

export const DEFAULT_MAX_PARALLEL_WORKERS = 2;
export const DEFAULT_MAX_PARALLEL_TASKS = 2;
export const DEFAULT_MAX_RETRIES_PER_STAGE = 2;
export const DEFAULT_PM_RECONCILIATION_INTERVAL_MS = 60 * 1000;
export const DEFAULT_WORKTREE_REAPER_INTERVAL_MINUTES = 15;

/**
 * Hard resource limits the decider enforces as invariants (design §7). These
 * are the fail-closed backstops a hallucinated or prompt-injected PM cannot
 * exceed, because the event-sourced engine is the only write path.
 */
export const OrchestratorResourceLimits = Schema.Struct({
  maxParallelTasks: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_PARALLEL_TASKS)),
  ),
  maxParallelWorkers: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_PARALLEL_WORKERS)),
  ),
  maxRetriesPerStage: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_RETRIES_PER_STAGE)),
  ),
});
export type OrchestratorResourceLimits = typeof OrchestratorResourceLimits.Type;

const decodeModelSelectionOption = Schema.decodeUnknownOption(ModelSelection);
const NullablePmModelSelectionWire = Schema.NullOr(ModelSelection);

/**
 * PM model selection is worker-native. Legacy persisted pi-era selections
 * (`{ piProvider, model }`) must stay replayable in the append-only event store,
 * but they no longer identify a valid provider-instance runtime source, so
 * decode them as an unconfigured PM (`null`) instead of failing the event.
 */
export const NullablePmModelSelection = Schema.Unknown.pipe(
  Schema.decodeTo(
    NullablePmModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        if (raw === null) {
          return Effect.succeed(null);
        }
        const decoded = decodeModelSelectionOption(raw);
        return Effect.succeed(
          Option.isSome(decoded)
            ? ({
                instanceId: decoded.value.instanceId,
                model: decoded.value.model,
                ...(decoded.value.options !== undefined ? { options: decoded.value.options } : {}),
              } as typeof NullablePmModelSelectionWire.Encoded)
            : null,
        );
      },
      encode: (value) =>
        Effect.succeed(
          value === null
            ? null
            : ({
                instanceId: value.instanceId,
                model: value.model,
                ...(value.options !== undefined ? { options: value.options } : {}),
              } as typeof NullablePmModelSelectionWire.Encoded),
        ),
    }),
  ),
);
export type NullablePmModelSelection = typeof NullablePmModelSelection.Type;

/**
 * Per-project HARD orchestrator config (slice subset). Schema-only; persisted
 * on the project projection via `project.meta.update` (design §14).
 */
export const OrchestratorProjectConfig = Schema.Struct({
  // Inheritable project-level landing default. The raw sparse project config can
  // omit this to inherit `OrchestratorGlobalDefaults.openPrAsDraft`; decode
  // defaults it for typed canonical config consumers.
  openPrAsDraft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  // The PM brain's provider instance + model. The provider instance owns
  // credentials/auth; this schema-only project config stores only the routing
  // selection the server resolves at runtime.
  pmModelSelection: NullablePmModelSelection.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  capabilityPresets: OrchestratorCapabilityPresetOverrides,
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
  maxRetriesPerStage: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_MAX_RETRIES_PER_STAGE)),
  ),
  pmReconciliationIntervalMs: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_PM_RECONCILIATION_INTERVAL_MS)),
  ),
  worktreeReaperIntervalMinutes: PositiveInt.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_WORKTREE_REAPER_INTERVAL_MINUTES)),
  ),
  // Landing opens ready PRs by default. Projects may explicitly override this
  // field in their raw sparse config; omitted project values inherit this
  // global floor before falling back to `false`.
  openPrAsDraft: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  pmModelSelection: NullablePmModelSelection.pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // Null is the persisted pre-migration state. Once configured, the map must
  // contain Cheap, Smart, and Genius as complete model selections.
  capabilityPresets: Schema.NullOr(OrchestratorCapabilityPresets).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  defaultWorkerModelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type OrchestratorGlobalDefaults = typeof OrchestratorGlobalDefaults.Type;
