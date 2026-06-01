import { describe, it, expect } from "@effect/vitest";
import { buildWorkflowPromptSuffix } from "./WorkflowPrompt.ts";

describe("WorkflowPrompt", () => {
  it("includes single-writer invariant", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("single-writer");
  });

  it("includes checkpoint requirements", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("Checkpoint");
  });

  it("includes task classification", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("classify");
  });

  it("includes subagent orchestration when enabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: true });
    expect(prompt).toContain("### Subagent Orchestration");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("ged-planner");
    expect(prompt).toContain("ged-verifier");
    expect(prompt).toContain("Subagents are read-only");
  });

  it("includes harness-native subagent instructions when configured", () => {
    const prompt = buildWorkflowPromptSuffix({
      subagentsEnabled: true,
      subagentRuntimeMode: "harness-native",
    });
    expect(prompt).toContain("### Harness-Native Subagent Orchestration");
    expect(prompt).toContain("provider-native subagent");
    expect(prompt).toContain("Do not expect Gedcode to launch separate role child threads");
    expect(prompt).not.toContain("Subagents are read-only");
  });

  it("excludes subagents when disabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).not.toContain("ged-explorer");
  });
});
