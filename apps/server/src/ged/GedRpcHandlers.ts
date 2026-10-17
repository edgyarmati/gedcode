import { GED_WS_METHODS, GedSetupRpcError, type GedSetupInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as GedSetup from "./GedSetup.ts";

/**
 * The client side of Ged setup, spread into the WebSocket RPC handlers. The
 * client previews first and applies on the user's confirmation.
 */
export const makeGedRpcHandlers = Effect.gen(function* () {
  const gedSetup = yield* GedSetup.GedSetup;
  const toRpcError = (error: GedSetup.GedSetupError) =>
    new GedSetupRpcError({ message: error.message });
  return {
    [GED_WS_METHODS.gedSetupPreview]: (input: GedSetupInput) =>
      gedSetup.preview(input.cwd).pipe(Effect.mapError(toRpcError)),
    [GED_WS_METHODS.gedSetupApply]: (input: GedSetupInput) =>
      gedSetup.apply(input.cwd).pipe(Effect.mapError(toRpcError)),
  };
}).pipe(Effect.provide(GedSetup.layer));
