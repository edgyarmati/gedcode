import type { DesktopUpdateState } from "@t3tools/contracts";

const DESKTOP_UPDATE_RELEASES_URL = "https://github.com/edgyarmati/gedcode/releases";

export type DesktopUpdateButtonAction = "open" | "none";

export function getDesktopUpdateDownloadPageUrl(state: DesktopUpdateState): string {
  if (state.channel === "latest") {
    return `${DESKTOP_UPDATE_RELEASES_URL}/latest`;
  }
  return DESKTOP_UPDATE_RELEASES_URL;
}

export function resolveDesktopUpdateButtonAction(
  state: DesktopUpdateState,
): DesktopUpdateButtonAction {
  if (state.availableVersion || state.downloadedVersion || state.status === "available") {
    return "open";
  }
  if (state.status === "error") {
    if (state.availableVersion || state.downloadedVersion) {
      return "open";
    }
  }
  return "none";
}

export function shouldShowDesktopUpdateButton(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) {
    return false;
  }
  if (state.status === "downloading") {
    return true;
  }
  return resolveDesktopUpdateButtonAction(state) !== "none";
}

export function shouldShowArm64IntelBuildWarning(state: DesktopUpdateState | null): boolean {
  return state?.hostArch === "arm64" && state.appArch === "x64";
}

export function isDesktopUpdateButtonDisabled(state: DesktopUpdateState | null): boolean {
  return state?.status === "downloading";
}

export function getArm64IntelBuildWarningDescription(state: DesktopUpdateState): string {
  if (!shouldShowArm64IntelBuildWarning(state)) {
    return "This install is using the correct architecture.";
  }

  if (resolveDesktopUpdateButtonAction(state) === "open") {
    return "This Mac has Apple Silicon, but GedCode is still running the Intel build under Rosetta. Open the download page for the available update to switch to the native Apple Silicon build.";
  }
  return "This Mac has Apple Silicon, but GedCode is still running the Intel build under Rosetta. The next app update will replace it with the native Apple Silicon build.";
}

export function getDesktopUpdateButtonTooltip(state: DesktopUpdateState): string {
  if (state.status === "available") {
    return `Update ${state.availableVersion ?? "available"} available. Click to open the download page.`;
  }
  if (state.status === "downloading") {
    const progress =
      typeof state.downloadPercent === "number" ? ` (${Math.floor(state.downloadPercent)}%)` : "";
    return `Downloading update${progress}`;
  }
  if (state.status === "downloaded") {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? "ready"} is available. Click to open the download page.`;
  }
  if (state.status === "error") {
    if (state.availableVersion) {
      return `Update ${state.availableVersion} is available. Click to open the download page.`;
    }
    if (state.downloadedVersion) {
      return `Update ${state.downloadedVersion} is available. Click to open the download page.`;
    }
    return state.message ?? "Update failed";
  }
  return "Up to date";
}

export function shouldHighlightDesktopUpdateError(state: DesktopUpdateState | null): boolean {
  if (!state || state.status !== "error") return false;
  return state.errorContext === "download" || state.errorContext === "install";
}

export function canCheckForUpdate(state: DesktopUpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return (
    state.status !== "checking" &&
    state.status !== "downloading" &&
    state.status !== "downloaded" &&
    state.status !== "disabled"
  );
}
