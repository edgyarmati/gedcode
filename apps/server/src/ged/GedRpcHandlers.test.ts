import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  clientRpcRequiredScopes,
  WS_METHODS,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { requiredScopeForRpcMethod } from "../auth/RpcAuthorization.ts";
import { makeGedRpcHandlers } from "./GedRpcHandlers.ts";

describe("Ged setup over RPC", () => {
  it("previews with read access and needs write access to add files, on client and server", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.gedSetupPreview)).toBe(AuthFilesystemReadScope);
    expect(requiredScopeForRpcMethod(WS_METHODS.gedSetupApply)).toBe(AuthFilesystemWriteScope);
    expect(clientRpcRequiredScopes(WS_METHODS.gedSetupApply, { cwd: "/p" })).toEqual([
      AuthFilesystemWriteScope,
    ]);
  });

  it.effect("previews, applies, and reports a bad root as a typed error", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const handlers = yield* makeGedRpcHandlers;
      const root = yield* fs.makeTempDirectoryScoped();

      const plan = yield* handlers[WS_METHODS.gedSetupPreview]({ cwd: root });
      expect(plan.present).toEqual([]);
      const applied = yield* handlers[WS_METHODS.gedSetupApply]({ cwd: root });
      expect(applied.written).toEqual(plan.missing);

      const error = yield* handlers[WS_METHODS.gedSetupApply]({
        cwd: path.join(root, "absent"),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("GedSetupRpcError");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
