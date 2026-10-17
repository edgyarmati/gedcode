import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { isFirstLaunchAfterV04, markNoticeShown } from "./GedUpgradeNotice.ts";

it.layer(NodeServices.layer)("GedUpgradeNotice", (it) => {
  it.effect("shows only while a 0.4 database waits for its first import", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();

      expect(yield* isFirstLaunchAfterV04(stateDir)).toBe(false);
      yield* fs.writeFileString(path.join(stateDir, "state.sqlite"), "");
      expect(yield* isFirstLaunchAfterV04(stateDir)).toBe(true);
      yield* fs.writeFileString(path.join(stateDir, "statev2.sqlite"), "");
      expect(yield* isFirstLaunchAfterV04(stateDir)).toBe(false);
    }).pipe(Effect.scoped),
  );

  it.effect("shows once even when the local server never imports the database", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped();

      yield* fs.writeFileString(path.join(stateDir, "state.sqlite"), "");
      expect(yield* isFirstLaunchAfterV04(stateDir)).toBe(true);
      yield* markNoticeShown(stateDir);
      expect(yield* isFirstLaunchAfterV04(stateDir)).toBe(false);
    }).pipe(Effect.scoped),
  );
});
