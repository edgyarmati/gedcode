import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as GedSetup from "./GedSetup.ts";
import { LAND_GATE } from "./starter/landGate.ts";
import { STARTER_FILES } from "./starter/index.ts";

const layer = GedSetup.layer.pipe(Layer.provideMerge(NodeServices.layer));

const ALL = STARTER_FILES.map((file) => file.path);

it.effect("adds every starter file to an empty project, and nothing on a second run", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const setup = yield* GedSetup.GedSetup;
    const root = yield* fs.makeTempDirectoryScoped();

    expect((yield* setup.preview(root)).missing).toEqual(ALL);
    const first = yield* setup.apply(root);
    expect(first.written).toEqual(ALL);
    expect((yield* setup.preview(root)).missing).toEqual([]);

    const second = yield* setup.apply(root);
    expect(second.written).toEqual([]);
    expect(second.skipped).toEqual(ALL);

    const gate = yield* fs.stat(path.join(root, ".ged", "bin", "land-gate.sh"));
    expect(gate.mode & 0o111, "the gate is executable").not.toBe(0);
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("leaves a project's existing files byte-identical", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const setup = yield* GedSetup.GedSetup;
    const root = yield* fs.makeTempDirectoryScoped();
    const standards = path.join(root, ".ged", "STANDARDS.md");
    yield* fs.makeDirectory(path.dirname(standards), { recursive: true });
    yield* fs.writeFileString(standards, "# Ours\n");

    const plan = yield* setup.preview(root);
    expect(plan.present).toEqual([".ged/STANDARDS.md"]);
    const result = yield* setup.apply(root);
    expect(result.skipped).toEqual([".ged/STANDARDS.md"]);
    expect(yield* fs.readFileString(standards)).toBe("# Ours\n");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("refuses to follow a symlinked .ged or .ged/bin out of the project", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const setup = yield* GedSetup.GedSetup;

    for (const linked of [".ged", path.join(".ged", "bin")]) {
      const root = yield* fs.makeTempDirectoryScoped();
      const outside = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(path.dirname(path.join(root, linked)), { recursive: true });
      yield* fs.symlink(outside, path.join(root, linked));

      const error = yield* Effect.flip(setup.apply(root));
      expect(error._tag).toBe("GedSetupError");
      expect(yield* fs.readDirectory(outside), `nothing written through ${linked}`).toEqual([]);
    }
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

it.effect("refuses a root that is not a directory", () =>
  Effect.gen(function* () {
    const setup = yield* GedSetup.GedSetup;
    const error = yield* Effect.flip(setup.apply("/nonexistent/ged-setup-root"));
    expect(error._tag).toBe("GedSetupError");
  }).pipe(Effect.provide(layer)),
);

it.effect("installs the same land gate this repository runs", () =>
  Effect.gen(function* () {
    // Projects get the gate GedCode itself is held to; if these drift, a fix to
    // one never reaches the other.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const ours = yield* fs.readFileString(
      path.resolve(import.meta.dirname, "../../../../.ged/bin/land-gate.sh"),
    );
    expect(LAND_GATE).toBe(ours);
  }).pipe(Effect.provide(layer)),
);
