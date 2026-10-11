import type { DesktopUpdateChannel } from "@t3tools/contracts";

/**
 * Sparkle's trust anchor. The matching EdDSA private seed lives in the macOS
 * Keychain item `Private key for signing Sparkle updates` (account
 * `gedcode-updates`) and in the `SPARKLE_ED_PRIVATE_KEY` repository secret.
 * Sparkle reads this value from the packaged `Info.plist`, so changing it
 * strands every existing install behind a manual bridge release.
 */
export const SPARKLE_ED_PUBLIC_KEY = "OEqTyWgHzGWLdI/c38qOQw+fwKdK+npBmpSEum8e4U4=";

/** The GitHub release that hosts the appcasts, kept separate from the release
    train so a feed can be republished without recutting a version. */
export const SPARKLE_FEED_RELEASE_TAG = "sparkle-feed";

const SPARKLE_FEED_BASE_URL =
  `https://github.com/edgyarmati/gedcode/releases/download/${SPARKLE_FEED_RELEASE_TAG}` as const;

export function sparkleAppcastAssetName(channel: DesktopUpdateChannel): string {
  return `appcast-${channel}.xml`;
}

export function sparkleAppcastUrl(channel: DesktopUpdateChannel): string {
  return `${SPARKLE_FEED_BASE_URL}/${sparkleAppcastAssetName(channel)}`;
}
