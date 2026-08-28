import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, CliError } from "effect/unstable/cli";
import * as TestConsole from "effect/testing/TestConsole";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";

import {
  releasePackageFiles,
  updateReleasePackageVersions,
  updateReleasePackageVersionsCommand,
} from "./update-release-package-versions.ts";

const ScriptTestLayer = Layer.mergeAll(NodeServices.layer, TestConsole.layer);
const runCli = Command.runWith(updateReleasePackageVersionsCommand, { version: "0.0.0" });
const PackageJsonSchema = Schema.Record(Schema.String, Schema.Unknown);
const PackageJsonPrettyJson = fromJsonStringPretty(PackageJsonSchema);
const decodePackageJson = Schema.decodeEffect(PackageJsonPrettyJson);
const encodePackageJson = Schema.encodeEffect(PackageJsonPrettyJson);
const BunLockSchema = Schema.Struct({
  lockfileVersion: Schema.Number,
  workspaces: Schema.Record(
    Schema.String,
    Schema.Struct({
      name: Schema.String,
      version: Schema.optional(Schema.String),
    }),
  ),
});
const BunLockPrettyJson = fromJsonStringPretty(BunLockSchema);
const decodeBunLock = Schema.decodeEffect(BunLockPrettyJson);
const encodeBunLock = Schema.encodeEffect(BunLockPrettyJson);

const writePackageJsonFixtures = Effect.fn("writePackageJsonFixtures")(function* (
  rootDir: string,
  version: string,
  lockVersion = version,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const relativePath of releasePackageFiles) {
    const filePath = path.join(rootDir, relativePath);
    yield* fs.makeDirectory(path.dirname(filePath), { recursive: true });
    yield* fs.writeFileString(
      filePath,
      `${yield* encodePackageJson({
        name: relativePath,
        version,
        private: true,
      })}\n`,
    );
  }

  yield* fs.writeFileString(
    path.join(rootDir, "bun.lock"),
    `${yield* encodeBunLock({
      lockfileVersion: 1,
      workspaces: Object.fromEntries(
        releasePackageFiles.map((relativePath) => [
          path.dirname(relativePath),
          { name: relativePath, version: lockVersion },
        ]),
      ),
    })}\n`,
  );
});

const readReleaseVersions = Effect.fn("readReleaseVersions")(function* (rootDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const versions = new Map<string, string>();

  for (const relativePath of releasePackageFiles) {
    const filePath = path.join(rootDir, relativePath);
    const packageJson = yield* fs.readFileString(filePath).pipe(Effect.flatMap(decodePackageJson));
    versions.set(relativePath, String(packageJson.version));
  }

  return versions;
});

const captureLogs = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const result = yield* effect;
    const logs = (yield* TestConsole.logLines).filter(
      (line): line is string => typeof line === "string",
    );
    return { result, logs };
  });

const readLockVersions = Effect.fn("readLockVersions")(function* (rootDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* fs
    .readFileString(path.join(rootDir, "bun.lock"))
    .pipe(Effect.flatMap(decodeBunLock));
  return new Map(
    releasePackageFiles.map((relativePath) => {
      const workspace = path.dirname(relativePath);
      return [workspace, lock.workspaces[workspace]?.version] as const;
    }),
  );
});

