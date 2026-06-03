import { GED_SUBAGENT_ROLES, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildGedRolePrompt,
  GED_ROLE_PROMPT_DEFINITIONS,
  getGedRoleOutputSections,
} from "./GedRolePrompts.ts";

const makePrompt = (role: (typeof GED_SUBAGENT_ROLES)[number]) =>
  buildGedRolePrompt({
    role,
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
    request: "Do the assigned role work.",
  });

describe("GED_ROLE_PROMPT_DEFINITIONS", () => {
  it("defines every contracted Ged subagent role", () => {
    expect(Object.keys(GED_ROLE_PROMPT_DEFINITIONS).toSorted()).toEqual(
      [...GED_SUBAGENT_ROLES].toSorted(),
    );
  });

  it("marks only worker as non-blocking and separate-worktree by default", () => {
    for (const role of GED_SUBAGENT_ROLES) {
      const definition = GED_ROLE_PROMPT_DEFINITIONS[role];
      if (role === "ged-worker") {
        expect(definition.blocking).toBe(false);
        expect(definition.worktreeStrategy).toBe("separate-by-default");
      } else {
        expect(definition.blocking).toBe(true);
        expect(definition.worktreeStrategy).toBe("inherit-parent");
      }
    }
  });
});

describe("buildGedRolePrompt", () => {
  it("includes identity, context, no-native-subagent instruction, and output sections for every role", () => {
    for (const role of GED_SUBAGENT_ROLES) {
      const prompt = makePrompt(role);

      expect(prompt).toContain(`You are ${role}`);
      expect(prompt).toContain("Gedcode-managed child thread");
      expect(prompt).toContain("Invocation id: inv-1");
      expect(prompt).toContain("Parent thread id: thread-parent");
      expect(prompt).toContain("Project id: project-1");
      expect(prompt).toContain("Model instance id: codex_default");
      expect(prompt).toContain("Do not use provider-native subagent");
      expect(prompt).toContain("Task, delegation, worker, or multi-agent tools");
      expect(prompt).toContain("Return plain text only, not JSON");

      let previousIndex = -1;
      for (const section of getGedRoleOutputSections(role)) {
        const index = prompt.indexOf(section);
        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }
    }
  });

  it("keeps read-oriented roles non-mutating", () => {
    for (const role of [
      "ged-explorer",
      "ged-planner",
      "ged-plan-reviewer",
      "ged-verifier",
    ] as const) {
      const prompt = makePrompt(role);
      expect(prompt).toContain("Do not run mutating commands");
      expect(prompt).toContain("Do not write source files");
    }
  });

  it("forbids worker commits, pushes, and product decisions", () => {
    const prompt = makePrompt("ged-worker");

    expect(prompt).toContain("Do not commit, push, merge, rebase, publish, or open pull requests.");
    expect(prompt).toContain(
      "Do not make product, security, architecture, scope, or migration decisions",
    );
    expect(prompt).toContain("Do not edit files outside the assigned scope");
  });
});
