import {
  ORCHESTRATION_STAGE_ROLES,
  type EnvironmentId,
  type ModelSelection,
  type OrchestratorConfigJson,
  type OrchestratorGatePolicy,
  type OrchestratorResourceLimits,
  type OrchestrationStageRole,
  type ProjectId,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

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
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildOrchestrationConfigUpdate,
  CANONICAL_ORCHESTRATOR_STAGE_ORDER,
  EDITABLE_ORCHESTRATOR_GATES,
  MANDATORY_ORCHESTRATOR_STAGES,
  orchestrationSettingsDraftsEqual,
  seedOrchestrationSettingsDraft,
  type EditableOrchestratorGate,
  type OptionalOrchestratorStage,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";
import { BackendModelPicker, RoleBackendPicker } from "./RoleBackendPicker";
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

const GATE_POLICY_LABELS: Record<OrchestratorGatePolicy, string> = {
  auto: "Auto",
  "require-approval": "Require approval",
};

const RESOURCE_LIMIT_LABELS: Record<ResourceLimitNumberKey, string> = {
  maxParallelTasks: "Max parallel tasks",
  maxParallelWorkers: "Max parallel workers",
  maxStageHandoffs: "Max stage handoffs",
  maxRetriesPerStage: "Max retries per stage",
};

type ResourceLimitNumberKey = Exclude<keyof OrchestratorResourceLimits, "allowFullAccessWorkers">;

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
  onSelectionChange,
}: {
  selection: ModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  onSelectionChange: (next: ModelSelection | null) => void;
}) {
  return (
    <SettingsSection title="PM model" description="Provider instance and model used by the PM.">
      <BackendModelPicker
        selection={selection}
        instanceEntries={instanceEntries}
        unsetLabel="None"
        unsetOptionLabel="None"
        backendAriaLabel="PM backend"
        modelAriaLabel="PM model"
        onSelectionChange={onSelectionChange}
      />
    </SettingsSection>
  );
}

function StagesSection({
  optionalStages,
  onOptionalStageChange,
}: {
  optionalStages: Readonly<Record<OptionalOrchestratorStage, boolean>>;
  onOptionalStageChange: (stage: OptionalOrchestratorStage, enabled: boolean) => void;
}) {
  const mandatoryStageSet = new Set<OrchestrationStageRole>(MANDATORY_ORCHESTRATOR_STAGES);
  return (
    <SettingsSection title="Stages" description="Classify, plan, and work always run.">
      <div className="grid gap-2">
        {CANONICAL_ORCHESTRATOR_STAGE_ORDER.map((stage) => {
          const mandatory = mandatoryStageSet.has(stage);
          const checked = mandatory || optionalStages[stage as OptionalOrchestratorStage];
          return (
            <label
              key={stage}
              className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm"
            >
              <span>{STAGE_ROLE_LABELS[stage]}</span>
              <Switch
                checked={checked}
                disabled={mandatory}
                aria-label={`${STAGE_ROLE_LABELS[stage]} stage`}
                onCheckedChange={(next) =>
                  mandatory
                    ? undefined
                    : onOptionalStageChange(stage as OptionalOrchestratorStage, Boolean(next))
                }
              />
            </label>
          );
        })}
      </div>
    </SettingsSection>
  );
}

function GateAutonomySection({
  gatePolicy,
  onGatePolicyChange,
}: {
  gatePolicy: Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>;
  onGatePolicyChange: (gate: EditableOrchestratorGate, policy: OrchestratorGatePolicy) => void;
}) {
  return (
    <SettingsSection title="Gate autonomy">
      <div className="grid gap-2">
        {EDITABLE_ORCHESTRATOR_GATES.map((gate) => (
          <div
            key={gate}
            className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_12rem] sm:items-center"
          >
            <span>{STAGE_ROLE_LABELS[gate]}</span>
            <Select
              value={gatePolicy[gate]}
              onValueChange={(value) => {
                if (value === "auto" || value === "require-approval") {
                  onGatePolicyChange(gate, value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={`${STAGE_ROLE_LABELS[gate]} gate autonomy`}>
                <SelectValue>{GATE_POLICY_LABELS[gatePolicy[gate]]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="auto">
                  {GATE_POLICY_LABELS.auto}
                </SelectItem>
                <SelectItem hideIndicator value="require-approval">
                  {GATE_POLICY_LABELS["require-approval"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
          <span>Land</span>
          <span className="text-muted-foreground">Require approval (always)</span>
        </div>
      </div>
    </SettingsSection>
  );
}

function ResourceLimitsSection({
  resourceLimits,
  onNumberLimitChange,
  onAllowFullAccessWorkersChange,
}: {
  resourceLimits: OrchestratorResourceLimits;
  onNumberLimitChange: (key: ResourceLimitNumberKey, value: number) => void;
  onAllowFullAccessWorkersChange: (enabled: boolean) => void;
}) {
  const numberKeys = Object.keys(RESOURCE_LIMIT_LABELS) as ResourceLimitNumberKey[];
  return (
    <SettingsSection
      title="Resource limits"
      description="Hard limits enforced by the orchestration runtime."
    >
      <div className="grid gap-2">
        {numberKeys.map((key) => (
          <label
            key={key}
            className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_7rem] sm:items-center"
          >
            <span>{RESOURCE_LIMIT_LABELS[key]}</span>
            <Input
              nativeInput
              type="number"
              min={1}
              step={1}
              value={resourceLimits[key]}
              aria-label={RESOURCE_LIMIT_LABELS[key]}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onNumberLimitChange(key, Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
              }}
            />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
          <span>Allow full-access workers safety opt-in</span>
          <Switch
            checked={resourceLimits.allowFullAccessWorkers}
            aria-label="Allow full-access workers safety opt-in"
            onCheckedChange={(checked) => onAllowFullAccessWorkersChange(Boolean(checked))}
          />
        </label>
      </div>
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
  const handleOptionalStageChange = useCallback(
    (stage: OptionalOrchestratorStage, enabled: boolean) => {
      setDraft((current) => ({
        ...current,
        orchestratorConfig: {
          ...current.orchestratorConfig,
          optionalStages: { ...current.orchestratorConfig.optionalStages, [stage]: enabled },
        },
      }));
    },
    [],
  );
  const handleGatePolicyChange = useCallback(
    (gate: EditableOrchestratorGate, policy: OrchestratorGatePolicy) => {
      setDraft((current) => ({
        ...current,
        orchestratorConfig: {
          ...current.orchestratorConfig,
          gatePolicy: { ...current.orchestratorConfig.gatePolicy, [gate]: policy },
        },
      }));
    },
    [],
  );
  const handleNumberLimitChange = useCallback((key: ResourceLimitNumberKey, value: number) => {
    setDraft((current) => ({
      ...current,
      orchestratorConfig: {
        ...current.orchestratorConfig,
        resourceLimits: { ...current.orchestratorConfig.resourceLimits, [key]: value },
      },
    }));
  }, []);
  const handleAllowFullAccessWorkersChange = useCallback((enabled: boolean) => {
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
            onSelectionChange={handlePmModelSelectionChange}
          />
          <StagesSection
            optionalStages={draft.orchestratorConfig.optionalStages}
            onOptionalStageChange={handleOptionalStageChange}
          />
          <GateAutonomySection
            gatePolicy={draft.orchestratorConfig.gatePolicy}
            onGatePolicyChange={handleGatePolicyChange}
          />
          <ResourceLimitsSection
            resourceLimits={draft.orchestratorConfig.resourceLimits}
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
                  defaultSelection={target?.defaultModelSelection ?? null}
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
