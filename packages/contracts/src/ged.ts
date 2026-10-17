import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { EnvironmentAuthorizationError } from "./auth.ts";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Ged setup from a client: preview which starter `.ged/` files a project lacks,
 * then add them. Setup only ever adds files; the agent-facing equivalent is the
 * `ged_init` MCP tool.
 */

export const GED_WS_METHODS = {
  gedSetupPreview: "ged.setupPreview",
  gedSetupApply: "ged.setupApply",
} as const;

export const GedSetupInput = Schema.Struct({
  /** The project's workspace root. */
  cwd: TrimmedNonEmptyString,
});
export type GedSetupInput = typeof GedSetupInput.Type;

export const GedSetupPreviewResult = Schema.Struct({
  missing: Schema.Array(Schema.String),
  present: Schema.Array(Schema.String),
});
export type GedSetupPreviewResult = typeof GedSetupPreviewResult.Type;

export const GedSetupApplyResult = Schema.Struct({
  written: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.String),
});
export type GedSetupApplyResult = typeof GedSetupApplyResult.Type;

export class GedSetupRpcError extends Schema.TaggedError<GedSetupRpcError>()("GedSetupRpcError", {
  message: TrimmedNonEmptyString,
}) {}

export const WsGedSetupPreviewRpc = Rpc.make(GED_WS_METHODS.gedSetupPreview, {
  payload: GedSetupInput,
  success: GedSetupPreviewResult,
  error: Schema.Union([GedSetupRpcError, EnvironmentAuthorizationError]),
});

export const WsGedSetupApplyRpc = Rpc.make(GED_WS_METHODS.gedSetupApply, {
  payload: GedSetupInput,
  success: GedSetupApplyResult,
  error: Schema.Union([GedSetupRpcError, EnvironmentAuthorizationError]),
});
