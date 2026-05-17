import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import {
  GED_DIRECTORY,
  GED_GITIGNORE,
  INITIAL_CHECKPOINT_STATE_JSON,
  TIER1_FILES,
  TIER2_FILES,
  TIER3_FILES,
} from "./GedMemoryTemplates.ts";

export const isGedInitialized = (
  projectRoot: string,
): Effect.Effect<boolean, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const versionPath = path.join(projectRoot, GED_DIRECTORY, "VERSION");
    return yield* fs.exists(versionPath);
  });

const writeIfMissing = (
  filePath: string,
  content: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(filePath);
    if (!exists) {
      yield* fs.writeFileString(filePath, content);
    }
  });

export const bootstrapGedDirectory = (
  projectRoot: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const gedRoot = path.join(projectRoot, GED_DIRECTORY);
    const workDir = path.join(gedRoot, "work", "root");
    const runtimeDir = path.join(gedRoot, "runtime", "root");

    yield* fs.makeDirectory(gedRoot, { recursive: true });
    yield* fs.makeDirectory(workDir, { recursive: true });
    yield* fs.makeDirectory(runtimeDir, { recursive: true });

    for (const file of TIER1_FILES) {
      yield* writeIfMissing(path.join(gedRoot, file.path), file.content);
    }
    yield* writeIfMissing(path.join(gedRoot, ".gitignore"), GED_GITIGNORE);

    for (const file of TIER2_FILES) {
      yield* writeIfMissing(path.join(workDir, file.path), file.content);
    }
    for (const file of TIER3_FILES) {
      yield* writeIfMissing(path.join(runtimeDir, file.path), file.content);
    }
    yield* writeIfMissing(path.join(runtimeDir, "checkpoints.json"), INITIAL_CHECKPOINT_STATE_JSON);
  });
