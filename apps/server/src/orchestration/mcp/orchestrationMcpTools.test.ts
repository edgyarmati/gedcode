import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { mcpInputSchemas, ORCHESTRATION_MCP_TOOL_NAMES } from "./orchestrationMcpTools.ts";

describe("orchestration MCP capability-tier inputs", () => {
  it("requires an explicit tier for every new worker attempt", () => {
    expect(
      z.object(mcpInputSchemas.handoffWorker).safeParse({
        taskId: "task-1",
        role: "work",
        instructions: "Implement the bounded change.",
      }).success,
    ).toBe(false);
    expect(
      z.object(mcpInputSchemas.handoffWorker).safeParse({
        taskId: "task-1",
        role: "work",
        tier: "smart",
        instructions: "Implement the bounded change.",
      }).success,
    ).toBe(true);
  });

  it("exposes semantic task tiers instead of raw task backends", () => {
    expect(ORCHESTRATION_MCP_TOOL_NAMES).toContain("setTaskTier");
    expect(ORCHESTRATION_MCP_TOOL_NAMES).not.toContain("setTaskBackend");
    expect(
      z.object(mcpInputSchemas.setTaskTier).safeParse({
        taskId: "task-1",
        role: "verify",
        tier: "cheap",
      }).success,
    ).toBe(true);
    expect(
      z.object(mcpInputSchemas.setTaskTier).safeParse({
        taskId: "task-1",
        role: "verify",
        tier: "expensive",
      }).success,
    ).toBe(false);
  });

  it("defaults helper tier at execution while validating explicit preset overrides", () => {
    expect(ORCHESTRATION_MCP_TOOL_NAMES).toEqual(
      expect.arrayContaining(["startHelperRun", "inspectHelperRun", "interruptHelperRun"]),
    );
    expect(
      z.object(mcpInputSchemas.startHelperRun).safeParse({
        projectId: "project-1",
        idempotencyKey: "request-1:context",
        prompt: "Inspect the relevant code paths.",
      }).success,
    ).toBe(true);
    expect(
      z.object(mcpInputSchemas.startHelperRun).safeParse({
        projectId: "project-1",
        idempotencyKey: "request-1:context",
        prompt: "Inspect the relevant code paths.",
        taskId: "task-1",
        tier: "genius",
      }).success,
    ).toBe(true);
    expect(
      z.object(mcpInputSchemas.startHelperRun).safeParse({
        projectId: "project-1",
        idempotencyKey: "request-1:context",
        prompt: "Inspect the relevant code paths.",
        tier: "fast",
      }).success,
    ).toBe(false);
  });
});
