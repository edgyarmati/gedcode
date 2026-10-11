import * as NodeURL from "node:url";

import { SPARKLE_ED_PUBLIC_KEY, sparkleAppcastUrl } from "@t3tools/shared/sparkleUpdate";
import { sparkleBuilderConfig } from "electron-sparkle-updater/builder";

import type { BuildPlatform } from "../lib/build-target-arch.ts";

/**
 * electron-builder configuration for the Sparkle-enabled macOS artifact.
 *
 * `sparkleBuilderConfig` returns a configuration fragment rather than a whole
 * config: `Sparkle.framework` as an extra file, the Info.plist keys Sparkle
 * reads at launch, and the `writeUpdateInfo: false` that stops
 * electron-builder writing electron-updater metadata for the DMG. Merging it into the macOS build config
 * is this module's job; the build
 * script applies it to whatever `createBuildConfig` produced, so that function
 * and its tests stay exactly upstream's.
 */

/** The hook electron-builder runs after staging the app, re-signing it ad hoc
    so the code resource seal still covers the framework Sparkle needs.
    Absolute, because electron-builder resolves hooks from its working
    directory rather than the staged project, as with `sign-macos.ts`. */
export const SPARKLE_AFTER_PACK_SCRIPT = NodeURL.fileURLToPath(
  new URL("./afterPack.cjs", import.meta.url),
);

/**
 * Info.plist policy the package's fragment leaves at Sparkle's defaults.
 * DesktopUpdates owns scheduling, consent and install timing, so Sparkle's own
 * scheduler, its first-launch permission prompt and silent installs stay off.
 * Feeds must be signed and archives verified before extraction; installs that
 * already require a signed feed reject an unsigned one, so dropping these
 * would strand them. `generate_appcast` only signs the feed when the app asks.
 */
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

  // Two parts of the fragment are deliberately not merged:
  // - `asarUnpack`: on macOS this build relies on electron-builder's smart
  //   unpack, which already extracts any package carrying a `.node` file, as
  //   it does for the other native addons.
  // - `zip`: electron-builder 26 has no top-level `zip` options and rejects
  //   the whole config over it. The zip's `latest-mac.yml` is still written,
  //   and is harmless: the Ged release workflow publishes assets by name.
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
