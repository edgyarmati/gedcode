import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS,
  DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_RESERVE_TOKENS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  TaskTypeId,
  type OrchestratorProjectConfig,
  type OrchestratorTaskType,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  findTaskType,
  resolveAutoCompaction,
  resolveAllowFullAccessWorkers,
  resolveConfigValue,
  resolveGatePolicy,
  resolveResourceLimit,
  resolveResourceLimits,
  resolveStages,
} from "./orchestrator.ts";

const featureTaskType = {
  id: "feature",
  stages: ["classify", "plan", "work"],
  gatePolicy: {
    classify: "require-approval",
    plan: "auto",
    work: "require-approval",
    review: "auto",
    land: "require-approval",
  },
} as const satisfies OrchestratorTaskType;

const projectConfig = (
  taskTypes: ReadonlyArray<OrchestratorTaskType> = [featureTaskType],
): OrchestratorProjectConfig => ({
  enabled: true,
  pmModelSelection: null,
  taskTypes,
  resourceLimits: {
    maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,
    maxParallelWorkers: 1,
    maxStageHandoffs: 8,
    maxRetriesPerStage: DEFAULT_MAX_RETRIES_PER_STAGE,
    allowFullAccessWorkers: false,
  },
});

describe("resolveConfigValue", () => {
  it("returns a value present only in the lowest layer", () => {
    expect(resolveConfigValue([undefined, null, "lowest"], "fallback")).toBe("lowest");
  });

  it("prefers a higher layer over a lower layer", () => {
    expect(resolveConfigValue([undefined, "highest", "lowest"], "fallback")).toBe("highest");
  });

  it("returns the fallback when all layers are empty", () => {
    expect(resolveConfigValue([undefined, null], "fallback")).toBe("fallback");
  });
});

describe("findTaskType", () => {
  it("returns the configured task type when it exists", () => {
    expect(findTaskType(projectConfig(), TaskTypeId.make("feature"))).toBe(featureTaskType);
  });

  it("returns undefined when the task type is absent", () => {
    expect(findTaskType(projectConfig(), "maintenance")).toBeUndefined();
  });
});

describe("resolveGatePolicy", () => {
  it("returns the configured task-type gate policy", () => {
    expect(
      resolveGatePolicy({
        config: projectConfig(),
        taskTypeId: "feature",
        gate: "plan",
      }),
    ).toBe("auto");
  });

  it("falls back to require-approval for an unknown task type", () => {
    expect(
      resolveGatePolicy({
        config: projectConfig(),
        taskTypeId: "maintenance",
        gate: "plan",
      }),
    ).toBe("require-approval");
  });

  it("resolves from global defaults when the project gate policy entry is missing", () => {
    expect(
      resolveGatePolicy({
        config: { taskTypes: [{ id: "feature", gatePolicy: {} }] },
        defaults: { gatePolicy: { review: "auto" } },
        taskTypeId: "feature",
        gate: "review",
      }),
    ).toBe("auto");
  });

  it("prefers project gate policy over global defaults", () => {
    expect(
      resolveGatePolicy({
        config: { taskTypes: [{ id: "feature", gatePolicy: { review: "require-approval" } }] },
        defaults: { gatePolicy: { review: "auto" } },
        taskTypeId: "feature",
        gate: "review",
      }),
    ).toBe("require-approval");
  });

  it("falls back to require-approval for a missing gate policy entry", () => {
    const sparseGateConfig = projectConfig([
      {
        ...featureTaskType,
        gatePolicy: { plan: "auto", land: "require-approval" },
      } as unknown as OrchestratorTaskType,
    ]);

    expect(
      resolveGatePolicy({
        config: sparseGateConfig,
        taskTypeId: "feature",
        gate: "review",
      }),
    ).toBe("require-approval");
  });

  it("always requires approval for land even if malformed config says auto", () => {
    const invalidLandConfig = projectConfig([
      {
        ...featureTaskType,
        gatePolicy: { ...featureTaskType.gatePolicy, land: "auto" },
      } as unknown as OrchestratorTaskType,
    ]);

    expect(
      resolveGatePolicy({
        config: invalidLandConfig,
        taskTypeId: "feature",
        gate: "land",
      }),
    ).toBe("require-approval");
  });

  it("always requires approval for land even if global defaults say auto", () => {
    expect(
      resolveGatePolicy({
        config: { taskTypes: [] },
        defaults: { gatePolicy: { land: "auto" } },
        taskTypeId: "feature",
        gate: "land",
      }),
    ).toBe("require-approval");
  });
});

