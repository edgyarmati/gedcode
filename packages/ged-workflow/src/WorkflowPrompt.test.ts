import { describe, it, expect } from "vitest";
import { getBundledSkill } from "./SkillRegistry.ts";
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

  it("includes bundled grill-me rules from SkillRegistry", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    const grillMeSkill = getBundledSkill("grill-me");

    expect(grillMeSkill).toBeDefined();
    expect(prompt).toContain(grillMeSkill?.content);
    expect(prompt).toContain("Interview the user relentlessly");
    expect(prompt).toContain("Walk the decision tree branch by branch");
    expect(prompt).toContain("Ask exactly ONE question per turn");
    expect(prompt).toContain("recommended answer/default");
    expect(prompt).toContain("inspect that context instead of asking");
    expect(prompt).toContain("needed");
    expect(prompt).toContain("skipped-sufficient");
  });

  it("requires non-trivial clarification before planning", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("Before planning (non-trivial)");
    expect(prompt).toContain("do not begin planning");
    expect(prompt).toContain('"decision":"needed"');
    expect(prompt).toContain('"decision":"skipped-sufficient"');
    expect(prompt).toContain('"reason":"<non-empty evidence>"');
  });

  it("includes task classification", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("classify");
  });

  it("includes harness-native subagent orchestration when enabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: true });
    expect(prompt).toContain("### Harness-Native Subagent Orchestration");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("ged-planner");
    expect(prompt).toContain("ged-verifier");
    expect(prompt).toContain("selected harness/provider");
    expect(prompt).toContain("subagents may read checkpoint state but must not create");
    expect(prompt).toContain("native subagents were unavailable");
  });

  it("excludes subagents when disabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).not.toContain("ged-explorer");
    expect(prompt).not.toContain("Harness-Native Subagent Orchestration");
  });

  it("includes Codex subagent preset for Codex when subagents are enabled", () => {
    const prompt = buildWorkflowPromptSuffix({
      codexGedSubagentPreset: "ged-explorer: model=gpt-5.4-mini, reasoning=medium",
      provider: "codex",
      subagentsEnabled: true,
    });
    expect(prompt).toContain("### Codex Ged Subagent Preset");
    expect(prompt).toContain("ged-explorer: model=gpt-5.4-mini, reasoning=medium");
    expect(prompt).toContain("reasoning-effort hints");
  });

  it("omits Codex subagent preset for non-Codex providers", () => {
    const prompt = buildWorkflowPromptSuffix({
      codexGedSubagentPreset: "ged-verifier: model=gpt-5.5, reasoning=xhigh",
      provider: "claudeAgent",
      subagentsEnabled: true,
    });
    expect(prompt).not.toContain("### Codex Ged Subagent Preset");
    expect(prompt).not.toContain("ged-verifier: model=gpt-5.5, reasoning=xhigh");
  });

  it("omits Codex subagent preset when subagents are disabled", () => {
    const prompt = buildWorkflowPromptSuffix({
      codexGedSubagentPreset: "ged-planner: model=gpt-5.4, reasoning=high",
      provider: "codex",
      subagentsEnabled: false,
    });
    expect(prompt).not.toContain("### Codex Ged Subagent Preset");
    expect(prompt).not.toContain("ged-planner: model=gpt-5.4, reasoning=high");
  });
});
