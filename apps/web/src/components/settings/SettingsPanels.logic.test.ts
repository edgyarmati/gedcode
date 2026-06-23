import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  buildGedRoleSettingsPatch,
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

describe("buildGedRoleSettingsPatch", () => {
  it("updates one role without dropping other role settings", () => {
    const patch = buildGedRoleSettingsPatch({
      settings: {
        gedRoleSettings: {
          ...DEFAULT_SERVER_SETTINGS.gedRoleSettings,
          "ged-worker": { enabled: true },
        },
      },
      role: "ged-explorer",
      enabled: false,
    });

    expect(patch.gedRoleSettings["ged-explorer"]).toEqual({ enabled: false });
    expect(patch.gedRoleSettings["ged-planner"]).toEqual(
      DEFAULT_SERVER_SETTINGS.gedRoleSettings["ged-planner"],
    );
    expect(patch.gedRoleSettings["ged-worker"]).toEqual({ enabled: true });
  });
});

describe("Orchestrator global defaults settings logic", () => {
  it("seeds the settings-panel draft from global defaults", () => {
    const draft = seedOrchestratorGlobalDefaultsDraft({
      ...DEFAULT_SERVER_SETTINGS.orchestratorDefaults,
      stages: ["classify", "plan", "work"],
      gatePolicy: {
        classify: "auto",
        plan: "require-approval",
        work: "auto",
        review: "require-approval",
        land: "require-approval",
      },
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxStageHandoffs: 10,
      maxRetriesPerStage: 4,
      pmReconciliationIntervalMs: 90_000,
      worktreeReaperIntervalMinutes: 7,
      allowFullAccessWorkers: true,
    });

    expect(draft.optionalStages).toEqual({ review: false, verify: false });
    expect(draft.gatePolicy).toEqual({
      classify: "auto",
      plan: "require-approval",
      work: "auto",
      review: "require-approval",
    });
    expect(draft.resourceDefaults).toEqual({
      maxParallelTasks: 2,
      maxParallelWorkers: 3,
      maxStageHandoffs: 10,
      maxRetriesPerStage: 4,
      pmReconciliationIntervalMs: 90_000,
      worktreeReaperIntervalMinutes: 7,
      allowFullAccessWorkers: true,
    });
  });

  it("builds a server settings patch with canonical stage order and pinned land gate", () => {
    const patch = buildOrchestratorGlobalDefaultsPatch({
      optionalStages: { review: false, verify: true },
      gatePolicy: {
        classify: "auto",
        plan: "auto",
        work: "require-approval",
        review: "auto",
      },
      resourceDefaults: {
        maxParallelTasks: 4,
        maxParallelWorkers: 5,
        maxStageHandoffs: 12,
        maxRetriesPerStage: 6,
        pmReconciliationIntervalMs: 180_000,
        worktreeReaperIntervalMinutes: 9,
        allowFullAccessWorkers: false,
      },
    });

    expect(patch.orchestratorDefaults).toEqual({
      stages: ["classify", "plan", "work", "verify"],
      gatePolicy: {
        classify: "auto",
        plan: "auto",
        work: "require-approval",
        review: "auto",
        land: "require-approval",
      },
      maxParallelTasks: 4,
      maxParallelWorkers: 5,
      maxStageHandoffs: 12,
      maxRetriesPerStage: 6,
      pmReconciliationIntervalMs: 180_000,
      worktreeReaperIntervalMinutes: 9,
      allowFullAccessWorkers: false,
    });
  });
});