describe("resolveStages", () => {
  it("resolves stages from global defaults when the project layer is empty", () => {
    expect(
      resolveStages({
        config: { taskTypes: [] },
        defaults: { stages: ["classify", "plan", "work", "verify"] },
        taskTypeId: "feature",
      }),
    ).toEqual(["classify", "plan", "work", "verify"]);
  });

  it("prefers project stages over global defaults", () => {
    expect(
      resolveStages({
        config: { taskTypes: [{ id: "feature", stages: ["classify", "plan", "work"] }] },
        defaults: { stages: ["classify", "plan", "review", "work", "verify"] },
        taskTypeId: "feature",
      }),
    ).toEqual(["classify", "plan", "work"]);
  });
});

describe("resolveResourceLimit", () => {
  it("resolves numeric limits from global defaults when the project layer is empty", () => {
    expect(
      resolveResourceLimit({
        config: { resourceLimits: {} },
        defaults: { maxParallelTasks: 4 },
        key: "maxParallelTasks",
      }),
    ).toBe(4);
  });

  it("prefers project numeric limits over global defaults", () => {
    expect(
      resolveResourceLimit({
        config: { resourceLimits: { maxParallelWorkers: 3 } },
        defaults: { maxParallelWorkers: 7 },
        key: "maxParallelWorkers",
      }),
    ).toBe(3);
  });

  it("falls back to the safe default constant when project and global layers are empty", () => {
    expect(
      resolveResourceLimit({
        config: { resourceLimits: {} },
        defaults: {},
        key: "maxRetriesPerStage",
      }),
    ).toBe(DEFAULT_MAX_RETRIES_PER_STAGE);
  });

  it("preserves allowFullAccessWorkers OR semantics", () => {
    expect(
      resolveAllowFullAccessWorkers({
        config: { resourceLimits: { allowFullAccessWorkers: false } },
        defaults: { allowFullAccessWorkers: true },
      }),
    ).toBe(true);
    expect(
      resolveAllowFullAccessWorkers({
        config: { resourceLimits: { allowFullAccessWorkers: true } },
        defaults: { allowFullAccessWorkers: false },
      }),
    ).toBe(true);
    expect(
      resolveAllowFullAccessWorkers({
        config: { resourceLimits: {} },
        defaults: {},
      }),
    ).toBe(false);
  });

  it("resolves the full resource-limits object from project, defaults, and safe constants", () => {
    expect(
      resolveResourceLimits({
        config: { resourceLimits: { maxParallelTasks: 2, allowFullAccessWorkers: true } },
        defaults: { maxParallelWorkers: 5, maxStageHandoffs: 10 },
      }),
    ).toEqual({
      maxParallelTasks: 2,
      maxParallelWorkers: 5,
      maxStageHandoffs: 10,
      maxRetriesPerStage: DEFAULT_MAX_RETRIES_PER_STAGE,
      allowFullAccessWorkers: true,
    });
  });
});

describe("resolveAutoCompaction", () => {
  it("resolves auto-compaction from global defaults and safe constants", () => {
    expect(
      resolveAutoCompaction({
        defaults: {
          autoCompaction: {
            enabled: false,
            reserveTokens: 9_000,
          },
        },
      }),
    ).toEqual({
      enabled: false,
      reserveTokens: 9_000,
      keepRecentTokens: DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS,
    });
  });

  it("prefers a future project layer over global auto-compaction defaults", () => {
    expect(
      resolveAutoCompaction({
        config: {
          autoCompaction: {
            enabled: false,
            customInstructions: "Keep the active task ledger.",
          },
        },
        defaults: {
          autoCompaction: {
            enabled: true,
            reserveTokens: 9_000,
            keepRecentTokens: 10_000,
            customInstructions: "Global instructions",
          },
        },
      }),
    ).toEqual({
      enabled: false,
      reserveTokens: 9_000,
      keepRecentTokens: 10_000,
      customInstructions: "Keep the active task ledger.",
    });
  });

  it("falls back to safe auto-compaction constants when all layers are empty", () => {
    expect(resolveAutoCompaction({ defaults: {} })).toEqual({
      enabled: true,
      reserveTokens: DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_RESERVE_TOKENS,
      keepRecentTokens: DEFAULT_ORCHESTRATOR_AUTO_COMPACTION_KEEP_RECENT_TOKENS,
    });
  });
});
