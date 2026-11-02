import * as NodeURL from "node:url";

import { SPARKLE_ED_PUBLIC_KEY, sparkleAppcastUrl } from "@t3tools/shared/sparkleUpdate";
import { sparkleBuilderConfig } from "electron-sparkle-updater/builder";

import type { BuildPlatform } from "../lib/build-target-arch.ts";

/** Prepares upstream's server compile cache, then re-signs the app ad hoc
    so the code resource seal covers the cache and the framework Sparkle needs.
    Absolute, because electron-builder resolves hooks from its working
    directory rather than the staged project, as with `sign-macos.ts`. */
export const SPARKLE_AFTER_PACK_SCRIPT = NodeURL.fileURLToPath(
  new URL("./afterPack.cjs", import.meta.url),
);

/** DesktopUpdates owns scheduling, consent and install timing, so Sparkle's
    scheduler and silent installs stay off. Existing installs require signed
    feeds and verification before extraction; dropping these would strand them.
    `generate_appcast` only signs the feed when the app asks. */
const SPARKLE_UPDATE_POLICY = {
  SUEnableAutomaticChecks: false,
  SUAllowsAutomaticUpdates: false,
  SUAutomaticallyUpdate: false,
  SUVerifyUpdateBeforeExtraction: true,
  SURequireSignedFeed: true,
  SUSignedFeedFailureExpirationInterval: 0,
} as const;

export interface SparkleBuildConfigOptions {
  readonly platform: BuildPlatform;
  readonly channel: Parameters<typeof sparkleAppcastUrl>[0];
  /** The languages the app itself declares. macOS only loads an embedded
      framework's localizations for languages the host app claims, so Sparkle's
      UI follows `electronLanguages` rather than every translation it ships. */
  readonly localizations: ReadonlyArray<string>;
}

type BuildConfig = Record<string, unknown>;

function mergeRecord(base: unknown, overlay: Record<string, unknown>): Record<string, unknown> {
  return { ...(typeof base === "object" && base !== null ? base : {}), ...overlay };
}

function mergeList(base: unknown, additions: ReadonlyArray<unknown>): Array<unknown> {
  return [...(Array.isArray(base) ? base : []), ...additions];
}

/** Returns a copy of a macOS `buildConfig` with the Sparkle fragment merged
    in; other platforms' configs are returned as they are. */
export function applySparkleBuildConfig(
  buildConfig: BuildConfig,
  options: SparkleBuildConfigOptions,
): BuildConfig {
  if (options.platform !== "mac") return buildConfig;
  const fragment = sparkleBuilderConfig({
    feedUrl: sparkleAppcastUrl(options.channel),
    publicEdKey: SPARKLE_ED_PUBLIC_KEY,
    localizations: [...options.localizations],
  });

  // Smart unpack handles `.node` files, so omit the fragment's `asarUnpack`.
  // electron-builder 26 rejects its top-level `zip` key; the resulting
  // latest-mac.yml is harmless because Ged publishes release assets by name.
  return {
    ...buildConfig,
    afterPack: SPARKLE_AFTER_PACK_SCRIPT,
    extraFiles: mergeList(buildConfig.extraFiles, fragment.extraFiles),
    // The app's own exclusions come first; Sparkle's keep the vendored
    // framework and its source archive out of app.asar, since the framework
    // ships beside the asar as an extra file instead.
    files: mergeList(buildConfig.files, fragment.files),
    dmg: mergeRecord(buildConfig.dmg, fragment.dmg),
    mac: {
      ...mergeRecord(buildConfig.mac, {}),
      extendInfo: mergeRecord(
        (buildConfig.mac as Record<string, unknown> | undefined)?.extendInfo,
        { ...fragment.mac.extendInfo, ...SPARKLE_UPDATE_POLICY },
      ),
    },
  };
}
