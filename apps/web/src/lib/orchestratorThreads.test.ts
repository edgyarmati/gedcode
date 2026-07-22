import { describe, expect, it } from "vitest";

import { isOrchestratorManagedThread, pmThreadIdForProject } from "./orchestratorThreads";
import { HelperRunId, ProjectId, TaskId } from "@t3tools/contracts";

describe("orchestrator thread detection", () => {
  it("derives the stable PM thread id for a project", () => {
    expect(pmThreadIdForProject(ProjectId.make("project-1"))).toBe("pm:project-1");
  });

  it("excludes only threads marked with creation-time orchestration ownership", () => {
    expect(
      isOrchestratorManagedThread({
        orchestrationOwnership: { kind: "pm", projectId: ProjectId.make("project-1") },
      }),
    ).toBe(true);
    expect(
      isOrchestratorManagedThread({
        orchestrationOwnership: { kind: "stage", taskId: TaskId.make("task-1") },
      }),
    ).toBe(true);
    expect(
      isOrchestratorManagedThread({
        orchestrationOwnership: { kind: "helper", helperRunId: HelperRunId.make("helper-1") },
      }),
    ).toBe(true);
  });

  it("keeps legacy unclassified threads visible even when their old identifiers look managed", () => {
    expect(isOrchestratorManagedThread({})).toBe(false);
    expect(isOrchestratorManagedThread({ orchestrationOwnership: null })).toBe(false);
  });
});
