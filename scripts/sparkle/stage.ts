import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/process";

import type { BuildArch, BuildPlatform } from "../lib/build-target-arch.ts";

export class SparkleStageError extends Schema.TaggedError<SparkleStageError>()(
  "SparkleStageError",
  { missingPath: Schema.String },
) {
  override get message(): string {
    return `electron-sparkle-updater rebuild did not produce ${this.missingPath}`;
  }
}

export interface StageSparkleOptions<E, R> {
  readonly stageAppDir: string;
  readonly platform: BuildPlatform;
  readonly arch: BuildArch;
  readonly electronVersion: string;
  /** The build's own command runner, so a failed rebuild is reported like
      every other failed packaging step. */
  readonly run: (command: ChildProcess.Command, label: string) => Effect.Effect<void, E, R>;
}

/** The staged install skips native build scripts, so extract Sparkle.framework
    and compile the bridge against the packaged Electron version. Fail the build
    if either is missing; otherwise the first update check would fail. */
export const stageSparkle = Effect.fn("stageSparkle")(function* <E, R>(
  options: StageSparkleOptions<E, R>,
) {
  if (options.platform !== "mac") return;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const packageDir = yield* fs.realPath(
    path.join(options.stageAppDir, "node_modules", "electron-sparkle-updater"),
  );
  yield* options.run(
    ChildProcess.make(
      "node",
      [
        path.join(packageDir, "bin", "electron-sparkle-updater.js"),
        "rebuild",
        "--electron-version",
        options.electronVersion,
        "--arch",
        options.arch,
      ],
      { cwd: packageDir },
    ),
    "electron-sparkle-updater rebuild",
  );

  for (const required of [
    "native/vendor/Sparkle.framework",
    "native/build/Release/sparkle_bridge.node",
  ]) {
    if (!(yield* fs.exists(path.join(packageDir, required)))) {
      return yield* new SparkleStageError({ missingPath: required });
    }
  }
});
