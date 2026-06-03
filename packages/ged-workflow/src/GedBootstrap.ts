import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import {
  DEFAULT_STANDARDS_CONTENT,
  GED_DIRECTORY,
  GED_GITIGNORE,
  INITIAL_CHECKPOINT_STATE_JSON,
  KNOWN_STANDARDS_FILES,
  TIER1_FILES,
  TIER2_FILES,
  TIER3_FILES,
} from "./GedMemoryTemplates.ts";
import { getBundledSkill, renderBundledSkillMarkdown } from "./SkillRegistry.ts";

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

export const installBundledGrillMeSkill = (
  projectRoot: string,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const grillMeSkill = getBundledSkill("grill-me");
    if (!grillMeSkill?.autoInstall) return;

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const skillDir = path.join(projectRoot, ".claude", "skills", grillMeSkill.name);

    yield* fs.makeDirectory(skillDir, { recursive: true });
    yield* writeIfMissing(
      path.join(skillDir, "SKILL.md"),
      renderBundledSkillMarkdown(grillMeSkill),
    );
  });

export const discoverStandards = (
  projectRoot: string,
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const results = yield* Effect.forEach(KNOWN_STANDARDS_FILES, (fileName) =>
      Effect.gen(function* () {
        const filePath = path.join(projectRoot, fileName);
        const found = yield* Effect.orElseSucceed(fs.exists(filePath), () => false);
        return found ? fileName : undefined;
      }),
    );

    return results.filter((f): f is string => f !== undefined);
  });

const formatStandardsContent = (discoveredFiles: ReadonlyArray<string>): string => {
  const header = "# Standards\n\n> Auto-discovered project standards.\n\n## Discovered Files\n";
  const entries = discoveredFiles.map((f) => `\n- [${f}](../${f})`).join("");
  return `${header}${entries}\n`;
};

export const populateStandards = (
  projectRoot: string,
  discoveredFiles: ReadonlyArray<string>,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (discoveredFiles.length === 0) {
      return;
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const standardsPath = path.join(projectRoot, GED_DIRECTORY, "STANDARDS.md");

    const exists = yield* fs.exists(standardsPath);
    if (exists) {
      const currentContent = yield* fs.readFileString(standardsPath);
      if (currentContent !== DEFAULT_STANDARDS_CONTENT) {
        return;
      }
    }

    yield* fs.writeFileString(standardsPath, formatStandardsContent(discoveredFiles));
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
    yield* installBundledGrillMeSkill(projectRoot);

    const discovered = yield* discoverStandards(projectRoot);
    yield* populateStandards(projectRoot, discovered);
  });
