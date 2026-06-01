import {
  type EnvironmentId,
  type EditorId,
  type GedWorkflowState,
  type ModelSelection,
  type ProjectScript,
  type ProviderInstanceId,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { memo, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { DiffIcon, SettingsIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { ProviderModelPicker } from "./ProviderModelPicker";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { WorkflowStatusBadge } from "./WorkflowStatusBadge";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import type { ProviderInstanceEntry } from "../../providerInstances";
import type { ModelEsque } from "./providerIconUtils";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  workflowState: GedWorkflowState | null;
  projectGedMainModelSelection: ModelSelection | null;
  resolvedGedMainModelSelection: ModelSelection | null;
  gedModelInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  gedModelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onSetProjectGedMainModel: (selection: ModelSelection | null) => Promise<void> | void;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  workflowState,
  projectGedMainModelSelection,
  resolvedGedMainModelSelection,
  gedModelInstanceEntries,
  gedModelOptionsByInstance,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onSetProjectGedMainModel,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-hidden sm:flex-1 sm:flex-nowrap sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge
            variant="outline"
            className="min-w-0 max-w-full shrink overflow-hidden sm:max-w-56"
          >
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <WorkflowStatusBadge state={workflowState} />
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:shrink-0 sm:justify-end @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && resolvedGedMainModelSelection && (
          <ProjectGedModelSettingsControl
            projectGedMainModelSelection={projectGedMainModelSelection}
            resolvedGedMainModelSelection={resolvedGedMainModelSelection}
            instanceEntries={gedModelInstanceEntries}
            modelOptionsByInstance={gedModelOptionsByInstance}
            onSetProjectGedMainModel={onSetProjectGedMainModel}
          />
        )}
        {activeProjectName && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo && !diffOpen}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo && !diffOpen
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});

function ProjectGedModelSettingsControl({
  projectGedMainModelSelection,
  resolvedGedMainModelSelection,
  instanceEntries,
  modelOptionsByInstance,
  onSetProjectGedMainModel,
}: {
  projectGedMainModelSelection: ModelSelection | null;
  resolvedGedMainModelSelection: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  onSetProjectGedMainModel: (selection: ModelSelection | null) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="outline" size="xs" className="shrink-0" onClick={() => setOpen(true)}>
              <SettingsIcon className="size-3" />
              <span className="hidden @4xl/header-actions:inline">Ged models</span>
            </Button>
          }
        />
        <TooltipPopup side="bottom">Configure this project's Ged model overrides</TooltipPopup>
      </Tooltip>
      <DialogPopup>
        <DialogPanel className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Project Ged models</DialogTitle>
            <DialogDescription>
              Override the main Ged provider/model default for this project. Per-role custom models
              are disabled; subagents are created by the selected harness when available.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <ProjectGedModelRow
              title="Main Ged thread"
              description="Used when creating new Ged parent threads for this project."
              hasOverride={projectGedMainModelSelection !== null}
              selection={projectGedMainModelSelection ?? resolvedGedMainModelSelection}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              onSelect={(instanceId, model) => onSetProjectGedMainModel({ instanceId, model })}
              onReset={() => onSetProjectGedMainModel(null)}
            />
            <div className="rounded-lg border border-border/60 p-3 text-muted-foreground text-xs">
              Per-role custom models are disabled. Use the selected harness/provider's native
              subagents when available; otherwise the main thread performs the workflow steps.
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ProjectGedModelRow({
  title,
  description,
  hasOverride,
  selection,
  instanceEntries,
  modelOptionsByInstance,
  onSelect,
  onReset,
  disabled = false,
}: {
  title: string;
  description: string;
  hasOverride: boolean;
  selection: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  onSelect: (instanceId: ProviderInstanceId, model: string) => Promise<void> | void;
  onReset: () => Promise<void> | void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-muted-foreground text-xs">{description}</div>
        <div className="text-muted-foreground text-[11px]">
          {hasOverride ? "Project override" : "Inherits global/default value"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {hasOverride && !disabled && (
          <Button variant="ghost" size="xs" onClick={onReset}>
            Reset
          </Button>
        )}
        <ProviderModelPicker
          activeInstanceId={selection.instanceId}
          model={selection.model}
          lockedProvider={null}
          instanceEntries={instanceEntries}
          modelOptionsByInstance={modelOptionsByInstance}
          triggerVariant="outline"
          triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
          disabled={disabled}
          onInstanceModelChange={onSelect}
        />
      </div>
    </div>
  );
}
