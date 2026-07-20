import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  buildOrchestratorGlobalDefaultsPatch,
  buildProviderInstanceUpdatePatch,
  formatDiagnosticsDescription,
  seedOrchestratorGlobalDefaultsDraft,
} from "./SettingsPanels.logic";

describe("formatDiagnosticsDescription", () => {
  it("collapses trace and metric URLs that share the same OTEL base path", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      }),
    ).toBe("Local trace file. Exporting OTEL to http://localhost:4318/v1/{traces,metrics}.");
  });

  it("keeps separate trace and metric URLs when their base paths differ", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: true,
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsEnabled: true,
        otlpMetricsUrl: "http://localhost:9000/v1/metrics",
      }),
    ).toBe(
      "Local trace file. Exporting OTEL traces to http://localhost:4318/v1/traces and metrics to http://localhost:9000/v1/metrics.",
    );
  });

  it("omits OTEL text when no exporter is enabled", () => {
    expect(
      formatDiagnosticsDescription({
        localTracingEnabled: true,
        otlpTracesEnabled: false,
        otlpMetricsEnabled: false,
      }),
    ).toBe("Local trace file.");
  });
});

describe("buildProviderInstanceUpdatePatch", () => {
  it("promotes an edited default provider into providerInstances and resets the legacy provider", () => {
    const instanceId = ProviderInstanceId.make("codex");
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: {
        binaryPath: "/opt/t3/codex",
      },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providers: {
          ...DEFAULT_SERVER_SETTINGS.providers,
          codex: {
            ...DEFAULT_SERVER_SETTINGS.providers.codex,
            binaryPath: "/legacy/codex",
          },
        },
      },
      instanceId,
      instance: nextInstance,
      driver: ProviderDriverKind.make("codex"),
      isDefault: true,
    });

    expect(patch.providerInstances?.[instanceId]).toEqual(nextInstance);
    expect(patch.providers?.codex).toEqual(DEFAULT_SERVER_SETTINGS.providers.codex);
  });

  it("updates custom instances without touching legacy provider settings", () => {
    const instanceId = ProviderInstanceId.make("codex_personal");
    const nextInstance = {
      driver: ProviderDriverKind.make("codex"),
      enabled: true,
      config: {
        homePath: "/Users/example/.codex-personal",
      },
    } satisfies ProviderInstanceConfig;

    const patch = buildProviderInstanceUpdatePatch({
      settings: DEFAULT_SERVER_SETTINGS,
      instanceId,
      instance: nextInstance,
      driver: ProviderDriverKind.make("codex"),
      isDefault: false,
    });

    expect(patch.providerInstances?.[instanceId]).toEqual(nextInstance);
    expect(patch.providers).toBeUndefined();
  });
});

describe("Orchestrator global defaults settings logic", () => {
  const pmModelSelection: ModelSelection = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "claude-sonnet-4-6",
  };
  const workerModelSelection: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex_worker"),
    model: "gpt-5-worker",
  };
  const capabilityPresets = {
    cheap: {
      instanceId: ProviderInstanceId.make("codex_cheap"),
      model: "gpt-mini",
    },
    smart: {
      instanceId: ProviderInstanceId.make("codex_smart"),
      model: "gpt-smart",
    },
    genius: {
      instanceId: ProviderInstanceId.make("claude_genius"),
      model: "opus",
    },
  } as const;

  it("seeds the settings-panel draft from global defaults", () => {
    const draft = seedOrchestratorGlobalDefaultsDraft({
      ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
      stages: ["plan", "work", "verify"],
      gatePolicy: {
        plan: "require-approval",
        land: "require-approval",
      },
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxRetriesPerStage: 4,
      pmReconciliationIntervalMs: 90_000,
      worktreeReaperIntervalMinutes: 7,
      pmModelSelection,
      defaultWorkerModelSelection: workerModelSelection,
      openPrAsDraft: true,
    });

    expect(draft.pmModelSelection).toEqual(pmModelSelection);
    expect(draft.defaultWorkerModelSelection).toEqual(workerModelSelection);
    expect(draft.capabilityPresets).toBeNull();
    expect(draft.optionalStages).toEqual({});
    expect(draft.gatePolicy).toEqual({
      plan: "require-approval",
    });
    expect(draft.openPrAsDraft).toBe(true);
    expect(draft.resourceDefaults).toEqual({
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxRetriesPerStage: 4,
      pmReconciliationIntervalMs: 90_000,
      worktreeReaperIntervalMinutes: 7,
    });
  });

  it("builds a server settings patch with canonical stage order and pinned land gate", () => {
    const patch = buildOrchestratorGlobalDefaultsPatch({
      pmModelSelection,
      defaultWorkerModelSelection: workerModelSelection,
      capabilityPresets,
      projectContextDefaultTier: "smart",
      optionalStages: {},
      gatePolicy: {
        plan: "auto",
      },
      resourceDefaults: {
        maxParallelTasks: 4,
        maxParallelWorkers: 5,
        maxRetriesPerStage: 6,
        pmReconciliationIntervalMs: 180_000,
        worktreeReaperIntervalMinutes: 9,
      },
      openPrAsDraft: true,
    });

    expect(patch.orchestratorDefaults).toEqual({
      stages: ["plan", "work", "verify"],
      gatePolicy: {
        plan: "auto",
        land: "require-approval",
      },
      maxParallelTasks: 4,
      maxParallelWorkers: 5,
      maxRetriesPerStage: 6,
      pmReconciliationIntervalMs: 180_000,
      worktreeReaperIntervalMinutes: 9,
      pmModelSelection,
      defaultWorkerModelSelection: workerModelSelection,
      capabilityPresets,
      projectContextDefaultTier: "smart",
      openPrAsDraft: true,
    });
  });
});
