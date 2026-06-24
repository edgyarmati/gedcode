import type {
  GedSubagentRole,
  OrchestratorGatePolicy,
  OrchestratorGlobalDefaults,
  OrchestrationStageRole,
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceId,
  ServerSettings,
  UnifiedSettings,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import {
  CANONICAL_ORCHESTRATOR_STAGE_ORDER,
  MANDATORY_ORCHESTRATOR_STAGES,
  OPTIONAL_ORCHESTRATOR_STAGES,
  type EditableOrchestratorGate,
  type OptionalOrchestratorStage,
} from "../orchestrator/projectOrchestrationSettings.logic";

function collapseOtelSignalsUrl(input: {
  readonly tracesUrl: string;
  readonly metricsUrl: string;
}): string | null {
  const tracesSuffix = "/traces";
  const metricsSuffix = "/metrics";
  if (!input.tracesUrl.endsWith(tracesSuffix) || !input.metricsUrl.endsWith(metricsSuffix)) {
    return null;
  }

  const tracesBase = input.tracesUrl.slice(0, -tracesSuffix.length);
  const metricsBase = input.metricsUrl.slice(0, -metricsSuffix.length);
  if (tracesBase !== metricsBase) {
    return null;
  }

  return `${tracesBase}/{traces,metrics}`;
}

export function formatDiagnosticsDescription(input: {
  readonly localTracingEnabled: boolean;
  readonly otlpTracesEnabled: boolean;
  readonly otlpTracesUrl?: string | undefined;
  readonly otlpMetricsEnabled: boolean;
  readonly otlpMetricsUrl?: string | undefined;
}): string {
  const mode = input.localTracingEnabled ? "Local trace file" : "Terminal logs only";
  const tracesUrl = input.otlpTracesEnabled ? input.otlpTracesUrl : undefined;
  const metricsUrl = input.otlpMetricsEnabled ? input.otlpMetricsUrl : undefined;

  if (tracesUrl && metricsUrl) {
    const collapsedUrl = collapseOtelSignalsUrl({ tracesUrl, metricsUrl });
    return collapsedUrl
      ? `${mode}. Exporting OTEL to ${collapsedUrl}.`
      : `${mode}. Exporting OTEL traces to ${tracesUrl} and metrics to ${metricsUrl}.`;
  }

  if (tracesUrl) {
    return `${mode}. Exporting OTEL traces to ${tracesUrl}.`;
  }

  if (metricsUrl) {
    return `${mode}. Exporting OTEL metrics to ${metricsUrl}.`;
  }

  return `${mode}.`;
}

export function buildGedRoleSettingsPatch(input: {
  readonly settings: Pick<ServerSettings, "gedRoleSettings">;
  readonly role: GedSubagentRole;
  readonly enabled: boolean;
}): Pick<UnifiedSettings, "gedRoleSettings"> {
  const current = input.settings.gedRoleSettings[input.role];
  return {
    gedRoleSettings: {
      ...input.settings.gedRoleSettings,
      [input.role]: {
        ...current,
        enabled: input.enabled,
      },
    },
  };
}

export function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<ServerSettings, "providers" | "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driver: ProviderDriverKind;
  readonly isDefault: boolean;
  readonly textGenerationModelSelection?:
    | ServerSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];
  const legacyProviderDefaults = DEFAULT_UNIFIED_SETTINGS.providers as Record<
    string,
    LegacyProviderSettings | undefined
  >;
  const legacyProviderDefault = input.isDefault ? legacyProviderDefaults[input.driver] : undefined;
  return {
    ...(legacyProviderDefault !== undefined
      ? {
          providers: {
            ...input.settings.providers,
            [input.driver]: legacyProviderDefault,
          } as ServerSettings["providers"],
        }
      : {}),
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}

export interface OrchestratorGlobalDefaultsDraft {
  readonly optionalStages: Readonly<Record<OptionalOrchestratorStage, boolean>>;
  readonly gatePolicy: Readonly<Record<EditableOrchestratorGate, OrchestratorGatePolicy>>;
  readonly resourceDefaults: OrchestratorGlobalResourceDefaultsDraft;
  readonly autoCompaction: OrchestratorGlobalAutoCompactionDraft;
}

export interface OrchestratorGlobalResourceDefaultsDraft {
  readonly maxParallelTasks: number;
  readonly maxParallelWorkers: number;
  readonly maxStageHandoffs: number;
  readonly maxRetriesPerStage: number;
  readonly pmReconciliationIntervalMs: number;
  readonly worktreeReaperIntervalMinutes: number;
  readonly allowFullAccessWorkers: boolean;
}

