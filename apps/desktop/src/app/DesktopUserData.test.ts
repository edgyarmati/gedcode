import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("fails when the GedCode profile cannot be inspected and preserves the cause", () => {
  const destinationState = "/profiles/gedcode/Local State";
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "exists",
    pathOrDescriptor: destinationState,
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
      platform: "win32",
    }).pipe(Effect.flip);
    assert.equal(error.operation, "inspect");
    assert.equal(error.resourcePath, destinationState);
    assert.equal(error.category, "PermissionDenied");
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({ exists: () => Effect.fail(cause) }),
    ),
    Effect.provide(NodeServices.layer),
  );
});

it.effect.each(["t3code", "t3code-v2", "T3 Code (Alpha)"])(
  "never imports Windows credential keys from the T3 Code profile %s",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-profile-" });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, "gedcode");
      yield* fs.makeDirectory(source, { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), "T3 Code keys");
      const resolved = yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(resolved, destination);
      assert.isFalse(yield* fs.exists(path.join(destination, "Local State")));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("leaves an existing GedCode profile untouched", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-profile-" });
    const destination = path.join(directory, "gedcode");
    yield* fs.makeDirectory(destination, { recursive: true });
    yield* fs.writeFileString(path.join(destination, "Local State"), "existing state");
    const resolved = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: false,
      platform: "win32",
    });
    assert.equal(resolved, destination);
    assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), "existing state");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
