import type { DesktopUpdateChannel } from "@t3tools/contracts";

/** Stable EdDSA trust anchor embedded in Info.plist; rotating it strands installed apps. */
export const SPARKLE_ED_PUBLIC_KEY = "OEqTyWgHzGWLdI/c38qOQw+fwKdK+npBmpSEum8e4U4=";

/** The GitHub release that hosts the appcasts, kept separate from the release
    train so a feed can be republished without recutting a version. */
const SPARKLE_FEED_RELEASE_TAG = "sparkle-feed";

const RELEASE_DOWNLOAD_BASE_URL = "https://github.com/edgyarmati/gedcode/releases/download";

const SPARKLE_FEED_BASE_URL = `${RELEASE_DOWNLOAD_BASE_URL}/${SPARKLE_FEED_RELEASE_TAG}` as const;

/** Where a release's archives are downloaded from; the appcast's enclosure
    URLs are this prefix plus the archive's file name. */
export function sparkleArchiveDownloadUrlPrefix(tag: string): string {
  return `${RELEASE_DOWNLOAD_BASE_URL}/${tag}`;
}

export function sparkleAppcastAssetName(channel: DesktopUpdateChannel): string {
  return `appcast-${channel}.xml`;
}

export function sparkleAppcastUrl(channel: DesktopUpdateChannel): string {
  return `${SPARKLE_FEED_BASE_URL}/${sparkleAppcastAssetName(channel)}`;
}
