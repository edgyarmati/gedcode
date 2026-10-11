import type { DesktopUpdateChannel } from "@t3tools/contracts";
import type { SparkleBridge, SparkleBridgeEvent } from "electron-sparkle-updater";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ElectronUpdater from "./ElectronUpdater.ts";
import { SPARKLE_ED_PUBLIC_KEY, sparkleAppcastUrl } from "./sparkleFeed.ts";

/**
 * A second implementation of {@link ElectronUpdater.ElectronUpdater}, backed by
 * Sparkle instead of electron-updater, selected on macOS.
 *
 * electron-updater installs a macOS update through the system code signature,
 * so it cannot update an ad-hoc-signed build at all. Sparkle verifies the
 * archive with its own EdDSA signature over the download, which is what lets
 * this app update itself without an Apple Developer Program certificate.
 *
 * Everything above the service — `DesktopUpdates`, the update state machine,
 * the channel settings, the UI — talks to the interface and is untouched, so
 * this file has to speak electron-updater's protocol exactly:
 *
 * - **Events.** Sparkle's `checking` / `update-available` / `update-not-available`
 *   / `download-progress` / `update-downloaded` / `error` are re-emitted under
 *   electron-updater's names with electron-updater's payload shapes
 *   (`{ version, releaseNotes? }` and `{ percent }`).
 * - **Consent.** electron-updater finds an update, stops, and downloads only
 *   when `downloadUpdate` is called. Sparkle's silent user driver accepts the
 *   update as soon as it is found and starts downloading immediately. The gate
 *   below holds the progress and completion events back until `downloadUpdate`
 *   is called, then releases them, so the user-facing flow is unchanged.
 * - **Completion.** `downloadUpdate` resolves when the download finishes, as
 *   electron-updater's promise does, not when the request is made.
 *
 * Settings electron-updater exposes as mutable fields (`autoDownload`,
 * `allowPrerelease`, `fullChangelog`, differential downloads) have no Sparkle
 * equivalent: Sparkle picks the newest item its appcast offers, and each
 * channel has its own appcast. They are recorded and otherwise inert.
 */

export class ElectronSparkleUpdaterUnavailableError extends Data.TaggedError(
  "ElectronSparkleUpdaterUnavailableError",
)<{
  readonly reason: "addon-unavailable" | "init-failed" | "unsupported-channel";
  readonly detail: string;
}> {
  override get message(): string {
    return `The Sparkle updater is unavailable (${this.reason}): ${this.detail}`;
  }
}

/** The subset of the native bridge this adapter drives. */
export type ElectronSparkleBridge = Pick<
  SparkleBridge,
  | "init"
  | "checkForUpdates"
  | "installUpdateNow"
  | "installUpdateOnQuit"
  | "setAutomaticChecks"
  | "setEventHandler"
>;

export interface ElectronSparkleUpdaterDependencies {
  /** Resolves the native bridge, or `null` when the addon cannot be loaded. */
  readonly loadBridge: (
    log?: (message: string) => void,
  ) => Promise<ElectronSparkleBridge | null | undefined>;
  readonly log?: (message: string) => void;
}

interface UpdatePayload {
  readonly version: string;
  readonly releaseNotes?: string;
}

/** What has happened since Sparkle found an update, and what the consumer has
    been told about it. Sparkle downloads without being asked; the consumer is
    only told once it asks. */
type DownloadGate =
  | { readonly kind: "idle" }
  /** Sparkle is (or may be) downloading; the consumer has not asked yet. */
  | {
      readonly kind: "held";
      readonly percent: number | null;
      readonly downloaded: UpdatePayload | null;
    }
  /** The consumer asked; events flow through. */
  | { readonly kind: "streaming" };

const isDesktopUpdateChannel = (channel: string): channel is DesktopUpdateChannel =>
  channel === "latest" || channel === "nightly";

