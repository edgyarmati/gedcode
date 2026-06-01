import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { buildGedExplorerPrompt, getGedExplorerOutputSections } from "./GedExplorerPrompt.ts";

const prompt = buildGedExplorerPrompt({
  invocationId: "inv-1",
  parentThreadId: ThreadId.make("thread-parent"),
  projectId: ProjectId.make("project-1"),
  workspaceRoot: "/repo",
  branch: "main",
  worktreePath: "/repo-worktree",
  effectiveCwd: "/repo-worktree",
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex_default"),
    model: "gpt-5-codex",
    options: [{ id: "reasoning", value: "high" }],
  },
  request: "Find the orchestration seams.",
});

describe("buildGedExplorerPrompt", () => {
  it("includes role, invocation, project, worktree, and model context", () => {
    expect(prompt).toContain("You are ged-explorer");
    expect(prompt).toContain("Invocation id: inv-1");
    expect(prompt).toContain("Parent thread id: thread-parent");
    expect(prompt).toContain("Project id: project-1");
    expect(prompt).toContain("Workspace root: /repo");
    expect(prompt).toContain("Branch: main");
    expect(prompt).toContain("Worktree path: /repo-worktree");
    expect(prompt).toContain("Effective cwd: /repo-worktree");
    expect(prompt).toContain("Model instance id: codex_default");
    expect(prompt).toContain("Model: gpt-5-codex");
    expect(prompt).toContain("Find the orchestration seams.");
  });

  it("states read-only boundaries and forbids writes/artifacts/commits", () => {
    expect(prompt).toContain("read-only");
    expect(prompt).toContain(
      "Do not write source files, .ged files, plans, tests, commits, or artifacts.",
    );
    expect(prompt).toContain("Do not run mutating commands");
    expect(prompt).toContain("Do not implement");
  });

  it("requires plain text sections in order", () => {
    expect(prompt).toContain("Return plain text only, not JSON");

    let previousIndex = -1;
    for (const section of getGedExplorerOutputSections()) {
      const index = prompt.indexOf(section);
      expect(index).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });
});
