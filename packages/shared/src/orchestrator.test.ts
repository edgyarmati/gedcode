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
  resolveConfigValue,
  resolveGatePolicy,
  resolveOpenPrAsDraft,
  resolveResourceLimit,
  resolveResourceLimits,
  resolveStages,
} from "./orchestrator.ts";

const featureTaskType = {
  id: "feature",
  stages: ["plan", "work", "verify"],
  gatePolicy: {
    plan: "auto",
    land: "require-approval",
  },
} as const satisfies OrchestratorTaskType;

const projectConfig = (
  taskTypes: ReadonlyArray<OrchestratorTaskType> = [featureTaskType],
): OrchestratorProjectConfig => ({
  openPrAsDraft: false,
  pmModelSelection: null,
  capabilityPresets: {},
  taskTypes,
  resourceLimits: {
    maxParallelTasks: DEFAULT_MAX_PARALLEL_TASKS,
    maxParallelWorkers: 1,
    maxRetriesPerStage: DEFAULT_MAX_RETRIES_PER_STAGE,
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
        defaults: { gatePolicy: { plan: "auto" } },
        taskTypeId: "feature",
        gate: "plan",
      }),
    ).toBe("auto");
  });

  it("prefers project gate policy over global defaults", () => {
    expect(
      resolveGatePolicy({
        config: { taskTypes: [{ id: "feature", gatePolicy: { plan: "require-approval" } }] },
        defaults: { gatePolicy: { plan: "auto" } },
        taskTypeId: "feature",
        gate: "plan",
      }),
    ).toBe("require-approval");
  });

  it("falls back to require-approval for a missing optional gate policy entry", () => {
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
        gate: "release",
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

  it("always requires approval for release even if malformed defaults say auto", () => {
    expect(
      resolveGatePolicy({
        config: { taskTypes: [] },
        defaults: { gatePolicy: { release: "auto" } },
        taskTypeId: "release",
        gate: "release",
      }),
    ).toBe("require-approval");
  });
});

describe("resolveStages", () => {
  it("resolves stages from global defaults when the project layer is empty", () => {
    expect(
      resolveStages({
        config: { taskTypes: [] },
        defaults: { stages: ["plan", "work", "verify"] },
        taskTypeId: "feature",
      }),
    ).toEqual(["plan", "work", "verify"]);
  });

  it("prefers project stages over global defaults", () => {
    expect(
      resolveStages({
        config: { taskTypes: [{ id: "feature", stages: ["plan", "work"] }] },
        defaults: { stages: ["plan", "work", "verify"] },
        taskTypeId: "feature",
      }),
    ).toEqual(["plan", "work"]);
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

  it("resolves the full resource-limits object from project, defaults, and safe constants", () => {
    expect(
      resolveResourceLimits({
        config: { resourceLimits: { maxParallelTasks: 2 } },
        defaults: { maxParallelWorkers: 5 },
      }),
    ).toEqual({
      maxParallelTasks: 2,
      maxParallelWorkers: 5,
      maxRetriesPerStage: DEFAULT_MAX_RETRIES_PER_STAGE,
    });
  });
});

describe("resolveOpenPrAsDraft", () => {
  it("prefers project explicit values over global defaults", () => {
    expect(
      resolveOpenPrAsDraft({
        config: { openPrAsDraft: false },
        defaults: { openPrAsDraft: true },
      }),
    ).toBe(false);
    expect(
      resolveOpenPrAsDraft({
        config: { openPrAsDraft: true },
        defaults: { openPrAsDraft: false },
      }),
    ).toBe(true);
  });

  it("falls back to global defaults and then false", () => {
    expect(resolveOpenPrAsDraft({ config: {}, defaults: { openPrAsDraft: true } })).toBe(true);
    expect(resolveOpenPrAsDraft({ config: {}, defaults: {} })).toBe(false);
  });
});
