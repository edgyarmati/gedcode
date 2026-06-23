import {
  ORCHESTRATION_STAGE_ROLES,
  ProviderInstanceId,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationStageRole,
  type ProjectId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { newCommandId } from "../../lib/utils";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useServerProviders } from "../../rpc/serverState";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildOrchestrationConfigUpdate,
  orchestrationSettingsDraftsEqual,
  seedOrchestrationSettingsDraft,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";
import { STAGE_ROLE_LABELS } from "./stageRoles";

// "Use the project default backend" — encoded as a sentinel because a Select
// value must be a string and `null` selections mean "inherit the default".
const USE_DEFAULT_VALUE = "__default__";

// The project context the editor needs: identity for dispatch plus the current
// config to seed the form. `SidebarProjectGroupMember` (which extends `Project`)
// is structurally assignable, so the sidebar can pass a member directly.
export interface ProjectOrchestrationSettingsTarget {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly cwd: string;
  readonly environmentLabel?: string | null;
  readonly defaultModelSelection: ModelSelection | null;
  readonly roleModelSelections?: Readonly<Record<string, ModelSelection>> | undefined;
  readonly rolePromptPrefixes?: Readonly<Record<string, string>> | undefined;
}

function backendLabel(selection: ModelSelection, entry: ProviderInstanceEntry | undefined): string {
  const instanceLabel = entry?.displayName ?? String(selection.instanceId);
  return `${instanceLabel} · ${selection.model}`;
}

