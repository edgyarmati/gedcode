// @effect-diagnostics nodeBuiltinImport:off - a project id becomes a filename through a hash.
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

/**
 * Remembers which projects an agent has already offered Ged setup in.
 *
 * Agents keep nothing between threads, so "offer it the first time" needs the
 * server to remember. The record lives in GedCode's own state directory, never
 * in the user's checkout: declining setup must not leave a file in their repo.
 * One empty marker per project, created exclusively, so two threads opening at
 * once still produce a single offer.
 */
export class GedSetupOffers extends Context.Service<
  GedSetupOffers,
  {
    /**
     * True exactly once per project: the first caller claims the offer. A
     * failure to record it answers false, since a nudge that cannot be
     * remembered would otherwise repeat in every thread.
     */
    readonly claim: (projectId: string) => Effect.Effect<boolean>;
  }
>()("t3/ged/GedSetupOffers") {}

const markerName = (projectId: string) =>
  NodeCrypto.createHash("sha256").update(projectId).digest("hex");

const make = Effect.fn("ged.GedSetupOffers.make")(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const claim = (projectId: string) =>
    fs.makeDirectory(dir, { recursive: true }).pipe(
      Effect.andThen(fs.writeFileString(path.join(dir, markerName(projectId)), "", { flag: "wx" })),
      Effect.as(true),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "AlreadyExists"
            ? Effect.succeed(false)
            : Effect.logWarning("Could not record a Ged setup offer", error).pipe(Effect.as(false)),
      }),
    );

  return { claim } as const;
});

export const layer = Layer.effect(
  GedSetupOffers,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    return yield* make(path.join(config.stateDir, "ged-setup-offers"));
  }),
);

/** For tests: markers under a directory of the caller's choosing. */
export const layerAt = (dir: string) => Layer.effect(GedSetupOffers, make(dir));
