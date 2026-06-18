import { ExternalLinkIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { isElectron } from "../../env";
import { ensureLocalApi } from "../../localApi";
import { useDesktopUpdateState } from "../../lib/desktopUpdateReactQuery";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDownloadPageUrl,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
} from "../desktopUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarUpdatePill() {
  const state = useDesktopUpdateState().data ?? null;
  const [dismissed, setDismissed] = useState(false);

  const visible = isElectron && shouldShowDesktopUpdateButton(state) && !dismissed;
  const tooltip = state ? getDesktopUpdateButtonTooltip(state) : "Update available";
  const disabled = isDesktopUpdateButtonDisabled(state);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";

  const showArm64Warning = isElectron && shouldShowArm64IntelBuildWarning(state);
  const arm64Description =
    state && showArm64Warning ? getArm64IntelBuildWarningDescription(state) : null;

  const handleAction = useCallback(() => {
    if (!state) return;
    if (disabled || action === "none") return;

    const downloadPageUrl = getDesktopUpdateDownloadPageUrl(state);
    void ensureLocalApi()
      .shell.openExternal(downloadPageUrl)
      .catch((error) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open update page",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
  }, [action, disabled, state]);

  if (!visible && !showArm64Warning) return null;

  return (
    <div className="flex flex-col gap-1">
      {showArm64Warning && arm64Description && (
        <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8 text-xs">
          <TriangleAlertIcon />
          <AlertTitle>Intel build on Apple Silicon</AlertTitle>
          <AlertDescription>{arm64Description}</AlertDescription>
        </Alert>
      )}
      {visible && (
        <div
          className={`group/update relative flex h-7 w-full items-center rounded-lg bg-primary/15 text-xs font-medium text-primary ${
            disabled ? " cursor-not-allowed opacity-60" : ""
          }`}
        >
          <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.update-main:hover]/update:bg-primary/22" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={tooltip}
                  aria-disabled={disabled || undefined}
                  disabled={disabled}
                  className="update-main relative flex h-full flex-1 items-center gap-2 px-2 enabled:cursor-pointer"
                  onClick={handleAction}
                >
                  <>
                    <ExternalLinkIcon className="size-3.5" />
                    <span>Update available</span>
                  </>
                </button>
              }
            />
            <TooltipPopup side="top">{tooltip}</TooltipPopup>
          </Tooltip>
          {action === "open" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Dismiss update"
                    className="mr-1 inline-flex size-5 items-center justify-center rounded-md text-primary/60 transition-colors hover:text-primary"
                    onClick={() => setDismissed(true)}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                }
              />
              <TooltipPopup side="top">Dismiss until next launch</TooltipPopup>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
