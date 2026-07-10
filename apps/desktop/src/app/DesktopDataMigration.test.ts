import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopDataMigration from "./DesktopDataMigration.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const makeInput = (homeDirectory: string) =>
  ({
    dirname: "/repo/apps/desktop/dist-electron",
    homeDirectory,
    platform: "darwin",
    processArch: "arm64",
    appVersion: "0.2.0",
    appPath: "/Applications/GedCode.app/Contents/Resources/app.asar",
    isPackaged: true,
    resourcesPath: "/Applications/GedCode.app/Contents/Resources",
    runningUnderArm64Translation: false,
  }) satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeLayer = (homeDirectory: string, env: Record<string, string | undefined> = {}) =>
  DesktopEnvironment.layer(makeInput(homeDirectory)).pipe(
    Layer.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))),
  );

it.layer(NodeServices.layer)("DesktopDataMigration", (it) => {
  it.effect("copies default ~/.t3 data into ~/.gedcode when the new location is absent", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-data-migration-" });
      const legacySettingsPath = path.join(home, ".t3", "userdata", "settings.json");
      const migratedSettingsPath = path.join(home, ".gedcode", "userdata", "settings.json");

      yield* fs.makeDirectory(path.dirname(legacySettingsPath), { recursive: true });
      yield* fs.writeFileString(legacySettingsPath, '{"theme":"legacy"}');

      const result = yield* DesktopDataMigration.migrateDefaultAppDataDirectory.pipe(
        Effect.provide(makeLayer(home)),
      );

      assert.deepEqual(result, {
        migrated: true,
        source: path.join(home, ".t3"),
        target: path.join(home, ".gedcode"),
      });
      assert.equal(yield* fs.readFileString(migratedSettingsPath), '{"theme":"legacy"}');
      assert.equal(yield* fs.readFileString(legacySettingsPath), '{"theme":"legacy"}');
    }),
  );

  it.effect(
    "copies the active legacy state directory when ~/.gedcode exists without that state directory",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-data-migration-base-" });
        const legacySettingsPath = path.join(home, ".t3", "userdata", "settings.json");
        const migratedSettingsPath = path.join(home, ".gedcode", "userdata", "settings.json");

        yield* fs.makeDirectory(path.dirname(legacySettingsPath), { recursive: true });
        yield* fs.writeFileString(legacySettingsPath, '{"theme":"legacy"}');
        yield* fs.makeDirectory(path.join(home, ".gedcode"), { recursive: true });
        yield* fs.writeFileString(path.join(home, ".gedcode", "settings.json"), '{"root":true}');

        const result = yield* DesktopDataMigration.migrateDefaultAppDataDirectory.pipe(
          Effect.provide(makeLayer(home)),
        );

        assert.deepEqual(result, {
          migrated: true,
          source: path.join(home, ".t3", "userdata"),
          target: path.join(home, ".gedcode", "userdata"),
        });
        assert.equal(yield* fs.readFileString(migratedSettingsPath), '{"theme":"legacy"}');
        assert.equal(
          yield* fs.readFileString(path.join(home, ".gedcode", "settings.json")),
          '{"root":true}',
        );
      }),
  );

  it.effect("does not overwrite an existing active state directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({
        prefix: "gedcode-data-migration-existing-",
      });
      const legacySettingsPath = path.join(home, ".t3", "userdata", "settings.json");
      const targetSettingsPath = path.join(home, ".gedcode", "userdata", "settings.json");

      yield* fs.makeDirectory(path.dirname(legacySettingsPath), { recursive: true });
      yield* fs.writeFileString(legacySettingsPath, '{"theme":"legacy"}');
      yield* fs.makeDirectory(path.dirname(targetSettingsPath), { recursive: true });
      yield* fs.writeFileString(targetSettingsPath, '{"theme":"target"}');

      const result = yield* DesktopDataMigration.migrateDefaultAppDataDirectory.pipe(
        Effect.provide(makeLayer(home)),
      );

      assert.deepEqual(result, { migrated: false, reason: "target-state-exists" });
      assert.equal(yield* fs.readFileString(targetSettingsPath), '{"theme":"target"}');
    }),
  );

  it.effect("skips migration for explicit T3CODE_HOME", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-data-migration-custom-" });
      const result = yield* DesktopDataMigration.migrateDefaultAppDataDirectory.pipe(
        Effect.provide(makeLayer(home, { T3CODE_HOME: path.join(home, "custom") })),
      );

      assert.deepEqual(result, { migrated: false, reason: "custom-base-dir" });
    }),
  );
});
