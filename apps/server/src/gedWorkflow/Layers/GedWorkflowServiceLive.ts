/**
 * GedWorkflowServiceLive - Live implementation of GedWorkflowService.
 *
 * Delegates to `@t3tools/ged-workflow` for bootstrap, checkpoint state
 * reading, and workflow prompt generation. Provides Effect FileSystem and
 * Path services from the platform layer for filesystem operations.
 *
 * @module GedWorkflowServiceLive
 */
import type { CodexGedSubagentPreset, GedWorkflowState, ServerSettings } from "@t3tools/contracts";
import { formatCodexGedSubagentPreset } from "@t3tools/shared/gedSubagentPreset";
import { bootstrapGedDirectory } from "@t3tools/ged-workflow";
import {
  CheckpointState,
  type CheckpointState as CheckpointStateValue,
} from "@t3tools/ged-workflow/CheckpointSchema";
import {
  validateClarificationGate,
  validatePlannerCheckpoint,
  type ValidationResult,
} from "@t3tools/ged-workflow/CheckpointValidation";
import { buildWorkflowPromptSuffix } from "@t3tools/ged-workflow/WorkflowPrompt";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  GedWorkflowService,
  type GedWorkflowPromptContext,
  type GedWorkflowServiceShape,
} from "../Services/GedWorkflowService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const CHECKPOINTS_RELATIVE_PATH = ".ged/runtime/root/checkpoints.json";

const decodeCheckpointStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const encodeCheckpointStateToJson = Schema.encodeEffect(Schema.fromJsonString(CheckpointState));

const DEFAULT_STATE: GedWorkflowState = {
  enabled: true,
  initialized: false,
  phase: "inactive",
  classification: "unclassified",
  plannerCheckpointValid: false,
  verifierCheckpointValid: false,
};

const CODEX_PROVIDER = "codex";

const NON_TRIVIAL_SIGNALS = [
  "refactor",
  "implement",
  "feature",
  "build",
  "create",
  "add",
  "migrate",
  "redesign",
  "rewrite",
  "integrate",
  "multi",
  "across",
  "tests",
  "api",
  "endpoint",
  "replace",
  "swap",
  "change",
  "upgrade",
  "downgrade",
  "model",
  "provider",
  "dependency",
  "config",
  "wire",
  "support",
] as const;

const isNonTrivialTurnInput = (userInput: string): boolean => {
  const input = userInput.trim().toLowerCase();
  return input.length > 200 || NON_TRIVIAL_SIGNALS.some((signal) => input.includes(signal));
};

const readCodexGedSubagentPresetField = (
  config: unknown,
  field: string,
): CodexGedSubagentPreset | undefined => {
  if (config === null || typeof config !== "object") return undefined;
  const value = (config as Record<string, unknown>)[field];
  return value && typeof value === "object" ? (value as CodexGedSubagentPreset) : undefined;
};

const resolveCodexGedSubagentPreset = (
  current: ServerSettings,
  context?: GedWorkflowPromptContext,
): string | undefined => {
  if (context?.provider !== CODEX_PROVIDER) return undefined;

  const instance =
    context.providerInstanceId === undefined
      ? undefined
      : current.providerInstances[context.providerInstanceId];
  if (instance?.driver === CODEX_PROVIDER) {
    const instancePreset = readCodexGedSubagentPresetField(instance.config, "gedSubagentPreset");
    if (instancePreset) return formatCodexGedSubagentPreset(instancePreset);
  }

  return formatCodexGedSubagentPreset(current.providers.codex.gedSubagentPreset);
};

