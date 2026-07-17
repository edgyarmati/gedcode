import {
  ORCHESTRATION_CAPABILITY_TIERS,
  ORCHESTRATION_STAGE_ROLES,
  type EnvironmentId,
  type OrchestrationCapabilityTier,
  type OrchestrationStageRole,
} from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { useSettings } from "../../hooks/useSettings";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useServerProviders } from "../../rpc/serverState";
import type { OrchestratorTask, Project } from "../../types";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { backendLabel } from "./RoleBackendPicker";
import { CAPABILITY_PRESET_COPY } from "./CapabilityPresetCard";
import {
  seedOrchestratorConfigDraft,
  seedOrchestratorInheritedDefaultsDraft,
} from "./projectOrchestrationSettings.logic";
import { STAGE_ROLE_LABELS } from "./stageRoles";

export function taskCapabilityTiersAfterChange(input: {
  readonly current: OrchestratorTask["roleCapabilityTiers"];
  readonly role: OrchestrationStageRole;
  readonly tier: OrchestrationCapabilityTier | null;
}): Partial<Record<OrchestrationStageRole, OrchestrationCapabilityTier>> {
  return Object.fromEntries(
    ORCHESTRATION_STAGE_ROLES.flatMap((role) => {
      const tier = role === input.role ? input.tier : input.current?.[role];
      return tier === undefined || tier === null ? [] : [[role, tier]];
    }),
  );
}

export function TaskRoleBackendSettings({
  environmentId,
  project,
  task,
}: {
  environmentId: EnvironmentId;
  project: Project | undefined;
  task: OrchestratorTask;
}) {
  const settings = useSettings();
  const serverProviders = useServerProviders();
  const providerEntries = useMemo(
    () => deriveProviderInstanceEntries(serverProviders),
    [serverProviders],
  );
  const globalPresets = useMemo(
    () => seedOrchestratorInheritedDefaultsDraft(settings.orchestratorDefaults).capabilityPresets,
    [settings.orchestratorDefaults],
  );
  const projectPresets = useMemo(
    () => seedOrchestratorConfigDraft(project?.orchestratorConfig).capabilityPresets,
    [project?.orchestratorConfig],
  );
  const [savingRole, setSavingRole] = useState<OrchestrationStageRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changeTier = useCallback(
    async (role: OrchestrationStageRole, tier: OrchestrationCapabilityTier | null) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || savingRole !== null) return;
      setSavingRole(role);
      setError(null);
      try {
        await api.orchestrator.setTaskCapabilityTiers({
          taskId: task.id,
          roleCapabilityTiers: taskCapabilityTiersAfterChange({
            current: task.roleCapabilityTiers,
            role,
            tier,
          }),
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to update capability tier.");
      } finally {
        setSavingRole(null);
      }
    },
    [environmentId, savingRole, task.id, task.roleCapabilityTiers],
  );

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Capability tiers</h2>
        <p className="text-xs text-muted-foreground">
          Set task defaults by capability. The PM may override a tier for one diagnosed attempt.
        </p>
      </div>
      {ORCHESTRATION_STAGE_ROLES.map((role) => {
        const selectedTier = task.roleCapabilityTiers?.[role] ?? null;
        const effectiveTier = selectedTier ?? (role === "plan" ? "genius" : "smart");
        const selection = projectPresets[effectiveTier] ?? globalPresets?.[effectiveTier] ?? null;
        const provider = selection
          ? providerEntries.find((entry) => entry.instanceId === selection.instanceId)
          : undefined;
        return (
          <div
            key={role}
            className="grid gap-2 border-t border-border pt-2 first:border-t-0 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center"
          >
            <span className="text-xs font-medium text-foreground">{STAGE_ROLE_LABELS[role]}</span>
            <div className="flex min-w-0 items-center gap-2">
              {provider ? (
                <ProviderInstanceIcon
                  driverKind={provider.driverKind}
                  displayName={provider.displayName}
                  accentColor={provider.accentColor}
                  showBadge={!provider.isDefault}
                />
              ) : null}
              <select
                aria-label={`${STAGE_ROLE_LABELS[role]} capability tier`}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                disabled={savingRole !== null}
                value={selectedTier ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  void changeTier(
                    role,
                    value === "" ? null : (value as OrchestrationCapabilityTier),
                  );
                }}
              >
                <option value="">
                  PM decides · defaults to {CAPABILITY_PRESET_COPY[effectiveTier].label}
                </option>
                {ORCHESTRATION_CAPABILITY_TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {CAPABILITY_PRESET_COPY[tier].label}
                  </option>
                ))}
              </select>
              <span className="max-w-48 truncate text-[11px] text-muted-foreground">
                {selection ? backendLabel(selection, provider) : "Preset not configured"}
              </span>
            </div>
            {savingRole === role ? (
              <p className="text-[11px] text-muted-foreground sm:col-start-2">Saving…</p>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
