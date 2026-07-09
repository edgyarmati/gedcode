import type {
  OrchestratorGatePolicy,
  OrchestratorResourceLimits,
  OrchestrationStageRole,
} from "@t3tools/contracts";
import type { ReactNode } from "react";

import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import {
  CANONICAL_ORCHESTRATOR_STAGE_ORDER,
  EDITABLE_ORCHESTRATOR_GATES,
  MANDATORY_ORCHESTRATOR_STAGES,
  type EditableOrchestratorGate,
  type InheritableOrchestratorGatePolicy,
  type InheritableOrchestratorResourceLimits,
  type InheritableOrchestratorStages,
  type OptionalOrchestratorStage,
} from "./projectOrchestrationSettings.logic";
import { STAGE_ROLE_LABELS } from "./stageRoles";

const GATE_POLICY_LABELS: Record<OrchestratorGatePolicy, string> = {
  auto: "Auto",
  "require-approval": "Require approval",
};

const PR_OPEN_MODE_LABELS: Record<"ready" | "draft", string> = {
  ready: "Ready",
  draft: "Draft",
};

const PROJECT_RESOURCE_LIMIT_LABELS: Record<ProjectResourceLimitNumberKey, string> = {
  maxParallelTasks: "Max parallel tasks",
  maxParallelWorkers: "Max parallel workers",
  maxRetriesPerStage: "Max retries per stage",
};
const USE_GLOBAL_VALUE = "__global__";
const CUSTOMIZE_VALUE = "__customize__";

export type ProjectResourceLimitNumberKey = Exclude<
  keyof OrchestratorResourceLimits,
  "allowFullAccessWorkers"
>;

export function OrchestratorStagesControl({
  optionalStages,
  disabled = false,
  onOptionalStageChange,
}: {
  optionalStages: Exclude<InheritableOrchestratorStages, null>;
  disabled?: boolean;
  onOptionalStageChange: (stage: OptionalOrchestratorStage, enabled: boolean) => void;
}) {
  const mandatoryStageSet = new Set<OrchestrationStageRole>(MANDATORY_ORCHESTRATOR_STAGES);
  return (
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
              disabled={mandatory || disabled}
              aria-label={`${STAGE_ROLE_LABELS[stage]} stage`}
              onCheckedChange={(next) =>
                mandatory || disabled
                  ? undefined
                  : onOptionalStageChange(stage as OptionalOrchestratorStage, Boolean(next))
              }
            />
          </label>
        );
      })}
    </div>
  );
}

