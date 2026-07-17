import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_PARALLEL_WORKERS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  DEFAULT_PM_RECONCILIATION_INTERVAL_MS,
  DEFAULT_WORKTREE_REAPER_INTERVAL_MINUTES,
  OrchestratorGlobalDefaults,
  OrchestratorProjectConfig,
  OrchestratorTaskGatePolicy,
} from "./config.ts";

const decodeProjectConfig = Schema.decodeUnknownSync(OrchestratorProjectConfig);
const encodeProjectConfig = Schema.encodeSync(OrchestratorProjectConfig);
const decodeGlobalDefaults = Schema.decodeUnknownSync(OrchestratorGlobalDefaults);
const encodeGlobalDefaults = Schema.encodeSync(OrchestratorGlobalDefaults);
const decodeTaskGatePolicy = Schema.decodeUnknownSync(OrchestratorTaskGatePolicy);

describe("OrchestratorProjectConfig — legacy worker access setting", () => {
  it("decodes and strips the removed project opt-in", () => {
    const decoded = decodeProjectConfig({
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 3,
        maxRetriesPerStage: 4,
        allowFullAccessWorkers: false,
      },
    });
    expect(decoded.resourceLimits.maxParallelTasks).toBe(2);
    expect(decoded.resourceLimits.maxParallelWorkers).toBe(3);
    expect(decoded.resourceLimits.maxRetriesPerStage).toBe(4);
    expect(decoded.resourceLimits).not.toHaveProperty("allowFullAccessWorkers");
    expect(encodeProjectConfig(decoded).resourceLimits).not.toHaveProperty(
      "allowFullAccessWorkers",
    );
  });

  it("decodes and strips the removed global opt-in", () => {
    const decoded = decodeGlobalDefaults({ allowFullAccessWorkers: true });
    expect(decoded).not.toHaveProperty("allowFullAccessWorkers");
    expect(encodeGlobalDefaults(decoded)).not.toHaveProperty("allowFullAccessWorkers");
  });

  it("defaults PR landing to ready and accepts sparse project draft override", () => {
    const globalDefaults = decodeGlobalDefaults({});
    const projectDefaults = decodeProjectConfig({});
    const projectOverride = decodeProjectConfig({ openPrAsDraft: true });

    expect(globalDefaults.openPrAsDraft).toBe(false);
    expect(projectDefaults.openPrAsDraft).toBe(false);
    expect(projectOverride.openPrAsDraft).toBe(true);
  });

  it("global defaults include durability and cleanup intervals", () => {
    const decoded = decodeGlobalDefaults({});
    expect(decoded.defaultWorkerModelSelection).toBeNull();
    expect(decoded.maxRetriesPerStage).toBe(DEFAULT_MAX_RETRIES_PER_STAGE);
    expect(decoded.pmReconciliationIntervalMs).toBe(DEFAULT_PM_RECONCILIATION_INTERVAL_MS);
    expect(decoded.worktreeReaperIntervalMinutes).toBe(DEFAULT_WORKTREE_REAPER_INTERVAL_MINUTES);
  });

  it("global defaults include the full stage set and require-approval gate policy", () => {
    const decoded = decodeGlobalDefaults({});
    expect(decoded.stages).toEqual(["plan", "work", "verify"]);
    expect(decoded.gatePolicy).toEqual({
      plan: "require-approval",
      land: "require-approval",
    });
  });

  it("round-trips global stage, gate, and resource defaults", () => {
    const decoded = decodeGlobalDefaults({
      stages: ["plan", "work"],
      gatePolicy: {
        plan: "require-approval",
        land: "require-approval",
      },
      maxParallelTasks: 3,
      maxParallelWorkers: 4,
      maxRetriesPerStage: 5,
      pmReconciliationIntervalMs: 120_000,
      worktreeReaperIntervalMinutes: 10,
      pmModelSelection: { instanceId: "claudeAgent", model: "claude-sonnet-4-6" },
      defaultWorkerModelSelection: { instanceId: "codex_worker", model: "gpt-5-worker" },
      openPrAsDraft: true,
    });

    const reDecoded = decodeGlobalDefaults(encodeGlobalDefaults(decoded));

    expect(reDecoded).toEqual(decoded);
    expect(reDecoded.stages).toEqual(["plan", "work"]);
    expect(reDecoded.gatePolicy.land).toBe("require-approval");
    expect(reDecoded.pmModelSelection).toEqual({
      instanceId: "claudeAgent",
      model: "claude-sonnet-4-6",
    });
    expect(reDecoded.defaultWorkerModelSelection).toEqual({
      instanceId: "codex_worker",
      model: "gpt-5-worker",
    });
    expect(reDecoded.openPrAsDraft).toBe(true);
  });
});

