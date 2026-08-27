import type { SparkleBridge } from "electron-sparkle-updater";
import { loadSparkleBridgeForApp } from "electron-sparkle-updater";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

export class ElectronSparkleUpdaterError extends Data.TaggedError("ElectronSparkleUpdaterError")<{
  readonly operation: "load" | "configure" | "check" | "background-check" | "install";
  readonly cause: unknown;
}> {
  override get message() {
    return `Sparkle updater failed during ${this.operation}.`;
  }
}

export interface ElectronSparkleUpdaterShape {
  readonly configure: (options: {
    readonly appcastUrl: string;
    readonly publicEdKey: string;
  }) => Effect.Effect<boolean, ElectronSparkleUpdaterError>;
  readonly checkForUpdates: Effect.Effect<boolean, ElectronSparkleUpdaterError>;
  readonly checkForUpdatesInBackgroundAndDownload: Effect.Effect<
    boolean,
    ElectronSparkleUpdaterError
  >;
  readonly setFeedURL: (url: string) => Effect.Effect<boolean, ElectronSparkleUpdaterError>;
  readonly installUpdateNow: Effect.Effect<boolean, ElectronSparkleUpdaterError>;
}

export class ElectronSparkleUpdater extends Context.Service<
  ElectronSparkleUpdater,
  ElectronSparkleUpdaterShape
>()("@t3tools/desktop/electron/ElectronSparkleUpdater") {}

export interface ElectronSparkleUpdaterDependencies {
  readonly loadBridge: (log?: (message: string) => void) => Promise<SparkleBridge | null>;
  readonly log?: (message: string) => void;
}

export function makeLayer(dependencies: ElectronSparkleUpdaterDependencies) {
  return Layer.effect(
    ElectronSparkleUpdater,
    Effect.gen(function* () {
      const bridgeRef = yield* Ref.make<Option.Option<SparkleBridge>>(Option.none());

      const withBridge = <A>(
        operation: ElectronSparkleUpdaterError["operation"],
        f: (bridge: SparkleBridge) => A,
      ): Effect.Effect<boolean, ElectronSparkleUpdaterError> =>
        Ref.get(bridgeRef).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.succeed(false),
              onSome: (bridge) =>
                Effect.try({
                  try: () => f(bridge),
                  catch: (cause) => new ElectronSparkleUpdaterError({ operation, cause }),
                }).pipe(Effect.as(true)),
            }),
          ),
        );

      return ElectronSparkleUpdater.of({
        configure: (options) =>
          Effect.tryPromise({
            try: () => dependencies.loadBridge(dependencies.log),
            catch: (cause) => new ElectronSparkleUpdaterError({ operation: "load", cause }),
          }).pipe(
            Effect.flatMap((bridge) => {
              if (bridge === null) return Effect.succeed(false);
              return Effect.try({
                try: () => {
                  const initialized = bridge.init(options);
                  if (!initialized) return false;
                  if (!bridge.setFeedURL(options.appcastUrl)) return false;
                  // GedCode owns the poll cadence so every background check can
                  // auto-accept only the download step while Sparkle retains its
                  // explicit install-and-relaunch confirmation.
                  bridge.setAutomaticChecks(false);
                  return true;
                },
                catch: (cause) =>
                  new ElectronSparkleUpdaterError({ operation: "configure", cause }),
              }).pipe(
                Effect.tap((initialized) =>
                  initialized
                    ? Ref.set(bridgeRef, Option.some(bridge))
                    : Ref.set(bridgeRef, Option.none()),
                ),
              );
            }),
          ),
        checkForUpdates: withBridge("check", (bridge) => bridge.checkForUpdates()),
        checkForUpdatesInBackgroundAndDownload: withBridge("background-check", (bridge) =>
          bridge.checkForUpdatesInBackgroundAndDownload(),
        ),
        setFeedURL: (url) => withBridge("configure", (bridge) => bridge.setFeedURL(url)),
        installUpdateNow: withBridge("install", (bridge) => bridge.installUpdateNow()),
      });
    }),
  );
}

export const layer = makeLayer({ loadBridge: loadSparkleBridgeForApp });
