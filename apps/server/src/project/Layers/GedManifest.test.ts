import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  CURRENT_GED_SCHEMA_VERSION,
  decodeGedManifest,
  encodeGedManifest,
} from "../GedManifest.ts";
import { GedManifestManager } from "../Services/GedManifest.ts";
import { WorkspacePathsLive } from "../../workspace/Layers/WorkspacePaths.ts";
import { GedManifestManagerLive } from "./GedManifest.ts";

const TestLayer = GedManifestManagerLive.pipe(
  Layer.provide(WorkspacePathsLive),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("GedManifestManagerLive", (it) => {
  it.effect("adopts a legacy version exactly once and removes the old source", () =>
    Effect.gen(function* () {
      const manager = yield* GedManifestManager;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "ged-manifest-" });
      yield* fs.makeDirectory(path.join(cwd, ".ged"));
      yield* fs.writeFileString(path.join(cwd, ".ged/VERSION"), "2\n");

      expect(yield* manager.inspect(cwd)).toEqual({ status: "legacy", sourceSchemaVersion: 2 });

      const adopted = yield* manager.adoptLegacy({
        workspaceRoot: cwd,
        now: "2026-07-21T12:00:00.000Z",
        generatedBy: "gedcode@0.3.0",
      });

      expect(adopted).toMatchObject({
        status: "current",
        sourceSchemaVersion: CURRENT_GED_SCHEMA_VERSION,
      });
      expect(yield* fs.exists(path.join(cwd, ".ged/VERSION"))).toBe(false);
      expect(
        decodeGedManifest(yield* fs.readFileString(path.join(cwd, ".ged/MANIFEST.json"))),
      ).toEqual({
        schemaVersion: CURRENT_GED_SCHEMA_VERSION,
        updatedAt: "2026-07-21T12:00:00.000Z",
        lastReviewedAt: "2026-07-21T12:00:00.000Z",
        generatedBy: "gedcode@0.3.0",
      });

      const second = yield* manager.adoptLegacy({
        workspaceRoot: cwd,
        now: "2026-07-22T12:00:00.000Z",
        generatedBy: "gedcode@0.3.0",
      });
      expect(second).toEqual(adopted);
    }),
  );

  it.effect("refuses to adopt malformed or newer manifests", () =>
    Effect.gen(function* () {
      const manager = yield* GedManifestManager;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "ged-manifest-" });
      yield* fs.makeDirectory(path.join(cwd, ".ged"));
      yield* fs.writeFileString(path.join(cwd, ".ged/MANIFEST.json"), "{}");
      expect((yield* manager.inspect(cwd).pipe(Effect.flip)).detail).toMatch(/schemaVersion/);

      yield* fs.writeFileString(
        path.join(cwd, ".ged/MANIFEST.json"),
        encodeGedManifest({
          schemaVersion: CURRENT_GED_SCHEMA_VERSION + 1,
          updatedAt: "2026-07-21T12:00:00.000Z",
          lastReviewedAt: "2026-07-21T12:00:00.000Z",
          generatedBy: "gedcode@9.0.0",
        }),
      );
      expect(
        (yield* manager
          .adoptLegacy({
            workspaceRoot: cwd,
            now: "2026-07-21T12:00:00.000Z",
            generatedBy: "gedcode@0.3.0",
          })
          .pipe(Effect.flip)).detail,
      ).toMatch(/newer/);
    }),
  );
});
