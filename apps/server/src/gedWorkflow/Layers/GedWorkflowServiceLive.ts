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

  const getState: GedWorkflowServiceShape["getState"] = (projectRoot) =>
    Effect.gen(function* () {
      const checkpointsPath = path.join(projectRoot, CHECKPOINTS_RELATIVE_PATH);
      const raw = yield* fs.readFileString(checkpointsPath);
      const cpState = yield* decodeCheckpointStateFromJson(raw);
      return mapCheckpointStateToWorkflowState(cpState);
    }).pipe(Effect.catch(() => Effect.succeed(DEFAULT_STATE)));

  const getWorkflowPromptSuffix: GedWorkflowServiceShape["getWorkflowPromptSuffix"] = () =>
    Effect.succeed(buildWorkflowPromptSuffix({ subagentsEnabled: true }));

  return {
    bootstrap,
    getState,
    getWorkflowPromptSuffix,
  } satisfies GedWorkflowServiceShape;
});

export const GedWorkflowServiceLive = Layer.effect(GedWorkflowService, make);
