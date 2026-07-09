import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import type { LastOrchestratorProject } from "../../uiStateStore";
import { resolveOrchestratorLandingTarget } from "./orchestratorNav.logic";

function makeRef(environmentId: string, projectId: string): LastOrchestratorProject {
  return {
    environmentId: EnvironmentId.make(environmentId),
    projectId: ProjectId.make(projectId),
  };
}

describe("resolveOrchestratorLandingTarget", () => {
  it("returns the last-visited project when it still exists", () => {
    const lastProject = makeRef("env-1", "proj-1");
    const projectExists = vi.fn(() => true);

    const target = resolveOrchestratorLandingTarget({ lastProject, projectExists });

    expect(target).toBe(lastProject);
    expect(projectExists).toHaveBeenCalledWith(lastProject);
  });

  it("falls back to the grid (null) when the remembered project no longer exists", () => {
    const lastProject = makeRef("env-1", "proj-gone");

    const target = resolveOrchestratorLandingTarget({
      lastProject,
      projectExists: () => false,
    });

    expect(target).toBeNull();
  });

  it("returns null (grid) when no project has been visited yet", () => {
    const projectExists = vi.fn(() => true);

    const target = resolveOrchestratorLandingTarget({ lastProject: null, projectExists });

    expect(target).toBeNull();
    expect(projectExists).not.toHaveBeenCalled();
  });
});
