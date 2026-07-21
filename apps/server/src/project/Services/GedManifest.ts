import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { GedSchemaInspection } from "../GedManifest.ts";

export class GedManifestError extends Schema.TaggedErrorClass<GedManifestError>()(
  "GedManifestError",
  {
    workspaceRoot: Schema.String,
    operation: Schema.String,
    detail: Schema.String,
  },
) {}

export interface GedManifestManagerShape {
  readonly inspect: (workspaceRoot: string) => Effect.Effect<GedSchemaInspection, GedManifestError>;
  readonly adoptLegacy: (input: {
    readonly workspaceRoot: string;
    readonly now: string;
    readonly generatedBy: string;
  }) => Effect.Effect<GedSchemaInspection, GedManifestError>;
  readonly writeCurrent: (input: {
    readonly workspaceRoot: string;
    readonly now: string;
    readonly generatedBy: string;
  }) => Effect.Effect<GedSchemaInspection, GedManifestError>;
}

export class GedManifestManager extends Context.Service<
  GedManifestManager,
  GedManifestManagerShape
>()("gedcode/project/Services/GedManifest/GedManifestManager") {}
