import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { STARTER_FILES } from "./starter/index.ts";

/**
 * Sets a project up for Ged by adding the starter `.ged/` files it lacks.
 *
 * Every entry point (Project settings, the command palette, `ged_init`) shows
 * the preview first and calls `apply` only on confirmation. Setup only ever
 * adds: a file that exists is left byte-for-byte alone, so running it on a
 * project already using Ged, or twice, changes nothing.
 */

export interface GedSetupPlan {
  /** Starter files this project lacks, relative to its root. */
  readonly missing: ReadonlyArray<string>;
  /** Starter files already present, which setup leaves untouched. */
  readonly present: ReadonlyArray<string>;
}

export interface GedSetupResult {
  readonly written: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}

export class GedSetupError extends Error {
  readonly _tag = "GedSetupError";
  constructor(message: string) {
    super(message);
    this.name = "GedSetupError";
  }
}

export class GedSetup extends Context.Service<
  GedSetup,
  {
    readonly preview: (root: string) => Effect.Effect<GedSetupPlan, GedSetupError>;
    readonly apply: (root: string) => Effect.Effect<GedSetupResult, GedSetupError>;
  }
>()("t3/ged/GedSetup") {}

const make = Effect.fn("GedSetup.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const requireDirectory = (root: string) =>
    fs.stat(root).pipe(
      Effect.orElseSucceed(() => undefined),
      Effect.flatMap((info) =>
        info?.type === "Directory"
          ? Effect.void
          : Effect.fail(new GedSetupError(`'${root}' is not a project directory.`)),
      ),
    );

  const preview = (root: string) =>
    Effect.gen(function* () {
      yield* requireDirectory(root);
      const checked = yield* Effect.forEach(STARTER_FILES, (file) =>
        fs.exists(path.join(root, file.path)).pipe(
          Effect.orElseSucceed(() => true),
          Effect.map((exists) => ({ path: file.path, exists })),
        ),
      );
      return {
        missing: checked.filter((file) => !file.exists).map((file) => file.path),
        present: checked.filter((file) => file.exists).map((file) => file.path),
      } satisfies GedSetupPlan;
    });

  // `wx` creates or fails, so a file that appears between the preview and the
  // write is skipped rather than overwritten.
  const writeIfAbsent = (root: string, file: (typeof STARTER_FILES)[number]) =>
    Effect.gen(function* () {
      const full = path.join(root, file.path);
      yield* fs
        .makeDirectory(path.dirname(full), { recursive: true })
        .pipe(
          Effect.mapError(() => new GedSetupError(`Could not create ${path.dirname(file.path)}.`)),
        );
      return yield* fs.writeFileString(full, file.content, { flag: "wx", mode: file.mode }).pipe(
        Effect.as(true),
        Effect.catchTag("PlatformError", (error) =>
          error.reason._tag === "AlreadyExists"
            ? Effect.succeed(false)
            : Effect.fail(new GedSetupError(`Could not write ${file.path}.`)),
        ),
      );
    });

  const apply = (root: string) =>
    Effect.gen(function* () {
      yield* requireDirectory(root);
      const outcomes = yield* Effect.forEach(STARTER_FILES, (file) =>
        writeIfAbsent(root, file).pipe(Effect.map((written) => ({ path: file.path, written }))),
      );
      return {
        written: outcomes.filter((file) => file.written).map((file) => file.path),
        skipped: outcomes.filter((file) => !file.written).map((file) => file.path),
      } satisfies GedSetupResult;
    });

  return { preview, apply } as const;
});

export const layer = Layer.effect(GedSetup, make());
