import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { buildT3ProjectFileJsonSchema } from "@t3tools/shared/t3ProjectFile";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { rebrandText } from "./identity.ts";

/** Where the schema `gedcode.json` files reference is committed and served from. */
export const GED_PROJECT_FILE_SCHEMA_PATH = "docs/ged/gedcode.schema.json";

/** The published JSON Schema for `gedcode.json`, in GedCode's words. */
export function renderGedProjectFileSchema(): string {
  return rebrandText(`${JSON.stringify(buildT3ProjectFileJsonSchema(), null, 2)}\n`);
}

/** `node scripts/ged/project-file-schema.ts` regenerates the committed schema. */
if (import.meta.main) {
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const target = path.join(import.meta.dirname, "../..", GED_PROJECT_FILE_SCHEMA_PATH);
    yield* fs.writeFileString(target, renderGedProjectFileSchema());
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
