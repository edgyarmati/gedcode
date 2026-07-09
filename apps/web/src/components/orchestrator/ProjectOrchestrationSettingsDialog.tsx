import {
  ORCHESTRATION_STAGE_ROLES,
  type EnvironmentId,
  type ModelSelection,
  type OrchestratorConfigJson,
  type OrchestrationStageRole,
  type ProjectId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { useSettings } from "../../hooks/useSettings";
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
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildOrchestrationConfigUpdate,
  orchestrationSettingsDraftsEqual,
  resolveRoleDefaultSelection,
  seedOrchestratorInheritedDefaultsDraft,
  seedOrchestrationSettingsDraft,
  type InheritableOrchestratorResourceLimits,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";
import {
  ProjectOpenPrModeControl,
  ProjectOrchestratorResourceLimitsControl,
  type ProjectResourceLimitNumberKey,
} from "./OrchestratorConfigControls";
import { BackendModelPicker, backendLabel, RoleBackendPicker } from "./RoleBackendPicker";
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
  readonly orchestratorConfig?: OrchestratorConfigJson | undefined;
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
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

function EnabledSection({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <SettingsSection title="Enabled">
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Run orchestrator mode for this project</span>
        <Switch
          checked={enabled}
          aria-label="Enable orchestrator mode"
          onCheckedChange={(checked) => onEnabledChange(Boolean(checked))}
        />
      </label>
    </SettingsSection>
  );
}

function PmModelSection({
  selection,
  instanceEntries,
  defaultSelection,
  onSelectionChange,
}: {
  selection: ModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  defaultSelection: ModelSelection | null;
  onSelectionChange: (next: ModelSelection | null) => void;
}) {
  const defaultEntry = defaultSelection
    ? instanceEntries.find((entry) => entry.instanceId === defaultSelection.instanceId)
    : undefined;
  const defaultLabel = defaultSelection ? backendLabel(defaultSelection, defaultEntry) : null;
  const unsetOptionLabel = defaultLabel
    ? `Use global default (${defaultLabel})`
    : "Use global default";

  return (
    <SettingsSection title="PM model" description="Provider instance and model used by the PM.">
      <BackendModelPicker
        selection={selection}
        instanceEntries={instanceEntries}
        unsetLabel="Use global default"
        unsetOptionLabel={unsetOptionLabel}
        backendAriaLabel="PM backend"
        modelAriaLabel="PM model"
        onSelectionChange={onSelectionChange}
      />
    </SettingsSection>
  );
}

function ResourceLimitsSection({
  resourceLimits,
  inheritedResourceLimits,
  onNumberLimitChange,
  onAllowFullAccessWorkersChange,
}: {
  resourceLimits: InheritableOrchestratorResourceLimits;
  inheritedResourceLimits: {
    readonly maxParallelTasks: number;
    readonly maxParallelWorkers: number;
    readonly maxStageHandoffs: number;
    readonly maxRetriesPerStage: number;
    readonly allowFullAccessWorkers: boolean;
  };
  onNumberLimitChange: (key: ProjectResourceLimitNumberKey, value: number | null) => void;
  onAllowFullAccessWorkersChange: (enabled: boolean | null) => void;
}) {
  return (
    <SettingsSection
      title="Resource limits"
      description="Hard limits enforced by the orchestration runtime."
    >
      <ProjectOrchestratorResourceLimitsControl
        resourceLimits={resourceLimits}
        inheritedResourceLimits={inheritedResourceLimits}
        onNumberLimitChange={onNumberLimitChange}
        onAllowFullAccessWorkersChange={onAllowFullAccessWorkersChange}
      />
    </SettingsSection>
  );
}

function LandingPrSection({
  openPrAsDraft,
  inheritedOpenPrAsDraft,
  onOpenPrAsDraftChange,
}: {
  openPrAsDraft: boolean | null;
  inheritedOpenPrAsDraft: boolean;
  onOpenPrAsDraftChange: (openPrAsDraft: boolean | null) => void;
}) {
  return (
    <SettingsSection
      title="Auto-create PRs"
      description="When work is approved for landing, choose whether the created pull request starts ready or draft."
    >
      <ProjectOpenPrModeControl
        openPrAsDraft={openPrAsDraft}
        inheritedOpenPrAsDraft={inheritedOpenPrAsDraft}
        onOpenPrAsDraftChange={onOpenPrAsDraftChange}
      />
    </SettingsSection>
  );
}

// Project-level orchestration configuration. Mirrors the project-rename flow —
// opened from the sidebar project context menu, seeded from the project's
// current config, and saved via a single human-origin `project.meta.update` that
// REPLACES the edited config maps.
export function ProjectOrchestrationSettingsDialog({
  target,
  onClose,
}: {
  target: ProjectOrchestrationSettingsTarget | null;
  onClose: () => void;
}) {
  const orchestratorDefaults = useSettings((settings) => settings.orchestratorDefaults);
  const inheritedDefaults = useMemo(
    () => seedOrchestratorInheritedDefaultsDraft(orchestratorDefaults),
    [orchestratorDefaults],
  );
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
        orchestratorConfig: target?.orchestratorConfig,
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
  const handleEnabledChange = useCallback((enabled: boolean) => {
    setDraft((current) => ({
      ...current,
      orchestratorConfig: { ...current.orchestratorConfig, enabled },
    }));
  }, []);
  const handlePmModelSelectionChange = useCallback((next: ModelSelection | null) => {
    setDraft((current) => ({
      ...current,
      orchestratorConfig: { ...current.orchestratorConfig, pmModelSelection: next },
    }));
  }, []);
  const handleOpenPrAsDraftChange = useCallback((openPrAsDraft: boolean | null) => {
    setDraft((current) => ({
      ...current,
      orchestratorConfig: { ...current.orchestratorConfig, openPrAsDraft },
    }));
  }, []);
  const handleNumberLimitChange = useCallback(
    (key: ProjectResourceLimitNumberKey, value: number | null) => {
      setDraft((current) => ({
        ...current,
        orchestratorConfig: {
          ...current.orchestratorConfig,
          resourceLimits: { ...current.orchestratorConfig.resourceLimits, [key]: value },
        },
      }));
    },
    [],
  );
  const handleAllowFullAccessWorkersChange = useCallback((enabled: boolean | null) => {
    setDraft((current) => ({
      ...current,
      orchestratorConfig: {
        ...current.orchestratorConfig,
        resourceLimits: {
          ...current.orchestratorConfig.resourceLimits,
          allowFullAccessWorkers: enabled,
        },
      },
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
        orchestratorConfig: update.orchestratorConfig,
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
              ? `Edit Orchestrator settings for ${target.cwd}. Roles left on the project default inherit it.`
              : "Edit Orchestrator settings for this project."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh] space-y-3 overflow-y-auto">
          <EnabledSection
            enabled={draft.orchestratorConfig.enabled}
            onEnabledChange={handleEnabledChange}
          />
          <PmModelSection
            selection={draft.orchestratorConfig.pmModelSelection}
            instanceEntries={instanceEntries}
            defaultSelection={inheritedDefaults.pmModelSelection}
            onSelectionChange={handlePmModelSelectionChange}
          />
          <LandingPrSection
            openPrAsDraft={draft.orchestratorConfig.openPrAsDraft}
            inheritedOpenPrAsDraft={inheritedDefaults.openPrAsDraft}
            onOpenPrAsDraftChange={handleOpenPrAsDraftChange}
          />
          <ResourceLimitsSection
            resourceLimits={draft.orchestratorConfig.resourceLimits}
            inheritedResourceLimits={inheritedDefaults.resourceLimits}
            onNumberLimitChange={handleNumberLimitChange}
            onAllowFullAccessWorkersChange={handleAllowFullAccessWorkersChange}
          />
          <SettingsSection
            title="Stage backends and prompt prefixes"
            description="Roles left on the project default inherit it."
          >
            <div className="space-y-3">
              {ORCHESTRATION_STAGE_ROLES.map((role) => (
                <RoleConfigRow
                  key={role}
                  role={role}
                  selection={draft.roleSelections[role]}
                  prefix={draft.rolePrefixes[role]}
                  instanceEntries={instanceEntries}
                  defaultSelection={
                    target
                      ? resolveRoleDefaultSelection(target, {
                          defaultWorkerModelSelection:
                            inheritedDefaults.defaultWorkerModelSelection,
                        })
                      : inheritedDefaults.defaultWorkerModelSelection
                  }
                  onSelectionChange={handleSelectionChange}
                  onPrefixChange={handlePrefixChange}
                />
              ))}
            </div>
          </SettingsSection>
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