export function OrchestratorGateAutonomyControl({
  gatePolicy,
  inheritedGatePolicy,
  onGatePolicyChange,
}: {
  gatePolicy:
    | Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>
    | InheritableOrchestratorGatePolicy;
  inheritedGatePolicy?: Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>;
  onGatePolicyChange: (
    gate: EditableOrchestratorGate,
    policy: OrchestratorGatePolicy | null,
  ) => void;
}) {
  return (
    <div className="grid gap-2">
      {EDITABLE_ORCHESTRATOR_GATES.map((gate) => {
        const explicitPolicy = gatePolicy[gate];
        const inheritedPolicy = inheritedGatePolicy?.[gate];
        const displayedPolicy = explicitPolicy ?? inheritedPolicy ?? "require-approval";
        return (
          <div
            key={gate}
            className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_12rem] sm:items-center"
          >
            <span>{STAGE_ROLE_LABELS[gate]}</span>
            <Select
              value={explicitPolicy ?? USE_GLOBAL_VALUE}
              onValueChange={(value) => {
                if (value === USE_GLOBAL_VALUE) {
                  onGatePolicyChange(gate, null);
                  return;
                }
                if (value === "auto" || value === "require-approval") {
                  onGatePolicyChange(gate, value);
                }
              }}
            >
              <SelectTrigger size="sm" aria-label={`${STAGE_ROLE_LABELS[gate]} gate autonomy`}>
                <SelectValue>
                  {explicitPolicy === null && inheritedPolicy !== undefined
                    ? `Use global (${GATE_POLICY_LABELS[inheritedPolicy]})`
                    : GATE_POLICY_LABELS[displayedPolicy]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {inheritedPolicy !== undefined ? (
                  <SelectItem hideIndicator value={USE_GLOBAL_VALUE}>
                    Use global ({GATE_POLICY_LABELS[inheritedPolicy]})
                  </SelectItem>
                ) : null}
                <SelectItem hideIndicator value="auto">
                  {GATE_POLICY_LABELS.auto}
                </SelectItem>
                <SelectItem hideIndicator value="require-approval">
                  {GATE_POLICY_LABELS["require-approval"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 px-3 py-2 text-sm">
        <span>Land</span>
        <span className="text-muted-foreground">Require approval (always)</span>
      </div>
    </div>
  );
}

export function ProjectOrchestratorResourceLimitsControl({
  resourceLimits,
  inheritedResourceLimits,
  onNumberLimitChange,
  onAllowFullAccessWorkersChange,
}: {
  resourceLimits: OrchestratorResourceLimits | InheritableOrchestratorResourceLimits;
  inheritedResourceLimits?: OrchestratorResourceLimits;
  onNumberLimitChange: (key: ProjectResourceLimitNumberKey, value: number | null) => void;
  onAllowFullAccessWorkersChange: (enabled: boolean | null) => void;
}) {
  const numberKeys = Object.keys(PROJECT_RESOURCE_LIMIT_LABELS) as ProjectResourceLimitNumberKey[];
  return (
    <div className="grid gap-2">
      {numberKeys.map((key) => {
        const explicitValue = resourceLimits[key];
        const inheritedValue = inheritedResourceLimits?.[key];
        const displayedValue = explicitValue ?? inheritedValue ?? 1;
        const inheriting = explicitValue === null && inheritedValue !== undefined;
        return (
          <div
            key={key}
            className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_10rem_7rem] sm:items-center"
          >
            <span>{PROJECT_RESOURCE_LIMIT_LABELS[key]}</span>
            {inheritedValue !== undefined ? (
              <Select
                value={inheriting ? USE_GLOBAL_VALUE : CUSTOMIZE_VALUE}
                onValueChange={(value) => {
                  onNumberLimitChange(key, value === USE_GLOBAL_VALUE ? null : displayedValue);
                }}
              >
                <SelectTrigger size="sm" aria-label={`${PROJECT_RESOURCE_LIMIT_LABELS[key]} mode`}>
                  <SelectValue>
                    {inheriting ? `Use global (${inheritedValue})` : "Override"}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value={USE_GLOBAL_VALUE}>
                    Use global ({inheritedValue})
                  </SelectItem>
                  <SelectItem hideIndicator value={CUSTOMIZE_VALUE}>
                    Override
                  </SelectItem>
                </SelectPopup>
              </Select>
            ) : null}
            <Input
              nativeInput
              type="number"
              min={1}
              step={1}
              value={displayedValue}
              disabled={inheriting}
              aria-label={PROJECT_RESOURCE_LIMIT_LABELS[key]}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                onNumberLimitChange(key, Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
              }}
            />
          </div>
        );
      })}
      <div className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_10rem_auto] sm:items-center">
        <span>Allow full-access workers safety opt-in</span>
        {inheritedResourceLimits !== undefined ? (
          <Select
            value={
              resourceLimits.allowFullAccessWorkers === null ? USE_GLOBAL_VALUE : CUSTOMIZE_VALUE
            }
            onValueChange={(value) => {
              onAllowFullAccessWorkersChange(
                value === USE_GLOBAL_VALUE
                  ? null
                  : (resourceLimits.allowFullAccessWorkers ??
                      inheritedResourceLimits.allowFullAccessWorkers),
              );
            }}
          >
            <SelectTrigger size="sm" aria-label="Allow full-access workers mode">
              <SelectValue>
                {resourceLimits.allowFullAccessWorkers === null
                  ? `Use global (${inheritedResourceLimits.allowFullAccessWorkers ? "On" : "Off"})`
                  : "Override"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value={USE_GLOBAL_VALUE}>
                Use global ({inheritedResourceLimits.allowFullAccessWorkers ? "On" : "Off"})
              </SelectItem>
              <SelectItem hideIndicator value={CUSTOMIZE_VALUE}>
                Override
              </SelectItem>
            </SelectPopup>
          </Select>
        ) : null}
        <Switch
          checked={
            resourceLimits.allowFullAccessWorkers ??
            inheritedResourceLimits?.allowFullAccessWorkers ??
            false
          }
          disabled={
            resourceLimits.allowFullAccessWorkers === null && inheritedResourceLimits !== undefined
          }
          aria-label="Allow full-access workers safety opt-in"
          onCheckedChange={(checked) => onAllowFullAccessWorkersChange(Boolean(checked))}
        />
      </div>
    </div>
  );
}

export function ProjectOpenPrModeControl({
  openPrAsDraft,
  inheritedOpenPrAsDraft,
  onOpenPrAsDraftChange,
}: {
  openPrAsDraft: boolean | null;
  inheritedOpenPrAsDraft: boolean;
  onOpenPrAsDraftChange: (openPrAsDraft: boolean | null) => void;
}) {
  const inheritedMode = inheritedOpenPrAsDraft ? "draft" : "ready";
  const explicitMode = openPrAsDraft === null ? null : openPrAsDraft ? "draft" : "ready";
  return (
    <div className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_12rem] sm:items-center">
      <span>Landing PR state</span>
      <Select
        value={explicitMode ?? USE_GLOBAL_VALUE}
        onValueChange={(value) => {
          if (value === USE_GLOBAL_VALUE) {
            onOpenPrAsDraftChange(null);
            return;
          }
          if (value === "draft" || value === "ready") {
            onOpenPrAsDraftChange(value === "draft");
          }
        }}
      >
        <SelectTrigger size="sm" aria-label="Landing PR state">
          <SelectValue>
            {explicitMode === null
              ? `Use global (${PR_OPEN_MODE_LABELS[inheritedMode]})`
              : PR_OPEN_MODE_LABELS[explicitMode]}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem hideIndicator value={USE_GLOBAL_VALUE}>
            Use global ({PR_OPEN_MODE_LABELS[inheritedMode]})
          </SelectItem>
          <SelectItem hideIndicator value="ready">
            Ready
          </SelectItem>
          <SelectItem hideIndicator value="draft">
            Draft
          </SelectItem>
        </SelectPopup>
      </Select>
    </div>
  );
}

export function NumberLimitRow({
  label,
  value,
  children,
  onChange,
}: {
  label: string;
  value: number;
  children?: ReactNode;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-2 rounded-md border border-border/70 px-3 py-2 text-sm sm:grid-cols-[1fr_7rem] sm:items-center">
      <span>
        {label}
        {children ? <span className="block text-xs text-muted-foreground">{children}</span> : null}
      </span>
      <Input
        nativeInput
        type="number"
        min={1}
        step={1}
        value={value}
        aria-label={label}
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
        }}
      />
    </label>
  );
}
