import {
  ORCHESTRATION_STAGE_ROLES,
  type EnvironmentId,
  type ModelSelection,
  type OrchestrationStageRole,
} from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import { useSettings } from "../../hooks/useSettings";
import { getAppModelOptionsForInstance, type AppModelOption } from "../../modelSelection";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useServerProviders } from "../../rpc/serverState";
import type { OrchestratorTask, Project } from "../../types";
import { RoleBackendPicker } from "./RoleBackendPicker";
import { resolveRoleDefaultSelection } from "./projectOrchestrationSettings.logic";
import { STAGE_ROLE_LABELS } from "./stageRoles";

function taskRoleSelectionsAfterChange(input: {
  readonly current: OrchestratorTask["roleModelSelections"];
  readonly role: OrchestrationStageRole;
  readonly selection: ModelSelection | null;
}): Partial<Record<OrchestrationStageRole, ModelSelection>> {
  const next: Partial<Record<OrchestrationStageRole, ModelSelection>> = {};
  for (const role of ORCHESTRATION_STAGE_ROLES) {
    const selection = role === input.role ? input.selection : input.current?.[role];
    if (selection) {
      next[role] = selection;
    }
  }
  return next;
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
  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(serverProviders)),
    [serverProviders],
  );
  const modelOptionsByInstance = useMemo(() => {
    const options = new Map<ModelSelection["instanceId"], ReadonlyArray<AppModelOption>>();
    for (const entry of instanceEntries) {
      options.set(entry.instanceId, getAppModelOptionsForInstance(settings, entry));
    }
    return options;
  }, [instanceEntries, settings]);
  const [savingRole, setSavingRole] = useState<OrchestrationStageRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const changeSelection = useCallback(
    async (role: OrchestrationStageRole, selection: ModelSelection | null) => {
      const api = readEnvironmentApi(environmentId);
      if (!api || savingRole !== null) {
        return;
      }
      setSavingRole(role);
      setError(null);
      try {
        await api.orchestrator.setTaskRoleSelections({
          taskId: task.id,
          roleModelSelections: taskRoleSelectionsAfterChange({
            current: task.roleModelSelections,
            role,
            selection,
          }),
        });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to update worker override.");
      } finally {
        setSavingRole(null);
      }
    },
    [environmentId, savingRole, task.id, task.roleModelSelections],
  );

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="space-y-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase">Worker overrides</h2>
        <p className="text-xs text-muted-foreground">
          Choose the harness, model, and supported thinking level for this task.
        </p>
      </div>
      {ORCHESTRATION_STAGE_ROLES.map((role) => {
        const projectRoleSelection = project?.roleModelSelections?.[role] ?? null;
        const projectDefault = project
          ? resolveRoleDefaultSelection(project, {
              defaultWorkerModelSelection:
                settings.orchestratorDefaults.defaultWorkerModelSelection,
            })
          : settings.orchestratorDefaults.defaultWorkerModelSelection;
        return (
          <div key={role} className="space-y-1.5 border-t border-border pt-2 first:border-t-0">
            <span className="text-xs font-medium text-foreground">{STAGE_ROLE_LABELS[role]}</span>
            <RoleBackendPicker
              role={role}
              selection={task.roleModelSelections?.[role] ?? null}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              defaultSelection={projectRoleSelection ?? projectDefault}
              onSelectionChange={(changedRole, next) => {
                if (savingRole === null) {
                  void changeSelection(changedRole, next);
                }
              }}
            />
            {savingRole === role ? (
              <p className="text-[11px] text-muted-foreground">Saving…</p>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
