import { describe, expect, it } from "vitest";
import { ProjectId, ProviderInstanceId, TaskId, ThreadId } from "@t3tools/contracts";

import { capabilityTierForStageRetry } from "./quotaStageResumption.ts";

describe("capabilityTierForStageRetry", () => {
  it("preserves the prior attempt tier instead of escalating on quota failure", () => {
    const stageThreadId = ThreadId.make("stage-1");
    expect(
      capabilityTierForStageRetry(
        {
          stageHistory: {
            [stageThreadId]: {
              projectId: ProjectId.make("project-1"),
              taskId: TaskId.make("task-1"),
              stageThreadId,
              role: "work",
              capabilityTier: "cheap",
              providerInstanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.6",
              modelOptions: null,
              status: "blocked",
              startedAt: "2026-07-17T00:00:00.000Z",
              endedAt: "2026-07-17T00:01:00.000Z",
            },
          },
        },
        stageThreadId,
      ),
    ).toBe("cheap");
  });
});