function RoleConfigRow({
  role,
  selection,
  prefix,
  instanceEntries,
  defaultSelection,
  onSelectionChange,
  onPrefixChange,
}: {
  role: OrchestrationStageRole;
  selection: ModelSelection | null;
  prefix: string;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  defaultSelection: ModelSelection | null;
  onSelectionChange: (role: OrchestrationStageRole, next: ModelSelection | null) => void;
  onPrefixChange: (role: OrchestrationStageRole, next: string) => void;
}) {
  const selectedEntry = selection
    ? instanceEntries.find((entry) => entry.instanceId === selection.instanceId)
    : undefined;
  const defaultEntry = defaultSelection
    ? instanceEntries.find((entry) => entry.instanceId === defaultSelection.instanceId)
    : undefined;
  const defaultOptionLabel = defaultSelection
    ? `Use project default (${backendLabel(defaultSelection, defaultEntry)})`
    : "Use project default";

  const handleInstanceChange = useCallback(
    (value: string) => {
      if (value === USE_DEFAULT_VALUE) {
        onSelectionChange(role, null);
        return;
      }
      const instanceId = ProviderInstanceId.make(value);
      const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
      // Preserve the model when re-selecting the same instance; otherwise adopt
      // the instance's first model. Instances without models can't form a valid
      // selection, so leave the role on its current value.
      const model = selection?.instanceId === instanceId ? selection.model : entry?.models[0]?.slug;
      if (model === undefined) {
        return;
      }
      onSelectionChange(role, { instanceId, model });
    },
    [instanceEntries, onSelectionChange, role, selection],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!selection) {
        return;
      }
      onSelectionChange(role, { instanceId: selection.instanceId, model: value });
    },
    [onSelectionChange, role, selection],
  );

  const modelOptions = selectedEntry?.models ?? [];
  const modelInOptions = modelOptions.some((model) => model.slug === selection?.model);

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
      <span className="text-sm font-medium text-foreground">{STAGE_ROLE_LABELS[role]}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={selection ? String(selection.instanceId) : USE_DEFAULT_VALUE}
          onValueChange={handleInstanceChange}
        >
          <SelectTrigger className="w-full" aria-label={`${STAGE_ROLE_LABELS[role]} backend`}>
            <SelectValue>
              {selection
                ? (selectedEntry?.displayName ?? String(selection.instanceId))
                : "Use project default"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={USE_DEFAULT_VALUE}>
              {defaultOptionLabel}
            </SelectItem>
            {instanceEntries.map((entry) => (
              <SelectItem
                key={String(entry.instanceId)}
                hideIndicator
                value={String(entry.instanceId)}
              >
                {entry.displayName}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {selection ? (
          <Select value={selection.model} onValueChange={handleModelChange}>
            <SelectTrigger className="w-full" aria-label={`${STAGE_ROLE_LABELS[role]} model`}>
              <SelectValue>{selection.model}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              {modelInOptions ? null : (
                <SelectItem hideIndicator value={selection.model}>
                  {selection.model}
                </SelectItem>
              )}
              {modelOptions.map((model) => (
                <SelectItem key={model.slug} hideIndicator value={model.slug}>
                  {model.shortName ?? model.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
      </div>
      <Textarea
        aria-label={`${STAGE_ROLE_LABELS[role]} prompt prefix`}
        placeholder="Optional prompt prefix prepended to this stage's instructions"
        value={prefix}
        rows={2}
        onChange={(event) => onPrefixChange(role, event.target.value)}
      />
    </div>
  );
}

// Project-level per-role orchestration configuration: which backend each stage
// role runs on (or the project default) and an optional per-role prompt prefix.
// Mirrors the project-rename flow — opened from the sidebar project context menu,
// seeded from the project's current config, and saved via a single human-origin
// `project.meta.update` that REPLACES both config maps.
export function ProjectOrchestrationSettingsDialog({
  target,
  onClose,
}: {
  target: ProjectOrchestrationSettingsTarget | null;
  onClose: () => void;
}) {
  const serverProviders = useServerProviders();
  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(serverProviders)),
    [serverProviders],
  );

  const seededDraft = useMemo<OrchestrationSettingsDraft>(
    () =>
      seedOrchestrationSettingsDraft({
        roleModelSelections: target?.roleModelSelections,
        rolePromptPrefixes: target?.rolePromptPrefixes,
      }),
    [target],
  );
  const [draft, setDraft] = useState<OrchestrationSettingsDraft>(seededDraft);
  const [saving, setSaving] = useState(false);

  // Reseed whenever a new project target opens the dialog.
  useEffect(() => {
    setDraft(seededDraft);
  }, [seededDraft]);

  const handleSelectionChange = useCallback(
    (role: OrchestrationStageRole, next: ModelSelection | null) => {
      setDraft((current) => ({
        ...current,
        roleSelections: { ...current.roleSelections, [role]: next },
      }));
    },
    [],
  );
  const handlePrefixChange = useCallback((role: OrchestrationStageRole, next: string) => {
    setDraft((current) => ({
      ...current,
      rolePrefixes: { ...current.rolePrefixes, [role]: next },
    }));
  }, []);

  const dirty = !orchestrationSettingsDraftsEqual(draft, seededDraft);

  const submit = useCallback(async () => {
    if (!target) {
      return;
    }
    const api = readEnvironmentApi(target.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update orchestration settings",
          description: "Project API unavailable.",
        }),
      );
      return;
    }
    const update = buildOrchestrationConfigUpdate(draft);
    setSaving(true);
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: target.id,
        roleModelSelections: update.roleModelSelections,
        rolePromptPrefixes: update.rolePromptPrefixes,
      });
      onClose();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update orchestration settings",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [draft, onClose, target]);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Orchestration settings</DialogTitle>
          <DialogDescription>
            {target
              ? `Choose the backend and prompt prefix for each stage role in ${target.cwd}. Roles left on the project default inherit it.`
              : "Choose the backend and prompt prefix for each stage role."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh] space-y-3 overflow-y-auto">
          {ORCHESTRATION_STAGE_ROLES.map((role) => (
            <RoleConfigRow
              key={role}
              role={role}
              selection={draft.roleSelections[role]}
              prefix={draft.rolePrefixes[role]}
              instanceEntries={instanceEntries}
              defaultSelection={target?.defaultModelSelection ?? null}
              onSelectionChange={handleSelectionChange}
              onPrefixChange={handlePrefixChange}
            />
          ))}
          {target?.environmentLabel ? (
            <p className="text-xs text-muted-foreground">Environment: {target.environmentLabel}</p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void submit()}>
            Save
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
