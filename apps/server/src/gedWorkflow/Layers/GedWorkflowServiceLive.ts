/**
 * GedWorkflowServiceLive - Live implementation of GedWorkflowService.
 *
 * Delegates to `@t3tools/ged-workflow` for bootstrap, checkpoint state
 * reading, and workflow prompt generation. Provides Effect FileSystem and
 * Path services from the platform layer for filesystem operations.
 *
 * @module GedWorkflowServiceLive
 */
import type { GedWorkflowState } from "@t3tools/contracts";
import { bootstrapGedDirectory } from "@t3tools/ged-workflow";
import { CheckpointState } from "@t3tools/ged-workflow/CheckpointSchema";
import {
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
  type GedWorkflowServiceShape,
} from "../Services/GedWorkflowService.ts";

const CHECKPOINTS_RELATIVE_PATH = ".ged/runtime/root/checkpoints.json";

const decodeCheckpointStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(CheckpointState),
);

const encodeCheckpointStateToJson = Schema.encodeEffect(Schema.fromJsonString(CheckpointState));

const DEFAULT_STATE: GedWorkflowState = {
  initialized: false,
  phase: "inactive",
  classification: "unclassified",
  plannerCheckpointValid: false,
  verifierCheckpointValid: false,
};

const mapCheckpointStateToWorkflowState = (cp: typeof CheckpointState.Type): GedWorkflowState => {
  const plannerCp = cp.planCheckpoints["ged-planner"];
  const firstTaskCps = Object.values(cp.taskCheckpoints)[0];
  const verifierCp = firstTaskCps?.["ged-verifier"];

  return {
    initialized: true,
    phase: cp.lifecycleStatus === "closed" ? "inactive" : "implement",
    classification: cp.classification === "trivial" ? "trivial" : "non-trivial",
    plannerCheckpointValid: plannerCp?.valid ?? false,
    verifierCheckpointValid: verifierCp?.valid ?? false,
  };
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

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

  const writeCheckpointState = (projectRoot: string, state: typeof CheckpointState.Type) =>
    Effect.gen(function* () {
      const checkpointsPath = path.join(projectRoot, CHECKPOINTS_RELATIVE_PATH);
      const encoded = yield* encodeCheckpointStateToJson(state);
      yield* fs.writeFileString(checkpointsPath, encoded);
    });

  const classifyTurn: GedWorkflowServiceShape["classifyTurn"] = (projectRoot, userInput) =>
    Effect.gen(function* () {
      const cpState = yield* readCheckpointState(projectRoot);
      if (cpState.lifecycleStatus === "closed") return;
      if (cpState.classification === "non-trivial") return;

      const input = userInput.trim().toLowerCase();
      const nonTrivialSignals = [
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
      ];
      const isNonTrivial =
        input.length > 200 || nonTrivialSignals.some((signal) => input.includes(signal));

      if (!isNonTrivial) return;

      yield* writeCheckpointState(projectRoot, {
        ...cpState,
        classification: "non-trivial",
        classificationReason: "Server-side heuristic: turn input matched non-trivial signals.",
      });
    }).pipe(Effect.catch(() => Effect.void));

  const getState: GedWorkflowServiceShape["getState"] = (projectRoot) =>
    readCheckpointState(projectRoot).pipe(
      Effect.map(mapCheckpointStateToWorkflowState),
      Effect.catch(() => Effect.succeed(DEFAULT_STATE)),
    );

  const getWorkflowPromptSuffix: GedWorkflowServiceShape["getWorkflowPromptSuffix"] = () =>
    Effect.succeed(buildWorkflowPromptSuffix({ subagentsEnabled: true }));

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
    getWorkflowPromptSuffix,
    validateTurnGuards,
  } satisfies GedWorkflowServiceShape;
});

export const GedWorkflowServiceLive = Layer.effect(GedWorkflowService, make);