export function make(dependencies: ElectronSparkleUpdaterDependencies) {
  const log = (message: string) => dependencies.log?.(`[sparkle-updater] ${message}`);

  const listeners = new Map<string, Set<(...args: Array<unknown>) => void>>();
  const emit = (eventName: string, ...args: Array<unknown>) => {
    for (const listener of [...(listeners.get(eventName) ?? [])]) listener(...args);
  };

  let channel = "latest";
  let feedUrlOverride: string | null = null;
  let autoInstallOnAppQuit = false;
  let bridge: ElectronSparkleBridge | null = null;
  let initializedFeedUrl: string | null = null;
  let gate: DownloadGate = { kind: "idle" };
  let resumeDownload: ((outcome: Effect.Effect<void, Error>) => void) | null = null;

  const resolveFeedUrl = (): string | ElectronSparkleUpdaterUnavailableError => {
    if (feedUrlOverride !== null) return feedUrlOverride;
    if (!isDesktopUpdateChannel(channel)) {
      return new ElectronSparkleUpdaterUnavailableError({
        reason: "unsupported-channel",
        detail: `no appcast is published for channel ${channel}`,
      });
    }
    return sparkleAppcastUrl(channel);
  };

  const toUpdatePayload = (event: SparkleBridgeEvent): UpdatePayload | null =>
    event.version === undefined || event.version === ""
      ? null
      : event.releaseNotes === undefined
        ? { version: event.version }
        : { version: event.version, releaseNotes: event.releaseNotes };

  const failDownload = (error: Error) => {
    const resume = resumeDownload;
    resumeDownload = null;
    gate = { kind: "idle" };
    resume?.(Effect.fail(error));
  };

  const completeDownload = (payload: UpdatePayload) => {
    const resume = resumeDownload;
    resumeDownload = null;
    gate = { kind: "idle" };
    emit("update-downloaded", payload);
    if (autoInstallOnAppQuit) bridge?.installUpdateOnQuit();
    resume?.(Effect.void);
  };

  const handleSparkleEvent = (event: SparkleBridgeEvent) => {
    switch (event.type) {
      case "checking": {
        emit("checking-for-update");
        return;
      }
      case "update-not-available": {
        gate = { kind: "idle" };
        emit("update-not-available");
        return;
      }
      case "update-available": {
        const payload = toUpdatePayload(event);
        if (payload === null) {
          emit("error", new Error("Sparkle reported an update without a version."));
          return;
        }
        gate = { kind: "held", percent: null, downloaded: null };
        emit("update-available", payload);
        return;
      }
      case "download-progress": {
        const percent = event.percent;
        if (percent === undefined) return;
        if (gate.kind === "held") {
          gate = { ...gate, percent };
          return;
        }
        emit("download-progress", { percent });
        return;
      }
      case "update-downloaded": {
        const payload = toUpdatePayload(event);
        if (payload === null) {
          emit("error", new Error("Sparkle staged an update without a version."));
          return;
        }
        if (gate.kind === "held") {
          gate = { ...gate, downloaded: payload };
          return;
        }
        completeDownload(payload);
        return;
      }
      case "error": {
        const error = new Error(event.message ?? "The Sparkle updater reported an error.");
        if (gate.kind === "streaming") failDownload(error);
        else gate = { kind: "idle" };
        emit("error", error);
        return;
      }
      default: {
        log(`ignoring unknown bridge event ${event.type}`);
      }
    }
  };

  const ensureBridge: Effect.Effect<ElectronSparkleBridge, ElectronSparkleUpdaterUnavailableError> =
    Effect.suspend(() => {
      const feedUrl = resolveFeedUrl();
      if (feedUrl instanceof ElectronSparkleUpdaterUnavailableError) return Effect.fail(feedUrl);

      const configure = (loaded: ElectronSparkleBridge) =>
        Effect.suspend(() => {
          if (initializedFeedUrl === feedUrl) return Effect.succeed(loaded);
          // init() is idempotent: on a second call the native side only swaps the
          // feed URL and discards a download staged from the previous channel.
          if (!loaded.init({ appcastUrl: feedUrl, publicEdKey: SPARKLE_ED_PUBLIC_KEY })) {
            return Effect.fail(
              new ElectronSparkleUpdaterUnavailableError({
                reason: "init-failed",
                detail: `the Sparkle bridge refused to start against ${feedUrl}`,
              }),
            );
          }
          loaded.setEventHandler(handleSparkleEvent);
          // DesktopUpdates owns the poll cadence; Sparkle's own scheduler would
          // check behind its back and bypass this adapter's gate.
          loaded.setAutomaticChecks(false);
          initializedFeedUrl = feedUrl;
          bridge = loaded;
          return Effect.succeed(loaded);
        });

      if (bridge !== null) return configure(bridge);

      return Effect.tryPromise({
        try: () => dependencies.loadBridge(log),
        catch: (cause) =>
          new ElectronSparkleUpdaterUnavailableError({
            reason: "addon-unavailable",
            detail: `loading the Sparkle addon failed: ${String(cause)}`,
          }),
      }).pipe(
        Effect.flatMap((loaded) =>
          loaded === null || loaded === undefined
            ? Effect.fail(
                new ElectronSparkleUpdaterUnavailableError({
                  reason: "addon-unavailable",
                  detail: "the Sparkle addon is missing from this build",
                }),
              )
            : configure(loaded),
        ),
      );
    });

  const reconfigureIfRunning = Effect.suspend(() =>
    bridge === null ? Effect.void : ensureBridge.pipe(Effect.ignore),
  );

  return ElectronUpdater.ElectronUpdater.of({
    setFeedURL: (options) =>
      Effect.suspend(() => {
        const url = (options as { readonly url?: unknown }).url;
        feedUrlOverride = typeof url === "string" ? url : null;
        return reconfigureIfRunning;
      }),
    setAutoDownload: () => Effect.void,
    setAutoInstallOnAppQuit: (value) =>
      Effect.sync(() => {
        autoInstallOnAppQuit = value;
      }),
    setChannel: (next) =>
      Effect.suspend(() => {
        channel = next;
        return reconfigureIfRunning;
      }),
    setAllowPrerelease: () => Effect.void,
    allowDowngrade: Effect.succeed(false),
    setAllowDowngrade: () => Effect.void,
    setFullChangelog: () => Effect.void,
    setDisableDifferentialDownload: () => Effect.void,
    checkForUpdates: Effect.suspend(() =>
      ensureBridge.pipe(
        Effect.mapError(
          (cause) => new ElectronUpdater.ElectronUpdaterCheckForUpdatesError({ channel, cause }),
        ),
        Effect.flatMap((loaded) =>
          Effect.try({
            try: () => loaded.checkForUpdates(),
            catch: (cause) =>
              new ElectronUpdater.ElectronUpdaterCheckForUpdatesError({ channel, cause }),
          }),
        ),
        Effect.asVoid,
      ),
    ),
    downloadUpdate: Effect.suspend(() => {
      const failure = (detail: string) =>
        Effect.fail(
          new ElectronUpdater.ElectronUpdaterDownloadUpdateError({
            channel,
            cause: new Error(detail),
          }),
        );
      if (gate.kind !== "held") return failure("No update is waiting to be downloaded.");

      const held = gate;
      const downloaded = held.downloaded;
      if (downloaded !== null) {
        return Effect.sync(() => {
          completeDownload(downloaded);
        });
      }

      return Effect.callback<void, Error>((resume) => {
        gate = { kind: "streaming" };
        resumeDownload = resume;
        // Sparkle has been downloading since it accepted the update; replay the
        // latest percentage so the consumer does not sit at zero.
        if (held.percent !== null) emit("download-progress", { percent: held.percent });
        return Effect.sync(() => {
          resumeDownload = null;
        });
      }).pipe(
        Effect.mapError(
          (cause) => new ElectronUpdater.ElectronUpdaterDownloadUpdateError({ channel, cause }),
        ),
      );
    }),
    quitAndInstall: ({ isSilent, isForceRunAfter }) =>
      ensureBridge.pipe(
        Effect.mapError(
          (cause) =>
            new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
              channel,
              isSilent,
              isForceRunAfter,
              cause,
            }),
        ),
        Effect.flatMap((loaded) =>
          Effect.try({
            try: () => loaded.installUpdateNow(),
            catch: (cause) =>
              new ElectronUpdater.ElectronUpdaterQuitAndInstallError({
                channel,
                isSilent,
                isForceRunAfter,
                cause,
              }),
          }),
        ),
        Effect.asVoid,
      ),
    on: (eventName, listener) => {
      const untyped = listener as unknown as (...args: Array<unknown>) => void;
      return Effect.acquireRelease(
        Effect.sync(() => {
          const registered = listeners.get(eventName) ?? new Set();
          registered.add(untyped);
          listeners.set(eventName, registered);
        }),
        () =>
          Effect.sync(() => {
            const registered = listeners.get(eventName);
            if (registered === undefined) return;
            registered.delete(untyped);
            if (registered.size === 0) listeners.delete(eventName);
          }),
      ).pipe(Effect.asVoid);
    },
  });
}

export function makeLayer(dependencies: ElectronSparkleUpdaterDependencies) {
  return Layer.sync(ElectronUpdater.ElectronUpdater, () => make(dependencies));
}

export const layer = makeLayer({
  loadBridge: async (log) => {
    const { loadSparkleBridgeForApp } = await import("electron-sparkle-updater");
    return loadSparkleBridgeForApp(log);
  },
});

/**
 * macOS updates through Sparkle; every other platform keeps electron-updater
 * untouched, down to the layer instance.
 */
export function layerForPlatform(
  platform: NodeJS.Platform,
): Layer.Layer<ElectronUpdater.ElectronUpdater> {
  return platform === "darwin" ? layer : ElectronUpdater.layer;
}

/** {@link layerForPlatform} against the host the app is running on. */
export const layerAuto: Layer.Layer<ElectronUpdater.ElectronUpdater> = Layer.unwrap(
  Effect.map(HostProcess.Platform, layerForPlatform),
);