const mapCheckpointStateToWorkflowState = (
  cp: CheckpointStateValue,
  enabled: boolean,
): GedWorkflowState => {
  const plannerCp = cp.planCheckpoints["ged-planner"];
  const firstTaskCps = Object.values(cp.taskCheckpoints)[0];
  const verifierCp = firstTaskCps?.["ged-verifier"];
  const plannerCheckpointValid = plannerCp?.valid ?? false;
  const verifierCheckpointValid = verifierCp?.valid ?? false;
  const clarificationValid = validateClarificationGate(cp).valid;

  const phase: GedWorkflowState["phase"] =
    cp.lifecycleStatus === "closed"
      ? "done"
      : cp.lifecycleStatus === "verified" || verifierCheckpointValid
        ? "verify"
        : cp.classification === "trivial"
          ? "classify"
          : !clarificationValid
            ? "clarify"
            : !plannerCheckpointValid
              ? "plan"
              : "implement";

  return {
    enabled,
    initialized: true,
    phase,
    classification: cp.classification === "trivial" ? "trivial" : "non-trivial",
    plannerCheckpointValid,
    verifierCheckpointValid,
  };
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const settings = yield* ServerSettingsService;

  const threadCwdMap = new Map<string, string>();

  const isEnabled: GedWorkflowServiceShape["isEnabled"] = settings.getSettings.pipe(
    Effect.map((current) => current.gedWorkflowEnabled),
    Effect.catch(() => Effect.succeed(true)),
  );

  const getDefaultState = isEnabled.pipe(
    Effect.map((enabled) => ({
      ...DEFAULT_STATE,
      enabled,
    })),
  );

  const recordThreadCwd: GedWorkflowServiceShape["recordThreadCwd"] = (threadId, cwd) =>
    Effect.sync(() => {
      threadCwdMap.set(threadId, cwd);
    });

  const getStateByThreadId: GedWorkflowServiceShape["getStateByThreadId"] = (threadId) =>
    Effect.sync(() => threadCwdMap.get(threadId)).pipe(
      Effect.flatMap((cwd) => (cwd ? getState(cwd) : getDefaultState)),
    );

  const bootstrap: GedWorkflowServiceShape["bootstrap"] = (projectRoot) =>
    bootstrapGedDirectory(projectRoot).pipe(
      Effect.provide(
        Layer.mergeAll(Layer.succeed(FileSystem.FileSystem, fs), Layer.succeed(Path.Path, path)),
      ),
      Effect.catch(() => Effect.void),
    );

  const readCheckpointState = (projectRoot: string) =>
    Effect.gen(function* () {
      const checkpointsPath = path.join(projectRoot, CHECKPOINTS_RELATIVE_PATH);
      const raw = yield* fs.readFileString(checkpointsPath);
      return yield* decodeCheckpointStateFromJson(raw);
    });

  const writeCheckpointState = (projectRoot: string, state: CheckpointStateValue) =>
    Effect.gen(function* () {
      const checkpointsPath = path.join(projectRoot, CHECKPOINTS_RELATIVE_PATH);
      const encoded = yield* encodeCheckpointStateToJson(state);
      yield* fs.writeFileString(checkpointsPath, encoded);
    });

  const classifyTurn: GedWorkflowServiceShape["classifyTurn"] = (projectRoot, userInput) =>
    Effect.gen(function* () {
      const cpState = yield* readCheckpointState(projectRoot);
      const activeState =
        cpState.lifecycleStatus === "closed"
          ? ({
              ...cpState,
              lifecycleStatus: "active",
              classification: "trivial",
              classificationReason: "New turn on closed lifecycle — reset.",
              planCheckpoints: {},
              taskCheckpoints: {},
            } satisfies CheckpointStateValue)
          : cpState;

      if (cpState.lifecycleStatus === "closed") {
        yield* writeCheckpointState(projectRoot, activeState);
      }

      if (activeState.classification === "non-trivial") return;
      if (!isNonTrivialTurnInput(userInput)) return;

      yield* writeCheckpointState(projectRoot, {
        ...activeState,
        classification: "non-trivial",
        classificationReason: "Server-side heuristic: turn input matched non-trivial signals.",
      });
    }).pipe(Effect.catch(() => Effect.void));

  const getState: GedWorkflowServiceShape["getState"] = (projectRoot) =>
    isEnabled.pipe(
      Effect.flatMap((enabled) =>
        readCheckpointState(projectRoot).pipe(
          Effect.map((state) => mapCheckpointStateToWorkflowState(state, enabled)),
          Effect.catch(() => Effect.succeed({ ...DEFAULT_STATE, enabled })),
        ),
      ),
    );

  const getWorkflowPromptSuffix: GedWorkflowServiceShape["getWorkflowPromptSuffix"] = (context) =>
    settings.getSettings.pipe(
      Effect.map((current) =>
        buildWorkflowPromptSuffix({
          codexGedSubagentPreset: resolveCodexGedSubagentPreset(current, context),
          provider: context?.provider,
          subagentsEnabled: current.gedSubagentsEnabled,
        }),
      ),
      Effect.catch(() =>
        Effect.succeed(
          buildWorkflowPromptSuffix({
            provider: context?.provider,
            subagentsEnabled: true,
          }),
        ),
      ),
    );

  const VALID_RESULT: ValidationResult = { valid: true };

  const validateTurnGuards: GedWorkflowServiceShape["validateTurnGuards"] = (projectRoot) =>
    readCheckpointState(projectRoot).pipe(
      Effect.flatMap((cpState) => {
        if (cpState.lifecycleStatus === "closed") return Effect.succeed(VALID_RESULT);
        return Effect.succeed(validatePlannerCheckpoint(cpState));
      }),
      Effect.catch(() => Effect.succeed(VALID_RESULT)),
    );

  return {
    bootstrap,
    classifyTurn,
    getState,
    getStateByThreadId,
    getWorkflowPromptSuffix,
    isEnabled,
    recordThreadCwd,
    validateTurnGuards,
  } satisfies GedWorkflowServiceShape;
});

export const GedWorkflowServiceLive = Layer.effect(GedWorkflowService, make);
