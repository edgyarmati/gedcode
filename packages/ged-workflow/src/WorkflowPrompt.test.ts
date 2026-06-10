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

  it("explains runtime escalation after an initial trivial classification", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("initial TRIVIAL classification is provisional");
    expect(prompt).toContain("harness/runtime may upgrade the task to NON-TRIVIAL");
    expect(prompt).toContain("follow all NON-TRIVIAL gates from the current phase onward");
  });

  it("includes strict Ged role execution when enabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: true });
    expect(prompt).toContain("### Ged Role Execution");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("ged-planner");
    expect(prompt).toContain("ged-verifier");
    expect(prompt).toContain("selected harness/provider");
    expect(prompt).toContain("explicit user authorization");
    expect(prompt).toContain("does not need to repeat delegation authorization");
    expect(prompt).toContain("Subagents may read checkpoint state but must not create");
    expect(prompt).toContain("wait for completion");
    expect(prompt).toContain("before any local source inspection");
    expect(prompt).toContain("before finalizing `SPEC.md`, `TASKS.md`, and `TESTS.md`");
    expect(prompt).toContain("rerun verifier until there are no blocking findings");
  });

  it("falls back to main-thread role execution when global subagents are disabled", () => {
    const prompt = buildWorkflowPromptSuffix({ subagentsEnabled: false });
    expect(prompt).toContain("### Ged Role Execution");
    expect(prompt).toContain("ged-explorer");
    expect(prompt).toContain("main-thread fallback");
    expect(prompt).toContain('source: "main"');
    expect(prompt).not.toContain("### Codex Ged Subagent Preset");
  });

  it("uses main fallback for disabled roles while keeping enabled roles native", () => {
    const prompt = buildWorkflowPromptSuffix({
      roleSettings: {
        "ged-explorer": { enabled: false },
        "ged-planner": { enabled: true },
        "ged-verifier": { enabled: true },
      },
      subagentsEnabled: true,
    });

    expect(prompt).toContain(
      "**ged-explorer** (Explorer): main-thread fallback; main agent performs this role",
    );
    expect(prompt).toContain(
      "**ged-planner** (Planner): native subagent; main agent waits for structured evidence",
    );
  });

  it("includes Codex subagent preset for Codex when subagents are enabled", () => {
    const prompt = buildWorkflowPromptSuffix({
      codexGedSubagentPreset: "ged-explorer: model=gpt-5.4-mini, reasoning=medium",
      provider: "codex",
      subagentsEnabled: true,
    });
    expect(prompt).toContain("### Codex Ged Subagent Preset");
    expect(prompt).toContain("ged-explorer: model=gpt-5.4-mini, reasoning=medium");
    expect(prompt).toContain("Pass the listed `model` as the Codex native subagent tool");
    expect(prompt).toContain("reasoning-effort override");
    expect(prompt).toContain("reasoning-effort hints");
    expect(prompt).toContain("roles currently marked native-enabled");
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

  it("omits Codex subagent preset when all roles are main-thread fallback", () => {
    const prompt = buildWorkflowPromptSuffix({
      codexGedSubagentPreset: "ged-planner: model=gpt-5.4, reasoning=high",
      provider: "codex",
      subagentsEnabled: false,
    });
    expect(prompt).not.toContain("### Codex Ged Subagent Preset");
    expect(prompt).not.toContain("ged-planner: model=gpt-5.4, reasoning=high");
  });
});
