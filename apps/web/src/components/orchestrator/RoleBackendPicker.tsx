import {
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationStageRole,
} from "@t3tools/contracts";
import { useCallback } from "react";

import { type ProviderInstanceEntry } from "../../providerInstances";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { STAGE_ROLE_LABELS } from "./stageRoles";

// "Use the default backend" — a Select value must be a string, and a `null`
// selection means "inherit the default" (project default, or for a per-task
// override the resolved project/role selection).
export const USE_DEFAULT_VALUE = "__default__";

export function backendLabel(
  selection: ModelSelection,
  entry: ProviderInstanceEntry | undefined,
): string {
  const instanceLabel = entry?.displayName ?? String(selection.instanceId);
  return `${instanceLabel} · ${selection.model}`;
}

export function BackendModelPicker({
  selection,
  instanceEntries,
  unsetLabel,
  unsetOptionLabel,
  backendAriaLabel,
  modelAriaLabel,
  onSelectionChange,
}: {
  selection: ModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  unsetLabel: string;
  unsetOptionLabel: string;
  backendAriaLabel: string;
  modelAriaLabel: string;
  onSelectionChange: (next: ModelSelection | null) => void;
}) {
  const selectedEntry = selection
    ? instanceEntries.find((entry) => entry.instanceId === selection.instanceId)
    : undefined;

  const handleInstanceChange = useCallback(
    (value: string | null) => {
      if (value === null) {
        return;
      }
      if (value === USE_DEFAULT_VALUE) {
        onSelectionChange(null);
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
      onSelectionChange({ instanceId, model });
    },
    [instanceEntries, onSelectionChange, selection],
  );

  const handleModelChange = useCallback(
    (value: string | null) => {
      if (!selection || value === null) {
        return;
      }
      onSelectionChange({ instanceId: selection.instanceId, model: value });
    },
    [onSelectionChange, selection],
  );

  const modelOptions = selectedEntry?.models ?? [];
  const modelInOptions = modelOptions.some((model) => model.slug === selection?.model);

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        value={selection ? String(selection.instanceId) : USE_DEFAULT_VALUE}
        onValueChange={handleInstanceChange}
      >
        <SelectTrigger className="w-full" aria-label={backendAriaLabel}>
          <SelectValue>
            {selection ? (selectedEntry?.displayName ?? String(selection.instanceId)) : unsetLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem hideIndicator value={USE_DEFAULT_VALUE}>
            {unsetOptionLabel}
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
          <SelectTrigger className="w-full" aria-label={modelAriaLabel}>
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
  );
}

// Shared per-role backend (instance + model) picker. Used by both the project
// per-role editor and the per-task override editor. `defaultSelection` is the
// value the "use default" option resolves to for this role (the project default,
// or the project/role resolution a task override would inherit) — shown in the
// option label so the inherited backend is visible.
export function RoleBackendPicker({
  role,
  selection,
  instanceEntries,
  defaultSelection,
  onSelectionChange,
}: {
  role: OrchestrationStageRole;
  selection: ModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  defaultSelection: ModelSelection | null;
  onSelectionChange: (role: OrchestrationStageRole, next: ModelSelection | null) => void;
}) {
  const defaultEntry = defaultSelection
    ? instanceEntries.find((entry) => entry.instanceId === defaultSelection.instanceId)
    : undefined;
  const defaultOptionLabel = defaultSelection
    ? `Use default (${backendLabel(defaultSelection, defaultEntry)})`
    : "Use default";
  const handleSelectionChange = useCallback(
    (next: ModelSelection | null) => onSelectionChange(role, next),
    [onSelectionChange, role],
  );

  return (
    <BackendModelPicker
      selection={selection}
      instanceEntries={instanceEntries}
      unsetLabel="Use default"
      unsetOptionLabel={defaultOptionLabel}
      backendAriaLabel={`${STAGE_ROLE_LABELS[role]} backend`}
      modelAriaLabel={`${STAGE_ROLE_LABELS[role]} model`}
      onSelectionChange={handleSelectionChange}
    />
  );
}
