import {
  type EnvironmentId,
  type OrchestratorLaunchCapabilities,
  type OrchestratorLaunchOperation,
  type OrchestratorLaunchTarget,
} from "@t3tools/contracts";
import {
  ChevronDownIcon,
  FolderClosedIcon,
  LoaderCircleIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { usePreferredEditor } from "../../editorPreferences";
import { readEnvironmentApi } from "../../environmentApi";
import { resolveAvailableEditorOptions } from "../editorOptions";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";

const EMPTY_CAPABILITIES: OrchestratorLaunchCapabilities = {
  editors: [],
  reveal: false,
  terminal: false,
};

export function OrchestratorLaunchPicker({
  disabled = false,
  disabledReason,
  environmentId,
  target,
}: {
  disabled?: boolean;
  disabledReason?: string | undefined;
  environmentId: EnvironmentId;
  target: OrchestratorLaunchTarget;
}) {
  const [capabilities, setCapabilities] = useState<OrchestratorLaunchCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const availableEditors = capabilities?.editors ?? EMPTY_CAPABILITIES.editors;
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const editorOptions = useMemo(
    () => resolveAvailableEditorOptions(navigator.platform, availableEditors),
    [availableEditors],
  );
  const primaryOption = editorOptions.find((option) => option.value === preferredEditor) ?? null;

  useEffect(() => {
    let active = true;
    setCapabilities(null);
    setCapabilityError(null);
    const api = readEnvironmentApi(environmentId);
    const getLaunchCapabilities = api?.orchestrator.getLaunchCapabilities;
    if (!api || typeof getLaunchCapabilities !== "function") {
      setCapabilityError("Workspace launch is unsupported in this environment.");
      return () => {
        active = false;
      };
    }
    void getLaunchCapabilities()
      .then((value) => {
        if (active) setCapabilities(value);
      })
      .catch((error: unknown) => {
        if (active) {
          setCapabilityError(
            error instanceof Error ? error.message : "Launch capabilities are unavailable.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [environmentId]);

  const launch = useCallback(
    async (operation: OrchestratorLaunchOperation) => {
      const api = readEnvironmentApi(environmentId);
      const launchWorkspace = api?.orchestrator.launch;
      if (!api || typeof launchWorkspace !== "function" || launching || disabled) return;
      if (operation.kind === "editor") setPreferredEditor(operation.editor);
      setLaunching(true);
      try {
        await launchWorkspace({ target, operation });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not open workspace",
            description: error instanceof Error ? error.message : "The launcher failed.",
          }),
        );
      } finally {
        setLaunching(false);
      }
    },
    [disabled, environmentId, launching, setPreferredEditor, target],
  );

  const hasMenuAction =
    editorOptions.length > 0 || capabilities?.reveal === true || capabilities?.terminal === true;
  const controlsDisabled = disabled || capabilities === null || launching;
  const primaryDisabled = controlsDisabled || primaryOption === null;
  const menuDisabled = controlsDisabled || !hasMenuAction;
  const unavailableReason =
    disabledReason ??
    capabilityError ??
    (capabilities === null
      ? "Checking available applications…"
      : "No supported application is available in this environment.");
  const primaryLabel = primaryOption ? `Open in ${primaryOption.label}` : unavailableReason;

  return (
    <Group aria-label="Open workspace">
      <Button
        aria-label={primaryLabel}
        data-testid="orchestrator-launch-primary"
        disabled={primaryDisabled}
        onClick={() => {
          if (preferredEditor) void launch({ kind: "editor", editor: preferredEditor });
        }}
        size="sm"
        title={primaryLabel}
        variant="outline"
      >
        {launching ? (
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        ) : primaryOption ? (
          <primaryOption.Icon aria-hidden="true" className="size-4" />
        ) : null}
        Open
      </Button>
      <GroupSeparator />
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label="Open workspace options"
              data-testid="orchestrator-launch-menu"
              disabled={menuDisabled}
              size="icon-sm"
              title={menuDisabled ? unavailableReason : "Open workspace options"}
              variant="outline"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {editorOptions.map(({ label, Icon, value }) => (
            <MenuItem key={value} onClick={() => void launch({ kind: "editor", editor: value })}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {label}
            </MenuItem>
          ))}
          {editorOptions.length > 0 &&
          (capabilities?.reveal === true || capabilities?.terminal === true) ? (
            <MenuSeparator />
          ) : null}
          {capabilities?.reveal === true ? (
            <MenuItem onClick={() => void launch({ kind: "reveal" })}>
              <FolderClosedIcon aria-hidden="true" />
              Reveal in file manager
            </MenuItem>
          ) : null}
          {capabilities?.terminal === true ? (
            <MenuItem onClick={() => void launch({ kind: "terminal" })}>
              <SquareTerminalIcon aria-hidden="true" />
              Open terminal
            </MenuItem>
          ) : null}
          {!hasMenuAction ? <MenuItem disabled>{unavailableReason}</MenuItem> : null}
        </MenuPopup>
      </Menu>
    </Group>
  );
}
