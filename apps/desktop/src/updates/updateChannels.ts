import type { DesktopUpdateChannel } from "@t3tools/contracts";
import { isNightlyDesktopVersion as isNightlyDesktopVersionShared } from "@t3tools/shared/desktopReleaseTrack";

export { isDevDesktopVersion, isNightlyDesktopVersion } from "@t3tools/shared/desktopReleaseTrack";

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return isNightlyDesktopVersionShared(appVersion) ? "nightly" : "latest";
}
