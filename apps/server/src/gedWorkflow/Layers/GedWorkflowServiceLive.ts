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

const THREAD_CHECKPOINTS_RELATIVE_DIR = ".ged/runtime/root/threads";
const CHECKPOINTS_FILENAME = "checkpoints.json";
const TRUSTED_CHECKPOINTS_FILENAME = "checkpoints.trusted.json";

const decodeCheckpointStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const encodeCheckpointStateToJson = Schema.encodeEffect(Schema.fromJsonString(CheckpointState));

const INITIAL_CHECKPOINT_STATE: CheckpointStateValue = {
  schemaVersion: 3,
  lifecycleStatus: "active",
  classification: "trivial",
  classificationReason: "Awaiting first task classification",
  planCheckpoints: {},
  taskCheckpoints: {},
};

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
    cp.lifecycleStatus === "closed" || cp.lifecycleStatus === "verified" || verifierCheckpointValid
      ? "done"
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

  const getThreadCheckpointPaths = (projectRoot: string, threadId: string) => {
    const threadDir = path.join(
      projectRoot,
      THREAD_CHECKPOINTS_RELATIVE_DIR,
      encodeURIComponent(threadId),
    );
    return {
      checkpointsDir: threadDir,
      checkpointsPath: path.join(threadDir, CHECKPOINTS_FILENAME),
      trustedCheckpointsPath: path.join(threadDir, TRUSTED_CHECKPOINTS_FILENAME),
    };
  };

  const bootstrap: GedWorkflowServiceShape["bootstrap"] = (projectRoot) =>
    bootstrapGedDirectory(projectRoot).pipe(
      Effect.provide(
        Layer.mergeAll(Layer.succeed(FileSystem.FileSystem, fs), Layer.succeed(Path.Path, path)),
      ),
      Effect.catch(() => Effect.void),
    );

  const readCheckpointState = (projectRoot: string, threadId: string) =>
    Effect.gen(function* () {
      const { checkpointsPath } = getThreadCheckpointPaths(projectRoot, threadId);
      const raw = yield* fs.readFileString(checkpointsPath);
      return yield* decodeCheckpointStateFromJson(raw);
    });

  const writeCheckpointState = (
    projectRoot: string,
    threadId: string,
    state: CheckpointStateValue,
  ) =>
    Effect.gen(function* () {
      const { checkpointsDir, checkpointsPath, trustedCheckpointsPath } = getThreadCheckpointPaths(
        projectRoot,
        threadId,
      );
      const encoded = yield* encodeCheckpointStateToJson(state);
      yield* fs.makeDirectory(checkpointsDir, { recursive: true });
      yield* fs.writeFileString(checkpointsPath, encoded);
      yield* fs.writeFileString(trustedCheckpointsPath, encoded);
    });

  const ensureThreadCheckpointState = (projectRoot: string, threadId: string) =>
    Effect.gen(function* () {
      const { checkpointsPath } = getThreadCheckpointPaths(projectRoot, threadId);
      if (yield* fs.exists(checkpointsPath)) {
        return yield* readCheckpointState(projectRoot, threadId);
      }
      yield* writeCheckpointState(projectRoot, threadId, INITIAL_CHECKPOINT_STATE);
      return INITIAL_CHECKPOINT_STATE;
    });

  const getStateByThreadId: GedWorkflowServiceShape["getStateByThreadId"] = (threadId) =>
    Effect.sync(() => threadCwdMap.get(threadId)).pipe(
      Effect.flatMap((cwd) => (cwd ? getState(cwd, { threadId }) : getDefaultState)),
    );

  const classifyTurn: GedWorkflowServiceShape["classifyTurn"] = (projectRoot, userInput, context) =>
    Effect.gen(function* () {
      const threadId = context?.threadId;
      if (threadId === undefined) return;
      const cpState = yield* ensureThreadCheckpointState(projectRoot, threadId);
      const activeState =
        cpState.lifecycleStatus === "closed"
          ? ({
              ...cpState,
              lifecycleStatus: "active",
              classification: "trivial",
              classificationReason: "New turn on closed lifecycle - reset.",
              clarification: undefined,
              planCheckpoints: {},
              taskCheckpoints: {},
            } satisfies CheckpointStateValue)
          : cpState;

      if (cpState.lifecycleStatus === "closed") {
        yield* writeCheckpointState(projectRoot, threadId, activeState);
      }

      if (activeState.classification === "non-trivial") {
        yield* writeCheckpointState(projectRoot, threadId, activeState);
        return;
      }
      if (!isNonTrivialTurnInput(userInput)) return;

      yield* writeCheckpointState(projectRoot, threadId, {
        ...activeState,
        classification: "non-trivial",
        classificationReason: "Server-side heuristic: turn input matched non-trivial signals.",
      });
    }).pipe(Effect.catch(() => Effect.void));

  const getState: GedWorkflowServiceShape["getState"] = (projectRoot, context) =>
    isEnabled.pipe(
      Effect.flatMap((enabled) => {
        const threadId = context?.threadId;
        if (threadId === undefined) {
          return Effect.succeed({ ...DEFAULT_STATE, enabled });
        }
        return ensureThreadCheckpointState(projectRoot, threadId).pipe(
          Effect.map((state) => mapCheckpointStateToWorkflowState(state, enabled)),
          Effect.catch(() => Effect.succeed({ ...DEFAULT_STATE, enabled })),
        );
      }),
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

  const validateTurnGuards: GedWorkflowServiceShape["validateTurnGuards"] = (
    projectRoot,
    context,
  ) => {
    const threadId = context?.threadId;
    if (threadId === undefined) return Effect.succeed(VALID_RESULT);
    return ensureThreadCheckpointState(projectRoot, threadId).pipe(
      Effect.flatMap((cpState) => {
        if (cpState.lifecycleStatus === "closed") return Effect.succeed(VALID_RESULT);
        return Effect.succeed(validatePlannerCheckpoint(cpState));
      }),
      Effect.catch(() => Effect.succeed(VALID_RESULT)),
    );
  };

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
