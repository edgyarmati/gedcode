import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { writeFileStringAtomically } from "../../atomicWrite.ts";
import { WorkspacePaths } from "../../workspace/Services/WorkspacePaths.ts";
import {
  CURRENT_GED_SCHEMA_VERSION,
  encodeGedManifest,
  GED_MANIFEST_PATH,
  inspectGedSchema,
  LEGACY_GED_VERSION_PATH,
  type GedSchemaInspection,
} from "../GedManifest.ts";
import {
  GedManifestError,
  GedManifestManager,
  type GedManifestManagerShape,
} from "../Services/GedManifest.ts";

const manifestError = (workspaceRoot: string, operation: string, error: unknown) =>
  new GedManifestError({
    workspaceRoot,
    operation,
    detail: error instanceof Error ? error.message : String(error),
  });

export const makeGedManifestManager = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;

  const readOptional = Effect.fn("GedManifestManager.readOptional")(function* (
    workspaceRoot: string,
    relativePath: string,
  ) {
    const resolved = yield* workspacePaths
      .resolveRelativePathWithinRoot({ workspaceRoot, relativePath })
      .pipe(Effect.mapError((error) => manifestError(workspaceRoot, "resolve", error)));
    const exists = yield* fs
      .exists(resolved.absolutePath)
      .pipe(Effect.mapError((error) => manifestError(workspaceRoot, "exists", error)));
    if (!exists) return { path: resolved.absolutePath, contents: null } as const;
    const info = yield* fs
      .stat(resolved.absolutePath)
      .pipe(Effect.mapError((error) => manifestError(workspaceRoot, "stat", error)));
    if (info.type !== "File") {
      return yield* manifestError(workspaceRoot, "stat", `${relativePath} is not a regular file`);
    }
    const contents = yield* fs
      .readFileString(resolved.absolutePath)
      .pipe(Effect.mapError((error) => manifestError(workspaceRoot, "read", error)));
    return { path: resolved.absolutePath, contents } as const;
  });

  const inspectFiles = Effect.fn("GedManifestManager.inspectFiles")(function* (
    requestedWorkspaceRoot: string,
  ) {
    const workspaceRoot = yield* workspacePaths
      .normalizeWorkspaceRoot(requestedWorkspaceRoot)
      .pipe(
        Effect.mapError((error) => manifestError(requestedWorkspaceRoot, "workspaceRoot", error)),
      );
    const manifest = yield* readOptional(workspaceRoot, GED_MANIFEST_PATH);
    const legacy = yield* readOptional(workspaceRoot, LEGACY_GED_VERSION_PATH);
    const inspection = yield* Effect.try({
      try: () =>
        inspectGedSchema({
          manifestContents: manifest.contents,
          legacyVersionContents: legacy.contents,
        }),
      catch: (error) => manifestError(workspaceRoot, "decode", error),
    });
    return { workspaceRoot, manifest, legacy, inspection } as const;
  });

  const inspect: GedManifestManagerShape["inspect"] = Effect.fn("GedManifestManager.inspect")(
    function* (workspaceRoot) {
      return (yield* inspectFiles(workspaceRoot)).inspection;
    },
  );

  const adoptLegacy: GedManifestManagerShape["adoptLegacy"] = Effect.fn(
    "GedManifestManager.adoptLegacy",
  )(function* (input) {
    const state = yield* inspectFiles(input.workspaceRoot);
    if (state.inspection.status === "newer") {
      return yield* manifestError(
        state.workspaceRoot,
        "adopt",
        `GED schema ${state.inspection.sourceSchemaVersion} is newer than supported schema ${CURRENT_GED_SCHEMA_VERSION}`,
      );
    }
    if (state.inspection.status === "outdated" || state.inspection.status === "missing") {
      return yield* manifestError(
        state.workspaceRoot,
        "adopt",
        `GED schema ${state.inspection.sourceSchemaVersion} requires context migration`,
      );
    }
    let result: GedSchemaInspection = state.inspection;
    if (state.inspection.status === "legacy") {
      const manifest = {
        schemaVersion: CURRENT_GED_SCHEMA_VERSION,
        updatedAt: input.now,
        lastReviewedAt: input.now,
        generatedBy: input.generatedBy.trim(),
      };
      yield* writeFileStringAtomically({
        filePath: state.manifest.path,
        contents: encodeGedManifest(manifest),
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError((error) => manifestError(state.workspaceRoot, "write", error)),
      );
      result = {
        status: "current",
        sourceSchemaVersion: CURRENT_GED_SCHEMA_VERSION,
        manifest,
      };
    }
    if (state.legacy.contents !== null) {
      yield* fs
        .remove(state.legacy.path)
        .pipe(
          Effect.mapError((error) => manifestError(state.workspaceRoot, "removeLegacy", error)),
        );
    }
    return result;
  });

  return GedManifestManager.of({ inspect, adoptLegacy });
});

export const GedManifestManagerLive = Layer.effect(GedManifestManager, makeGedManifestManager);
