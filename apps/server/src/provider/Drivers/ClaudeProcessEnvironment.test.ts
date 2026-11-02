import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { makeClaudeEnvironment } from "./ClaudeHome.ts";
import { mergeClaudeProcessEnvironment } from "./ClaudeProcessEnvironment.ts";

it.layer(NodeServices.layer)("Claude process environment", (it) => {
  it.effect(
    "defaults to t3-code and replaces inherited SDK and desktop labels without mutation",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const homePath = yield* fs.makeTempDirectoryScoped();
        const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT;
        for (const inherited of [undefined, "sdk-ts", "sdk-cli", "claude-desktop"]) {
          const host = Object.freeze({ CLAUDE_CODE_ENTRYPOINT: inherited, KEEP: "host" });
          expect(yield* mergeClaudeProcessEnvironment({ homePath }, undefined, host)).toEqual({
            CLAUDE_CODE_ENTRYPOINT: "t3-code",
            KEEP: "host",
          });
          expect(host.CLAUDE_CODE_ENTRYPOINT).toBe(inherited);
        }
        expect(process.env.CLAUDE_CODE_ENTRYPOINT).toBe(originalEntrypoint);
      }).pipe(Effect.provideService(HostProcess.Platform, "win32")),
  );

  it.effect("lets instance, user and managed settings override in that order", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homePath = yield* fs.makeTempDirectoryScoped();
      const host = Object.freeze({ PROGRAMDATA: homePath, KEEP: "host" });
      const instance = Object.freeze([
        Object.freeze({ name: "CLAUDE_CODE_ENTRYPOINT", value: "instance", sensitive: false }),
      ]);
      const merge = () => mergeClaudeProcessEnvironment({ homePath }, instance, host);
      expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("instance");
      yield* fs.writeFileString(
        path.join(homePath, "settings.json"),
        '{ // Claude settings accept JSONC\n "env": { "CLAUDE_CODE_ENTRYPOINT": "user", }, }',
      );
      expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("user");
      yield* fs.makeDirectory(path.join(homePath, "ClaudeCode"));
      const managedPath = path.join(homePath, "ClaudeCode", "managed-settings.json");
      yield* fs.writeFileString(managedPath, '{"env":{"CLAUDE_CODE_ENTRYPOINT":"managed"}}');
      expect(yield* merge()).toEqual({ ...host, CLAUDE_CODE_ENTRYPOINT: "managed" });
      yield* fs.writeFileString(managedPath, "{bad JSON");
      expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("user");
      yield* fs.writeFileString(managedPath, '{"env":{"CLAUDE_CODE_ENTRYPOINT":""}}');
      expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("instance");
      expect(instance[0]?.value).toBe("instance");
      expect(host).toEqual({ PROGRAMDATA: homePath, KEEP: "host" });
    }).pipe(Effect.provideService(HostProcess.Platform, "win32")),
  );

  it.effect("ignores missing, malformed, invalid, empty and unreadable settings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homePath = yield* fs.makeTempDirectoryScoped();
      const settingsPath = path.join(homePath, "settings.json");
      const merge = () => mergeClaudeProcessEnvironment({ homePath }, undefined, {});
      expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("t3-code");
      for (const contents of [
        "{bad JSON",
        '{"env":{"CLAUDE_CODE_ENTRYPOINT":42}}',
        '{"env":{"CLAUDE_CODE_ENTRYPOINT":""}}',
        '{"env":{"OTHER":"value"}}',
      ]) {
        yield* fs.writeFileString(settingsPath, contents);
        expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("t3-code");
      }
      yield* fs.remove(settingsPath);
      yield* fs.makeDirectory(settingsPath);
      expect((yield* merge()).CLAUDE_CODE_ENTRYPOINT).toBe("t3-code");
    }).pipe(Effect.provideService(HostProcess.Platform, "win32")),
  );

  it.effect(
    "uses the existing config directory precedence and preserves unrelated environment",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        for (const [directory, entrypoint] of [
          [".claude", "default-home"],
          ["inherited", "inherited-home"],
          ["instance", "instance-home"],
          ["configured", "configured-home"],
        ] as const) {
          const configDir = path.join(root, directory);
          yield* fs.makeDirectory(configDir);
          yield* fs.writeFileString(
            path.join(configDir, "settings.json"),
            JSON.stringify({ env: { CLAUDE_CODE_ENTRYPOINT: entrypoint, KEEP: "settings" } }),
          );
        }
        const host = { CLAUDE_CONFIG_DIR: path.join(root, "inherited"), KEEP: "host" };
        const instance = [{ name: "CLAUDE_CONFIG_DIR", value: "~/instance", sensitive: false }];
        const merge = (homePath: string, environment = instance, baseEnv = host) =>
          mergeClaudeProcessEnvironment({ homePath }, environment, baseEnv).pipe(
            Effect.provideService(HostProcess.HomeDirectory, root),
          );
        expect(
          (yield* merge("", [], { ...host, CLAUDE_CONFIG_DIR: "" })).CLAUDE_CODE_ENTRYPOINT,
        ).toBe("default-home");
        expect((yield* merge("", [])).CLAUDE_CODE_ENTRYPOINT).toBe("inherited-home");
        const merged = yield* merge("");
        expect(merged).toEqual({
          KEEP: "host",
          CLAUDE_CONFIG_DIR: path.join(root, "instance"),
          CLAUDE_CODE_ENTRYPOINT: "instance-home",
        });
        const configured = yield* merge("~/configured");
        expect(configured.CLAUDE_CODE_ENTRYPOINT).toBe("configured-home");
        const final = yield* makeClaudeEnvironment({ homePath: "~/configured" }, configured).pipe(
          Effect.provideService(HostProcess.HomeDirectory, root),
        );
        expect(final.CLAUDE_CONFIG_DIR).toBe(path.join(root, "configured"));
        expect(final.KEEP).toBe("host");
      }).pipe(Effect.provideService(HostProcess.Platform, "win32")),
  );
});
