import type { ModelSelection, OrchestrationCapabilityTier } from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { CAPABILITY_PRESET_COPY } from "../orchestrator/CapabilityPresetCard";
import { backendLabel } from "../orchestrator/RoleBackendPicker";
import { cn } from "../../lib/utils";

export function ProjectContextTierCard({
  tier,
  selection,
  instanceEntries,
  selected,
  onSelect,
}: {
  readonly tier: OrchestrationCapabilityTier;
  readonly selection: ModelSelection;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const copy = CAPABILITY_PRESET_COPY[tier];
  const entry = instanceEntries.find((candidate) => candidate.instanceId === selection.instanceId);

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-colors",
        selected
          ? "border-primary ring-2 ring-primary/20"
          : "border-border/80 hover:border-ring/60 hover:bg-accent/30",
      )}
      onClick={onSelect}
    >
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background"
        role="img"
        aria-label={`${copy.label} preset uses ${entry?.displayName ?? String(selection.instanceId)}`}
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
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="font-semibold">{copy.label}</span>
          {selected ? (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary uppercase">
              Selected
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {backendLabel(selection, entry)}
        </span>
      </span>
    </button>
  );
}
