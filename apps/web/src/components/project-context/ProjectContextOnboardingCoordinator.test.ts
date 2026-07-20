import { describe, expect, it } from "vitest";

import { projectContextRouteTarget } from "./ProjectContextOnboardingCoordinator";

describe("projectContextRouteTarget", () => {
  it("parses encoded Orchestrator project routes before normal chat routes", () => {
    expect(
      projectContextRouteTarget("/orch/local%20environment/project%2Falpha/tasks/task-1"),
    ).toEqual({
      kind: "project",
      environmentId: "local environment",
      projectId: "project/alpha",
    });
  });

  it("parses normal-chat threads and draft routes", () => {
    expect(projectContextRouteTarget("/environment-a/thread-a")).toEqual({
      kind: "thread",
      environmentId: "environment-a",
      threadId: "thread-a",
    });
    expect(projectContextRouteTarget("/draft/draft-a")).toEqual({
      kind: "draft",
      draftId: "draft-a",
    });
  });

  it("rejects incomplete and malformed encoded routes", () => {
    expect(projectContextRouteTarget("/orch/environment-only")).toBeNull();
    expect(projectContextRouteTarget("/draft/%E0%A4%A")).toBeNull();
    expect(projectContextRouteTarget("/environment/%E0%A4%A")).toBeNull();
    expect(projectContextRouteTarget("/")).toBeNull();
  });
});
