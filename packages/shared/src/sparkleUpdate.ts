import { resolveDesktopReleaseTrack } from "./desktopReleaseTrack.ts";

export const SPARKLE_FRAMEWORK_VERSION = "2.9.6";
export const SPARKLE_ED_PUBLIC_KEY = "OEqTyWgHzGWLdI/c38qOQw+fwKdK+npBmpSEum8e4U4=";
export const SPARKLE_FEED_RELEASE_TAG = "sparkle-feed";

const SPARKLE_RELEASE_BASE_URL =
  `https://github.com/edgyarmati/gedcode/releases/download/${SPARKLE_FEED_RELEASE_TAG}` as const;

export type SparkleUpdateChannel = "latest" | "nightly";

export function resolveSparkleUpdateChannel(version: string): SparkleUpdateChannel | null {
  const track = resolveDesktopReleaseTrack(version);
  if (track === "dev") return null;
  return track === "nightly" ? "nightly" : "latest";
}

export function sparkleAppcastAssetName(channel: SparkleUpdateChannel): string {
  return `appcast-${channel}.xml`;
}

export function sparkleAppcastUrl(channel: SparkleUpdateChannel): string {
  return `${SPARKLE_RELEASE_BASE_URL}/${sparkleAppcastAssetName(channel)}`;
}

export function resolveSparkleAppcastUrl(version: string): string | null {
  const channel = resolveSparkleUpdateChannel(version);
  return channel === null ? null : sparkleAppcastUrl(channel);
}
