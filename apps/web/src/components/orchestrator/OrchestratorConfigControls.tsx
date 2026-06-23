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
  type OptionalOrchestratorStage,
} from "./projectOrchestrationSettings.logic";
import { STAGE_ROLE_LABELS } from "./stageRoles";

const GATE_POLICY_LABELS: Record<OrchestratorGatePolicy, string> = {
  auto: "Auto",
  "require-approval": "Require approval",
};

const PROJECT_RESOURCE_LIMIT_LABELS: Record<ProjectResourceLimitNumberKey, string> = {
  maxParallelTasks: "Max parallel tasks",
  maxParallelWorkers: "Max parallel workers",
  maxStageHandoffs: "Max stage handoffs",
  maxRetriesPerStage: "Max retries per stage",
};

export type ProjectResourceLimitNumberKey = Exclude<
  keyof OrchestratorResourceLimits,
  "allowFullAccessWorkers"
>;

export function OrchestratorStagesControl({
  optionalStages,
  onOptionalStageChange,
}: {
  optionalStages: Readonly<Record<OptionalOrchestratorStage, boolean>>;
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
  );
}

export function OrchestratorGateAutonomyControl({
  gatePolicy,
  onGatePolicyChange,
}: {
  gatePolicy: Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>;
  onGatePolicyChange: (gate: EditableOrchestratorGate, policy: OrchestratorGatePolicy) => void;
}) {
  return (
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
  );
}

export function ProjectOrchestratorResourceLimitsControl({
  resourceLimits,
  onNumberLimitChange,
  onAllowFullAccessWorkersChange,
}: {
  resourceLimits: OrchestratorResourceLimits;
  onNumberLimitChange: (key: ProjectResourceLimitNumberKey, value: number) => void;
  onAllowFullAccessWorkersChange: (enabled: boolean) => void;
}) {
  const numberKeys = Object.keys(PROJECT_RESOURCE_LIMIT_LABELS) as ProjectResourceLimitNumberKey[];
  return (
    <div className="grid gap-2">
      {numberKeys.map((key) => (
        <NumberLimitRow
          key={key}
          label={PROJECT_RESOURCE_LIMIT_LABELS[key]}
          value={resourceLimits[key]}
          onChange={(value) => onNumberLimitChange(key, value)}
        />
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
