export type DesktopReleaseTrack = "stable" | "nightly" | "dev";

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;
const DEV_VERSION_PATTERN = /-dev(?:[.-][0-9A-Za-z.-]+)?$/;

export function resolveDesktopReleaseTrack(version: string): DesktopReleaseTrack {
  if (NIGHTLY_VERSION_PATTERN.test(version)) {
    return "nightly";
  }

  if (DEV_VERSION_PATTERN.test(version)) {
    return "dev";
  }

  return "stable";
}

export function isNightlyDesktopVersion(version: string): boolean {
  return resolveDesktopReleaseTrack(version) === "nightly";
}

export function isDevDesktopVersion(version: string): boolean {
  return resolveDesktopReleaseTrack(version) === "dev";
}
