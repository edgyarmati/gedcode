import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export class DesktopDataMigrationError extends Data.TaggedError("DesktopDataMigrationError")<{
  readonly source: string;
  readonly target: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `Failed to migrate desktop data from ${this.source} to ${this.target}.`;
  }
}

export type DesktopDataMigrationResult =
  | { readonly migrated: true; readonly source: string; readonly target: string }
  | {
      readonly migrated: false;
      readonly reason: "custom-base-dir" | "target-exists" | "source-missing";
    };

const pathExists = (path: string) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.exists(path)),
    Effect.orElseSucceed(() => false),
  );

/**
 * One-time migration for pre-GedCode app data. Fresh installs use `~/.gedcode`;
 * upgraded installs with default `~/.t3` data get a copy at the new location.
 * Explicit `T3CODE_HOME` values are left untouched because the user chose that
 * storage location deliberately.
 */
export const migrateDefaultAppDataDirectory = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  if (!environment.usesDefaultBaseDir) {
    return { migrated: false, reason: "custom-base-dir" } as const;
  }

  const targetExists = yield* pathExists(environment.baseDir);
  if (targetExists) {
    return { migrated: false, reason: "target-exists" } as const;
  }

  const sourceExists = yield* pathExists(environment.legacyDefaultBaseDir);
  if (!sourceExists) {
    return { migrated: false, reason: "source-missing" } as const;
  }

  yield* fileSystem.copy(environment.legacyDefaultBaseDir, environment.baseDir).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopDataMigrationError({
          source: environment.legacyDefaultBaseDir,
          target: environment.baseDir,
          cause,
        }),
    ),
  );

  return {
    migrated: true,
    source: environment.legacyDefaultBaseDir,
    target: environment.baseDir,
  } as const;
});

export const migrationResultLogFields = (result: DesktopDataMigrationResult) =>
  result.migrated
    ? Option.some({ source: result.source, target: result.target })
    : Option.none<Record<string, string>>();
