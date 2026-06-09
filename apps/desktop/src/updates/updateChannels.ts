import type { DesktopUpdateChannel } from "@t3tools/contracts";
import {
  isNightlyDesktopVersion as isNightlyDesktopVersionShared,
  resolveDesktopReleaseTrack,
} from "@t3tools/shared/desktopReleaseTrack";

export { isDevDesktopVersion, isNightlyDesktopVersion } from "@t3tools/shared/desktopReleaseTrack";

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return isNightlyDesktopVersionShared(appVersion) ? "nightly" : "latest";
}

export function isDesktopUpdateVersionAcceptedForChannel(
  version: string,
  channel: DesktopUpdateChannel,
): boolean {
  const releaseTrack = resolveDesktopReleaseTrack(version);
  if (channel === "nightly") {
    return releaseTrack === "nightly" || releaseTrack === "stable";
  }
  return releaseTrack === "stable";
}