it.layer(ScriptTestLayer)("update-release-package-versions", (it) => {
  it.effect("updates all release package versions under the provided root", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-",
      });

      yield* writePackageJsonFixtures(baseDir, "0.0.1");

      const result = yield* updateReleasePackageVersions("1.2.3", { rootDir: baseDir });
      const versions = yield* readReleaseVersions(baseDir);
      const lockVersions = yield* readLockVersions(baseDir);

      assert.deepStrictEqual(result, { changed: true });
      assert.deepStrictEqual(
        Array.from(versions.entries()),
        releasePackageFiles.map((relativePath) => [relativePath, "1.2.3"]),
      );
      assert.deepStrictEqual(new Set(lockVersions.values()), new Set(["1.2.3"]));
    }),
  );

  it.effect("returns changed=false when all versions already match", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-unchanged-",
      });

      yield* writePackageJsonFixtures(baseDir, "1.2.3");

      const result = yield* updateReleasePackageVersions("1.2.3", { rootDir: baseDir });

      assert.deepStrictEqual(result, { changed: false });
    }),
  );

  it.effect("repairs stale Bun workspace metadata when package versions already match", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-stale-lock-",
      });

      yield* writePackageJsonFixtures(baseDir, "1.2.3", "1.2.2");

      const result = yield* updateReleasePackageVersions("1.2.3", { rootDir: baseDir });
      const lockVersions = yield* readLockVersions(baseDir);

      assert.deepStrictEqual(result, { changed: true });
      assert.deepStrictEqual(new Set(lockVersions.values()), new Set(["1.2.3"]));
    }),
  );

  it.effect("preserves a newer version during delayed release finalization", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-newer-",
      });

      yield* writePackageJsonFixtures(baseDir, "2.0.0");

      const result = yield* updateReleasePackageVersions("1.9.0", {
        rootDir: baseDir,
        preserveNewer: true,
      });
      const versions = yield* readReleaseVersions(baseDir);
      const lockVersions = yield* readLockVersions(baseDir);

      assert.deepStrictEqual(result, { changed: false });
      assert.deepStrictEqual(new Set(versions.values()), new Set(["2.0.0"]));
      assert.deepStrictEqual(new Set(lockVersions.values()), new Set(["2.0.0"]));
    }),
  );

  it.effect("repairs stale lock metadata to a preserved newer version", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-newer-stale-lock-",
      });

      yield* writePackageJsonFixtures(baseDir, "2.0.0", "1.9.0");

      const result = yield* updateReleasePackageVersions("1.9.0", {
        rootDir: baseDir,
        preserveNewer: true,
      });
      const versions = yield* readReleaseVersions(baseDir);
      const lockVersions = yield* readLockVersions(baseDir);

      assert.deepStrictEqual(result, { changed: true });
      assert.deepStrictEqual(new Set(versions.values()), new Set(["2.0.0"]));
      assert.deepStrictEqual(new Set(lockVersions.values()), new Set(["2.0.0"]));
    }),
  );

  it.effect("accepts flags before the version positional and appends changed output", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-cli-",
      });
      const githubOutputPath = path.join(baseDir, "github-output.txt");

      yield* writePackageJsonFixtures(baseDir, "0.0.1");

      yield* runCli(["--github-output", "--root", baseDir, "2.0.0"]).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                GITHUB_OUTPUT: githubOutputPath,
              },
            }),
          ),
        ),
      );

      const githubOutput = yield* fs.readFileString(githubOutputPath);
      assert.equal(githubOutput, "changed=true\n");
    }),
  );

  it.effect("logs when nothing changed", () =>
    captureLogs(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const baseDir = yield* fs.makeTempDirectoryScoped({
          prefix: "update-release-package-versions-cli-log-",
        });

        yield* writePackageJsonFixtures(baseDir, "3.0.0");
        yield* runCli(["3.0.0", "--root", baseDir]);
      }),
    ).pipe(
      Effect.tap(({ logs }) => {
        assert.deepStrictEqual(logs, ["All package.json versions already match release version."]);
        return Effect.void;
      }),
    ),
  );

  it.effect("requires GITHUB_OUTPUT when --github-output is set", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const baseDir = yield* fs.makeTempDirectoryScoped({
        prefix: "update-release-package-versions-cli-missing-output-",
      });

      yield* writePackageJsonFixtures(baseDir, "0.0.1");

      const error = yield* runCli(["4.0.0", "--root", baseDir, "--github-output"]).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} }))),
        Effect.flip,
      );

      assert.equal(
        error.message,
        'SchemaError(Expected string, got undefined\n  at ["GITHUB_OUTPUT"])',
      );
    }),
  );

  it.effect("rejects unknown flags during cli parsing", () =>
    Effect.gen(function* () {
      const error = yield* runCli(["1.2.3", "--unknown"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }

      const optionError =
        error._tag === "ShowHelp" ? (error.errors[0] as CliError.CliError | undefined) : error;

      if (!optionError || optionError._tag !== "UnrecognizedOption") {
        assert.fail(`Expected UnrecognizedOption, got ${String(optionError?._tag)}`);
      }

      assert.equal(optionError.option, "--unknown");
    }),
  );

  it.effect("rejects a missing version positional during cli parsing", () =>
    Effect.gen(function* () {
      const error = yield* runCli(["--github-output"]).pipe(Effect.flip);

      if (!CliError.isCliError(error)) {
        assert.fail(`Expected CliError, got ${String(error)}`);
      }

      const versionError =
        error._tag === "ShowHelp" ? (error.errors[0] as CliError.CliError | undefined) : error;

      if (!versionError || versionError._tag !== "MissingArgument") {
        assert.fail(`Expected MissingArgument, got ${String(versionError?._tag)}`);
      }

      assert.equal(versionError.argument, "version");
    }),
  );
});
