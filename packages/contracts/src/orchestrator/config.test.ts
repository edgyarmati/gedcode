import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  DEFAULT_MAX_PARALLEL_TASKS,
  DEFAULT_MAX_PARALLEL_WORKERS,
  DEFAULT_MAX_STAGE_HANDOFFS,
  OrchestratorGlobalDefaults,
  OrchestratorProjectConfig,
} from "./config.ts";

const decodeProjectConfig = Schema.decodeUnknownSync(OrchestratorProjectConfig);
const encodeProjectConfig = Schema.encodeSync(OrchestratorProjectConfig);
const decodeGlobalDefaults = Schema.decodeUnknownSync(OrchestratorGlobalDefaults);

describe("OrchestratorProjectConfig — allowFullAccessWorkers invariant (design §7)", () => {
  it("defaults allowFullAccessWorkers to false (the runtime-mode clamp anchor)", () => {
    // Empty config: this is the safe-by-default floor a hallucinated/injected
    // PM cannot move. If this regresses, the WP-E runtime-mode clamp can be
    // bypassed via a config that simply omits the flag.
    const decoded = decodeProjectConfig({});
    expect(decoded.resourceLimits.allowFullAccessWorkers).toBe(false);
  });

  it("keeps the false default even when other resourceLimits fields are set", () => {
    const decoded = decodeProjectConfig({
      resourceLimits: { maxParallelTasks: 2, maxParallelWorkers: 3, maxStageHandoffs: 5 },
    });
    expect(decoded.resourceLimits.maxParallelTasks).toBe(2);
    expect(decoded.resourceLimits.maxParallelWorkers).toBe(3);
    expect(decoded.resourceLimits.maxStageHandoffs).toBe(5);
    expect(decoded.resourceLimits.allowFullAccessWorkers).toBe(false);
  });

  it("honors an explicit human-set allowFullAccessWorkers=true opt-in", () => {
    const decoded = decodeProjectConfig({ resourceLimits: { allowFullAccessWorkers: true } });
    expect(decoded.resourceLimits.allowFullAccessWorkers).toBe(true);
  });

  it("global defaults also floor allowFullAccessWorkers to false", () => {
    const decoded = decodeGlobalDefaults({});
    expect(decoded.allowFullAccessWorkers).toBe(false);
  });
});

describe("OrchestratorProjectConfig — safe-by-default shape", () => {
  it("defaults to disabled with a require-approval feature task type", () => {
    const decoded = decodeProjectConfig({});
    expect(decoded.enabled).toBe(false);
    expect(decoded.pmModelSelection).toBe(null);
    expect(decoded.taskTypes).toHaveLength(1);
    const feature = decoded.taskTypes[0];
    expect(feature?.id).toBe("feature");
    expect(feature?.stages).toEqual(["classify", "plan", "work"]);
    expect(feature?.gatePolicy.plan).toBe("require-approval");
    expect(feature?.gatePolicy.land).toBe("require-approval");
  });

  it("defaults the resource limits to the safe constants", () => {
    const decoded = decodeProjectConfig({});
    expect(decoded.resourceLimits.maxParallelTasks).toBe(DEFAULT_MAX_PARALLEL_TASKS);
    expect(decoded.resourceLimits.maxParallelWorkers).toBe(DEFAULT_MAX_PARALLEL_WORKERS);
    expect(decoded.resourceLimits.maxStageHandoffs).toBe(DEFAULT_MAX_STAGE_HANDOFFS);
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
      enabled: true,
      pmModelSelection: { instanceId: "codex", model: "gpt-5.5" },
      taskTypes: [
        {
          id: "feature",
          stages: ["classify", "plan", "work"],
          gatePolicy: { plan: "auto", land: "require-approval" },
        },
      ],
      resourceLimits: {
        maxParallelTasks: 2,
        maxParallelWorkers: 2,
        maxStageHandoffs: 12,
        allowFullAccessWorkers: true,
      },
    });

    const encoded = encodeProjectConfig(decoded);
    const reDecoded = decodeProjectConfig(encoded);

    expect(reDecoded).toEqual(decoded);
    expect(reDecoded.enabled).toBe(true);
    expect(reDecoded.pmModelSelection?.instanceId).toBe("codex");
    expect(reDecoded.pmModelSelection?.model).toBe("gpt-5.5");
    expect(reDecoded.taskTypes[0]?.gatePolicy.plan).toBe("auto");
    expect(reDecoded.resourceLimits.allowFullAccessWorkers).toBe(true);
  });
});
