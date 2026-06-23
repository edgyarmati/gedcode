import {
  ORCHESTRATION_STAGE_ROLES,
  type ModelSelection,
  type OrchestrationStageRole,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useServerProviders } from "../../rpc/serverState";
import { selectProjectByRef, useStore } from "../../store";
import type { OrchestratorTask } from "../../types";
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
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  buildOrchestrationConfigUpdate,
  orchestrationSettingsDraftsEqual,
  resolveRoleDefaultSelection,
  seedOrchestrationSettingsDraft,
  type OrchestrationSettingsDraft,
} from "./projectOrchestrationSettings.logic";
import { RoleBackendPicker } from "./RoleBackendPicker";
import { STAGE_ROLE_LABELS } from "./stageRoles";

// Per-task backend override editor: which backend each stage role runs on for
// this task specifically, overriding the project's per-role/default resolution.
// Backend-only (no prompt prefixes — those are project-level). Saves through the
// dedicated human-origin `orchestrator.setTaskRoleSelections` RPC, which the
// server stamps with origin/createdAt and dispatches through the decider.
export function TaskOrchestrationOverridesDialog({
  task,
  onClose,
}: {
  task: OrchestratorTask | null;
  onClose: () => void;
}) {
  const serverProviders = useServerProviders();
  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(serverProviders)),
    [serverProviders],
  );

  const projectRef = useMemo<ScopedProjectRef | null>(
    () => (task ? { environmentId: task.environmentId, projectId: task.projectId } : null),
    [task],
  );
  const project = useStore((state) => selectProjectByRef(state, projectRef));

  const seededDraft = useMemo<OrchestrationSettingsDraft>(
    () => seedOrchestrationSettingsDraft({ roleModelSelections: task?.roleModelSelections }),
    [task],
  );
  const [draft, setDraft] = useState<OrchestrationSettingsDraft>(seededDraft);
  const [saving, setSaving] = useState(false);

  // Reseed whenever a new task opens the dialog.
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

  const dirty = !orchestrationSettingsDraftsEqual(draft, seededDraft);

  const submit = useCallback(async () => {
    if (!task) {
      return;
    }
    const api = readEnvironmentApi(task.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update task backends",
          description: "Project API unavailable.",
        }),
      );
      return;
    }
    const update = buildOrchestrationConfigUpdate(draft);
    setSaving(true);
    try {
      await api.orchestrator.setTaskRoleSelections({
        taskId: task.id,
        roleModelSelections: update.roleModelSelections,
      });
      onClose();
    } catch (error) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to update task backends",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    } finally {
      setSaving(false);
    }
  }, [draft, onClose, task]);

  return (
    <Dialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Task backends</DialogTitle>
          <DialogDescription>
            Override the backend each stage role runs on for this task. Roles left on the default
            inherit the project configuration.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="max-h-[60vh] space-y-3 overflow-y-auto">
          {ORCHESTRATION_STAGE_ROLES.map((role) => (
            <div key={role} className="grid gap-2 rounded-lg border border-border bg-card p-3">
              <span className="text-sm font-medium text-foreground">{STAGE_ROLE_LABELS[role]}</span>
              <RoleBackendPicker
                role={role}
                selection={draft.roleSelections[role]}
                instanceEntries={instanceEntries}
                defaultSelection={project ? resolveRoleDefaultSelection(role, project) : null}
                onSelectionChange={handleSelectionChange}
              />
            </div>
          ))}
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
