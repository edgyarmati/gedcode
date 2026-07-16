import {
  ProviderInstanceId,
  type ModelSelection,
  type OrchestrationStageRole,
  type ProviderOptionSelection,
} from "@t3tools/contracts";
import { getComposerProviderState } from "../chat/composerProviderState";
import { TraitsPicker } from "../chat/TraitsPicker";
import { useCallback } from "react";

import { type ProviderInstanceEntry } from "../../providerInstances";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { STAGE_ROLE_LABELS } from "./stageRoles";

// "Use the default backend" — a Select value must be a string, and a `null`
// selection means "inherit the default" (project default, or for a per-task
// override the resolved project/role selection).
export const USE_DEFAULT_VALUE = "__default__";

interface PickerModelOption {
  readonly slug: string;
  readonly name: string;
  readonly shortName?: string | undefined;
}

export function reconcileBackendSelection(input: {
  readonly current: ModelSelection | null;
  readonly entry: ProviderInstanceEntry;
  readonly model: string;
}): ModelSelection {
  const options = getComposerProviderState({
    provider: input.entry.driverKind,
    model: input.model,
    models: input.entry.models,
    prompt: "",
    modelOptions: input.current?.options,
  }).modelOptionsForDispatch;
  return {
    instanceId: input.entry.instanceId,
    model: input.model,
    ...(options && options.length > 0 ? { options } : {}),
  };
}

export function backendLabel(
  selection: ModelSelection,
  entry: ProviderInstanceEntry | undefined,
): string {
  const instanceLabel = entry?.displayName ?? String(selection.instanceId);
  const optionValues = selection.options?.map((option) => String(option.value)) ?? [];
  return [instanceLabel, selection.model, ...optionValues].join(" · ");
}

export function formatDefaultBackendLabel(input: {
  readonly selection: ModelSelection | null;
  readonly entry: ProviderInstanceEntry | undefined;
}): string {
  return input.selection
    ? `Use default - ${backendLabel(input.selection, input.entry)}`
    : "Use default";
}

export function BackendModelPicker({
  selection,
  instanceEntries,
  unsetLabel,
  unsetOptionLabel,
  backendAriaLabel,
  modelAriaLabel,
  modelOptionsByInstance,
  onSelectionChange,
}: {
  selection: ModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  unsetLabel: string;
  unsetOptionLabel: string;
  backendAriaLabel: string;
  modelAriaLabel: string;
  modelOptionsByInstance?:
    | ReadonlyMap<ProviderInstanceId, ReadonlyArray<PickerModelOption>>
    | undefined;
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
      if (!entry) {
        return;
      }
      // Preserve the model when re-selecting the same instance; otherwise adopt
      // the instance's first model. Instances without models can't form a valid
      // selection, so leave the role on its current value.
      const model = selection?.instanceId === instanceId ? selection.model : entry.models[0]?.slug;
      if (model === undefined) {
        return;
      }
      onSelectionChange(
        reconcileBackendSelection({
          current: selection,
          entry,
          model,
        }),
      );
    },
    [instanceEntries, onSelectionChange, selection],
  );

  const handleModelChange = useCallback(
    (value: string | null) => {
      if (!selection || value === null) {
        return;
      }
      if (!selectedEntry) {
        return;
      }
      onSelectionChange(
        reconcileBackendSelection({
          current: selection,
          entry: selectedEntry,
          model: value,
        }),
      );
    },
    [onSelectionChange, selectedEntry, selection],
  );

  const handleModelOptionsChange = useCallback(
    (options: ReadonlyArray<ProviderOptionSelection> | undefined) => {
      if (!selection) {
        return;
      }
      onSelectionChange({
        instanceId: selection.instanceId,
        model: selection.model,
        ...(options && options.length > 0 ? { options } : {}),
      });
    },
    [onSelectionChange, selection],
  );

  const modelOptions = selection
    ? (modelOptionsByInstance?.get(selection.instanceId) ?? selectedEntry?.models ?? [])
    : [];
  const modelInOptions = modelOptions.some((model) => model.slug === selection?.model);

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
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
      {selection && selectedEntry ? (
        <TraitsPicker
          provider={selectedEntry.driverKind}
          models={selectedEntry.models}
          model={selection.model}
          prompt=""
          onPromptChange={() => {}}
          modelOptions={selection.options}
          allowPromptInjectedEffort={false}
          triggerVariant="outline"
          triggerClassName="w-full sm:w-auto"
          onModelOptionsChange={handleModelOptionsChange}
        />
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
  modelOptionsByInstance,
  defaultSelection,
  onSelectionChange,
}: {
  role: OrchestrationStageRole;
  selection: ModelSelection | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance?:
    | ReadonlyMap<ProviderInstanceId, ReadonlyArray<PickerModelOption>>
    | undefined;
  defaultSelection: ModelSelection | null;
  onSelectionChange: (role: OrchestrationStageRole, next: ModelSelection | null) => void;
}) {
  const defaultEntry = defaultSelection
    ? instanceEntries.find((entry) => entry.instanceId === defaultSelection.instanceId)
    : undefined;
  const defaultOptionLabel = formatDefaultBackendLabel({
    selection: defaultSelection,
    entry: defaultEntry,
  });
  const handleSelectionChange = useCallback(
    (next: ModelSelection | null) => onSelectionChange(role, next),
    [onSelectionChange, role],
  );

  return (
    <BackendModelPicker
      selection={selection}
      instanceEntries={instanceEntries}
      modelOptionsByInstance={modelOptionsByInstance}
      unsetLabel={defaultOptionLabel}
      unsetOptionLabel={defaultOptionLabel}
      backendAriaLabel={`${STAGE_ROLE_LABELS[role]} harness`}
      modelAriaLabel={`${STAGE_ROLE_LABELS[role]} model`}
      onSelectionChange={handleSelectionChange}
    />
  );
}
