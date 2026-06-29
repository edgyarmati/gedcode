import { PiProviderId, type PiModelSelection } from "@t3tools/contracts";
import { useCallback } from "react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { PiProviderPickerEntry } from "./projectOrchestrationSettings.logic";

const USE_GLOBAL_DEFAULT_VALUE = "__global_default__";

function piModelLabel(
  selection: PiModelSelection,
  entry: PiProviderPickerEntry | undefined,
): string {
  const providerLabel = entry?.displayName ?? String(selection.piProvider);
  return `${providerLabel} · ${selection.model}`;
}

export function PiPmModelPicker({
  selection,
  providerEntries,
  unsetLabel,
  unsetOptionLabel,
  providerAriaLabel,
  modelAriaLabel,
  emptyHint,
  onSelectionChange,
}: {
  selection: PiModelSelection | null;
  providerEntries: ReadonlyArray<PiProviderPickerEntry>;
  unsetLabel: string;
  unsetOptionLabel: string;
  providerAriaLabel: string;
  modelAriaLabel: string;
  emptyHint: string;
  onSelectionChange: (next: PiModelSelection | null) => void;
}) {
  const selectedEntry = selection
    ? providerEntries.find((entry) => entry.piProvider === selection.piProvider)
    : undefined;

  const handleProviderChange = useCallback(
    (value: string | null) => {
      if (value === null) {
        return;
      }
      if (value === USE_GLOBAL_DEFAULT_VALUE) {
        onSelectionChange(null);
        return;
      }
      const piProvider = PiProviderId.make(value);
      const entry = providerEntries.find((candidate) => candidate.piProvider === piProvider);
      const model = selection?.piProvider === piProvider ? selection.model : entry?.models[0]?.id;
      if (model === undefined) {
        return;
      }
      onSelectionChange({ piProvider, model });
    },
    [onSelectionChange, providerEntries, selection],
  );

  const handleModelChange = useCallback(
    (value: string | null) => {
      if (!selection || value === null) {
        return;
      }
      onSelectionChange({ piProvider: selection.piProvider, model: value });
    },
    [onSelectionChange, selection],
  );

  const modelOptions = selectedEntry?.models ?? [];
  const modelInOptions = modelOptions.some((model) => model.id === selection?.model);

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={selection ? String(selection.piProvider) : USE_GLOBAL_DEFAULT_VALUE}
          onValueChange={handleProviderChange}
        >
          <SelectTrigger className="w-full" aria-label={providerAriaLabel}>
            <SelectValue>
              {selection
                ? (selectedEntry?.displayName ?? String(selection.piProvider))
                : unsetLabel}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={USE_GLOBAL_DEFAULT_VALUE}>
              {unsetOptionLabel}
            </SelectItem>
            {providerEntries.map((entry) => (
              <SelectItem
                key={String(entry.piProvider)}
                hideIndicator
                value={String(entry.piProvider)}
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
                <SelectItem key={model.id} hideIndicator value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
      </div>
      {providerEntries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : null}
    </div>
  );
}

export function piPmModelLabel(
  selection: PiModelSelection | null,
  providerEntries: ReadonlyArray<PiProviderPickerEntry>,
): string | null {
  if (selection === null) {
    return null;
  }
  return piModelLabel(
    selection,
    providerEntries.find((entry) => entry.piProvider === selection.piProvider),
  );
}
