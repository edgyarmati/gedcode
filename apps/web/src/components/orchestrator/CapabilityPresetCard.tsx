import type { ModelSelection } from "@t3tools/contracts";

import type { AppModelOption } from "../../modelSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { BackendModelPicker, backendLabel } from "./RoleBackendPicker";
import type { CapabilityPresetKey } from "./orchestratorPresetMigration.logic";

export const CAPABILITY_PRESET_COPY: Record<
  CapabilityPresetKey,
  { label: string; description: string }
> = {
  cheap: {
    label: "Cheap",
    description: "Fast, economical execution for routine and mechanical work.",
  },
  smart: {
    label: "Smart",
    description: "The balanced default for most implementation and verification work.",
  },
  genius: {
    label: "Genius",
    description: "Maximum reasoning for planning and unusually complex problems.",
  },
};

function findEntry(
  selection: ModelSelection | null,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ProviderInstanceEntry | undefined {
  return selection ? entries.find((entry) => entry.instanceId === selection.instanceId) : undefined;
}

export function CapabilityPresetCard({
  preset,
  selection,
  inheritedSelection = null,
  instanceEntries,
  modelOptionsByInstance,
  allowInherit,
  onSelectionChange,
}: {
  preset: CapabilityPresetKey;
  selection: ModelSelection | null;
  inheritedSelection?: ModelSelection | null | undefined;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  modelOptionsByInstance?:
    | ReadonlyMap<ModelSelection["instanceId"], ReadonlyArray<AppModelOption>>
    | undefined;
  allowInherit: boolean;
  onSelectionChange: (selection: ModelSelection | null) => void;
}) {
  const effectiveSelection = selection ?? inheritedSelection;
  const entry = findEntry(effectiveSelection, instanceEntries);
  const copy = CAPABILITY_PRESET_COPY[preset];
  const inheritedEntry = findEntry(inheritedSelection, instanceEntries);
  const inheritedLabel = inheritedSelection
    ? `Inherit global · ${backendLabel(inheritedSelection, inheritedEntry)}`
    : "Inherit global preset";

  return (
    <section className="rounded-xl border border-border/80 bg-card p-4 shadow-xs">
      <div className="mb-3 flex items-start gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background"
          role="img"
          aria-label={
            entry ? `${copy.label} preset uses ${entry.displayName}` : `${copy.label} preset`
          }
        >
          {entry ? (
            <ProviderInstanceIcon
              driverKind={entry.driverKind}
              displayName={entry.displayName}
              accentColor={entry.accentColor}
              showBadge={!entry.isDefault}
            />
          ) : (
            <span className="text-sm font-semibold text-muted-foreground">
              {copy.label.slice(0, 1)}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{copy.label}</h3>
            {selection === null && inheritedSelection ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                Inherited
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
        </div>
      </div>
      <BackendModelPicker
        selection={selection}
        instanceEntries={instanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        allowUnset={allowInherit}
        unsetLabel={allowInherit ? inheritedLabel : "Choose a harness"}
        unsetOptionLabel={inheritedLabel}
        backendAriaLabel={`${copy.label} harness`}
        modelAriaLabel={`${copy.label} model`}
        onSelectionChange={onSelectionChange}
      />
    </section>
  );
}