export type OrchestratorGlobalNumberDefaultKey = Exclude<
  keyof OrchestratorGlobalResourceDefaultsDraft,
  "allowFullAccessWorkers"
>;

export interface OrchestratorGlobalAutoCompactionDraft {
  readonly enabled: boolean;
  readonly reserveTokens: number;
  readonly keepRecentTokens: number;
  readonly customInstructions?: string;
}

const DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS = DEFAULT_UNIFIED_SETTINGS.orchestratorDefaults;

export function seedOrchestratorGlobalDefaultsDraft(
  defaults: OrchestratorGlobalDefaults,
): OrchestratorGlobalDefaultsDraft {
  const stageSet = new Set(defaults.stages);
  return {
    optionalStages: {
      review: stageSet.has("review"),
      verify: stageSet.has("verify"),
    },
    gatePolicy: {
      classify: defaults.gatePolicy.classify,
      plan: defaults.gatePolicy.plan,
      work: defaults.gatePolicy.work,
      review: defaults.gatePolicy.review,
    },
    resourceDefaults: {
      maxParallelTasks:
        defaults.maxParallelTasks ?? DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.maxParallelTasks,
      maxParallelWorkers:
        defaults.maxParallelWorkers ?? DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.maxParallelWorkers,
      maxStageHandoffs:
        defaults.maxStageHandoffs ?? DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.maxStageHandoffs,
      maxRetriesPerStage:
        defaults.maxRetriesPerStage ?? DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.maxRetriesPerStage,
      pmReconciliationIntervalMs:
        defaults.pmReconciliationIntervalMs ??
        DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.pmReconciliationIntervalMs,
      worktreeReaperIntervalMinutes:
        defaults.worktreeReaperIntervalMinutes ??
        DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.worktreeReaperIntervalMinutes,
      allowFullAccessWorkers:
        defaults.allowFullAccessWorkers ??
        DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.allowFullAccessWorkers,
    },
    autoCompaction: {
      enabled:
        defaults.autoCompaction?.enabled ??
        DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.autoCompaction.enabled,
      reserveTokens:
        defaults.autoCompaction?.reserveTokens ??
        DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.autoCompaction.reserveTokens,
      keepRecentTokens:
        defaults.autoCompaction?.keepRecentTokens ??
        DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.autoCompaction.keepRecentTokens,
      ...(defaults.autoCompaction?.customInstructions !== undefined
        ? { customInstructions: defaults.autoCompaction.customInstructions }
        : {}),
    },
  };
}

export function buildOrchestratorGlobalDefaultsPatch(
  draft: OrchestratorGlobalDefaultsDraft,
): Pick<UnifiedSettings, "orchestratorDefaults"> {
  const stageSet = new Set<OrchestrationStageRole>(MANDATORY_ORCHESTRATOR_STAGES);
  for (const stage of OPTIONAL_ORCHESTRATOR_STAGES) {
    if (draft.optionalStages[stage]) {
      stageSet.add(stage);
    }
  }
  return {
    orchestratorDefaults: {
      stages: CANONICAL_ORCHESTRATOR_STAGE_ORDER.filter((stage) => stageSet.has(stage)),
      gatePolicy: {
        classify: draft.gatePolicy.classify,
        plan: draft.gatePolicy.plan,
        work: draft.gatePolicy.work,
        review: draft.gatePolicy.review,
        land: "require-approval",
      },
      maxParallelTasks: draft.resourceDefaults.maxParallelTasks,
      maxParallelWorkers: draft.resourceDefaults.maxParallelWorkers,
      maxStageHandoffs: draft.resourceDefaults.maxStageHandoffs,
      maxRetriesPerStage: draft.resourceDefaults.maxRetriesPerStage,
      pmReconciliationIntervalMs: draft.resourceDefaults.pmReconciliationIntervalMs,
      worktreeReaperIntervalMinutes: draft.resourceDefaults.worktreeReaperIntervalMinutes,
      openPrAsDraft: DEFAULT_ORCHESTRATOR_GLOBAL_DEFAULTS.openPrAsDraft,
      autoCompaction: {
        enabled: draft.autoCompaction.enabled,
        reserveTokens: draft.autoCompaction.reserveTokens,
        keepRecentTokens: draft.autoCompaction.keepRecentTokens,
        ...(draft.autoCompaction.customInstructions !== undefined
          ? { customInstructions: draft.autoCompaction.customInstructions }
          : {}),
      },
      allowFullAccessWorkers: draft.resourceDefaults.allowFullAccessWorkers,
    },
  };
}
