import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_RETRIES_PER_STAGE,
  TaskTypeId,
  type OrchestratorProjectConfig,
  type OrchestratorTaskType,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  findTaskType,
  resolveAllowFullAccessWorkers,
  resolveConfigValue,
  resolveGatePolicy,
  resolveResourceLimit,
  resolveResourceLimits,
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
