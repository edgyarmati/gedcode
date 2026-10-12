import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { GED_PROJECT_FILE_SCHEMA_PATH, renderGedProjectFileSchema } from "./project-file-schema.ts";

describe("gedcode.json schema", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("is committed as generated", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const committed = yield* fs.readFileString(
          path.join(import.meta.dirname, "../..", GED_PROJECT_FILE_SCHEMA_PATH),
        );
        assert.equal(
          committed,
          renderGedProjectFileSchema(),
          "Run `node scripts/ged/project-file-schema.ts` to regenerate it.",
        );
      }),
    );
  });
});
