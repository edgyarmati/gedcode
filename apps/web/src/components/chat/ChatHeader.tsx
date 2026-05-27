import {
  type EnvironmentId,
  type EditorId,
  type GedSubagentRole,
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
import { GED_ROLE_DISPLAY } from "../../gedWorkflowRoles";
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
  projectGedRoleModelSelections: Readonly<Record<string, ModelSelection>>;
  resolvedGedRoleModelSelections: Readonly<Record<string, ModelSelection>>;
  gedModelInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  gedModelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onSetProjectGedMainModel: (selection: ModelSelection | null) => Promise<void> | void;
  onSetProjectGedRoleModel: (
    role: GedSubagentRole,
    selection: ModelSelection | null,
  ) => Promise<void> | void;
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
  projectGedRoleModelSelections,
  resolvedGedRoleModelSelections,
  gedModelInstanceEntries,
  gedModelOptionsByInstance,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onSetProjectGedMainModel,
  onSetProjectGedRoleModel,
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
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
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
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
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
            projectGedRoleModelSelections={projectGedRoleModelSelections}
            resolvedGedRoleModelSelections={resolvedGedRoleModelSelections}
            instanceEntries={gedModelInstanceEntries}
            modelOptionsByInstance={gedModelOptionsByInstance}
            onSetProjectGedMainModel={onSetProjectGedMainModel}
            onSetProjectGedRoleModel={onSetProjectGedRoleModel}
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
  projectGedRoleModelSelections,
  resolvedGedRoleModelSelections,
  instanceEntries,
  modelOptionsByInstance,
  onSetProjectGedMainModel,
  onSetProjectGedRoleModel,
}: {
  projectGedMainModelSelection: ModelSelection | null;
  resolvedGedMainModelSelection: ModelSelection;
  projectGedRoleModelSelections: Readonly<Record<string, ModelSelection>>;
  resolvedGedRoleModelSelections: Readonly<Record<string, ModelSelection>>;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  onSetProjectGedMainModel: (selection: ModelSelection | null) => Promise<void> | void;
  onSetProjectGedRoleModel: (
    role: GedSubagentRole,
    selection: ModelSelection | null,
  ) => Promise<void> | void;
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
              Override global Ged provider/model defaults for this project. Explorer is runtime
              active now; other roles are configuration for upcoming orchestration slices.
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
            {GED_ROLE_DISPLAY.map((roleMeta) => {
              const resolved = resolvedGedRoleModelSelections[roleMeta.role];
              if (!resolved) return null;
              const override = projectGedRoleModelSelections[roleMeta.role] ?? null;
              return (
                <ProjectGedModelRow
                  key={roleMeta.role}
                  title={`Ged ${roleMeta.label.toLowerCase()}`}
                  description={`${roleMeta.description} ${
                    roleMeta.runtimeStatus === "active"
                      ? "Runtime active now."
                      : "Configuration-only for now."
                  }`}
                  hasOverride={override !== null}
                  selection={override ?? resolved}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  onSelect={(instanceId, model) =>
                    onSetProjectGedRoleModel(roleMeta.role, { instanceId, model })
                  }
                  onReset={() => onSetProjectGedRoleModel(roleMeta.role, null)}
                />
              );
            })}
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
}: {
  title: string;
  description: string;
  hasOverride: boolean;
  selection: ModelSelection;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  onSelect: (instanceId: ProviderInstanceId, model: string) => Promise<void> | void;
  onReset: () => Promise<void> | void;
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
        {hasOverride && (
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
          onInstanceModelChange={onSelect}
        />
      </div>
    </div>
  );
}