describe("OrchestratorProjectConfig — safe-by-default shape", () => {
  it("defaults to a require-approval feature task type", () => {
    const decoded = decodeProjectConfig({});
    expect(decoded.pmModelSelection).toBe(null);
    expect(decoded.capabilityPresets).toEqual({});
    expect(decoded.taskTypes).toHaveLength(1);
    const feature = decoded.taskTypes[0];
    expect(feature?.id).toBe("feature");
    expect(feature?.stages).toEqual(["plan", "work", "verify"]);
    expect(feature?.gatePolicy.plan).toBe("require-approval");
    expect(feature?.gatePolicy.land).toBe("require-approval");
  });

  it("accepts independent project capability preset overrides", () => {
    const decoded = decodeProjectConfig({
      capabilityPresets: {
        smart: {
          instanceId: "codex-smart",
          model: "gpt-5.6-codex",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      },
    });

    expect(decoded.capabilityPresets.smart).toEqual({
      instanceId: "codex-smart",
      model: "gpt-5.6-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
  });

  it("decodes non-feature ids for server-side registry validation", () => {
    const decoded = decodeProjectConfig({ taskTypes: [{ id: "release" }] });

    expect(decoded.taskTypes[0]?.id).toBe("release");
  });

  it("defaults the resource limits to the safe constants", () => {
    const decoded = decodeProjectConfig({});
    expect(decoded.resourceLimits.maxParallelTasks).toBe(DEFAULT_MAX_PARALLEL_TASKS);
    expect(decoded.resourceLimits.maxParallelWorkers).toBe(DEFAULT_MAX_PARALLEL_WORKERS);
    expect(decoded.resourceLimits.maxRetriesPerStage).toBe(DEFAULT_MAX_RETRIES_PER_STAGE);
  });
});

describe("OrchestratorGlobalDefaults — capability presets", () => {
  const completePresets = {
    cheap: { instanceId: "codex-cheap", model: "gpt-5.6-mini" },
    smart: { instanceId: "codex-smart", model: "gpt-5.6-codex" },
    genius: { instanceId: "claude-genius", model: "claude-opus-4-6" },
  } as const;

  it("uses null as the explicit pre-migration state", () => {
    expect(decodeGlobalDefaults({}).capabilityPresets).toBeNull();
  });

  it("round-trips a complete Cheap/Smart/Genius map", () => {
    const decoded = decodeGlobalDefaults({ capabilityPresets: completePresets });
    expect(decodeGlobalDefaults(encodeGlobalDefaults(decoded)).capabilityPresets).toEqual(
      completePresets,
    );
  });

  it("rejects incomplete and unknown preset maps", () => {
    expect(() =>
      decodeGlobalDefaults({ capabilityPresets: { cheap: completePresets.cheap } }),
    ).toThrow();
    expect(() =>
      decodeGlobalDefaults({
        capabilityPresets: { ...completePresets, ultra: completePresets.smart },
      }),
    ).toThrow();
    expect(() =>
      decodeProjectConfig({ capabilityPresets: { fast: completePresets.cheap } }),
    ).toThrow();
  });
});

describe("OrchestratorTaskGatePolicy", () => {
  it("rejects auto policy for the terminal land gate", () => {
    expect(() => decodeTaskGatePolicy({ land: "auto" })).toThrow();
  });

  it("accepts automatic plan approval while keeping land human-gated", () => {
    const decoded = decodeTaskGatePolicy({
      plan: "auto",
      land: "require-approval",
    });

    expect(decoded.plan).toBe("auto");
    expect(decoded.land).toBe("require-approval");
  });
});

describe("OrchestratorProjectConfig — schema round-trip (encode/decode)", () => {
  it("round-trips the defaulted config (decode → encode → decode is stable)", () => {
    const decoded = decodeProjectConfig({});
    const reDecoded = decodeProjectConfig(encodeProjectConfig(decoded));
    expect(reDecoded).toEqual(decoded);
  });

  it("round-trips a fully-specified config without loss", () => {
    const decoded = decodeProjectConfig({
      pmModelSelection: {
        instanceId: "claudeAgent",
        model: "claude-opus-4-8",
        options: [{ id: "contextWindow", value: "1m" }],
      },
      taskTypes: [
        {
          id: "feature",
          stages: ["plan", "work", "verify"],
          gatePolicy: {
            plan: "auto",
            land: "require-approval",
          },
        },
      ],
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 2,
        maxRetriesPerStage: 3,
      },
      openPrAsDraft: true,
    });

    const encoded = encodeProjectConfig(decoded);
    const reDecoded = decodeProjectConfig(encoded);

    expect(reDecoded).toEqual(decoded);
    expect(reDecoded.pmModelSelection?.instanceId).toBe("claudeAgent");
    expect(reDecoded.pmModelSelection?.model).toBe("claude-opus-4-8");
    expect(reDecoded.pmModelSelection?.options).toEqual([{ id: "contextWindow", value: "1m" }]);
    expect(reDecoded.taskTypes[0]?.gatePolicy.plan).toBe("auto");
    expect(reDecoded.resourceLimits.maxRetriesPerStage).toBe(3);
    expect(reDecoded.openPrAsDraft).toBe(true);
  });

  it("decodes legacy pi-era PM model selections as unconfigured", () => {
    const decoded = decodeProjectConfig({
      pmModelSelection: { piProvider: "openai", model: "gpt-5.5" },
    });

    expect(decoded.pmModelSelection).toBeNull();
  });

  it("round-trips worker-shaped PM model selections", () => {
    const decoded = decodeProjectConfig({
      pmModelSelection: {
        instanceId: "claudeAgent",
        model: "claude-sonnet-4-6",
        options: [{ id: "effort", value: "high" }],
      },
    });

    expect(decodeProjectConfig(encodeProjectConfig(decoded)).pmModelSelection).toEqual({
      instanceId: "claudeAgent",
      model: "claude-sonnet-4-6",
      options: [{ id: "effort", value: "high" }],
    });
  });
});
