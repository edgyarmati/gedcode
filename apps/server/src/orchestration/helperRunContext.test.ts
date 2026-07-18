import {
  HelperRunId,
  ProjectId,
  ProviderInstanceId,
  TaskId,
  type OrchestrationHelperRun,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { appendCompletedHelperContext, sanitizeHelperResult } from "./helperRunContext.ts";

const taskId = TaskId.make("task-helper-context");
const run = (overrides?: Partial<OrchestrationHelperRun>): OrchestrationHelperRun => ({
  id: HelperRunId.make("helper-context"),
  projectId: ProjectId.make("project-helper-context"),
  attachment: { kind: "task", taskId },
  accessMode: "read-only",
  tier: "cheap",
  providerInstanceId: ProviderInstanceId.make("codex-cheap"),
  model: "gpt-cheap",
  modelOptions: null,
  prompt: "Inspect",
  status: "completed",
  providerThreadId: null,
  result: "Found the projection boundary.",
  failureMessage: null,
  createdAt: "2026-07-18T00:00:00.000Z",
  startedAt: "2026-07-18T00:00:01.000Z",
  completedAt: "2026-07-18T00:00:02.000Z",
  updatedAt: "2026-07-18T00:00:02.000Z",
  ...overrides,
});

describe("helper result context", () => {
  it("injects only completed helpers attached to the target task", () => {
    const instructions = appendCompletedHelperContext({
      instructions: "Implement the projection.",
      taskId,
      helperRuns: [
        run(),
        run({ id: HelperRunId.make("helper-running"), status: "running", result: null }),
        run({
          id: HelperRunId.make("helper-other-task"),
          attachment: { kind: "task", taskId: TaskId.make("task-other") },
        }),
      ],
    });

    expect(instructions).toContain("Implement the projection.");
    expect(instructions).toContain("Helper helper-context (cheap, gpt-cheap)");
    expect(instructions).toContain("Found the projection boundary.");
    expect(instructions).not.toContain("helper-running");
    expect(instructions).not.toContain("helper-other-task");
  });

  it("scrubs secrets and bounds helper output before reuse", () => {
    const sanitized = sanitizeHelperResult(
      `Authorization: Bearer ${"x".repeat(40)}\n${"a".repeat(40_000)}`,
    );
    expect(sanitized).not.toContain("x".repeat(40));
    expect(sanitized.length).toBeLessThanOrEqual(32_000);
  });
});
