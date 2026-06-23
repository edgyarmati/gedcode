import {
  ORCHESTRATION_STAGE_ROLES,
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
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildOrchestrationConfigUpdate,
  orchestrationSettingsDraftsEqual,
  seedOrchestrationSettingsDraft,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";
import { RoleBackendPicker } from "./RoleBackendPicker";
import { STAGE_ROLE_LABELS } from "./stageRoles";

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
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
      <span className="text-sm font-medium text-foreground">{STAGE_ROLE_LABELS[role]}</span>
      <RoleBackendPicker
        role={role}
        selection={selection}
        instanceEntries={instanceEntries}
        defaultSelection={defaultSelection}
        onSelectionChange={onSelectionChange}
      />
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
