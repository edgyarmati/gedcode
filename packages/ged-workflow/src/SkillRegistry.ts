export interface GedSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly autoInstall: boolean;
  readonly userTriggeredOnly: boolean;
}

export const getBundledSkill = (name: string): GedSkillDefinition | undefined =>
  BUNDLED_SKILLS.find((skill) => skill.name === name);

export const renderBundledSkillMarkdown = (skill: GedSkillDefinition): string => `---
name: ${skill.name}
description: ${skill.description}
---

${skill.content}
`;

export const BUNDLED_SKILLS: ReadonlyArray<GedSkillDefinition> = [
  {
    name: "grill-me",
    description: "Structured clarification before planning.",
    autoInstall: true,
    userTriggeredOnly: false,
    content:
      "Interview the user relentlessly before planning until there is shared understanding. Walk the decision tree branch by branch and resolve dependencies between decisions one at a time.\n\n## Rules\n1. First decide explicitly: `grill-me: needed` or `grill-me: skipped; reason: <why sufficient>`.\n2. Ask exactly ONE question per turn when clarification is needed.\n3. Include your recommended answer/default with each question, plus 2-4 options when useful.\n4. If a question can be answered by inspecting project files or prior context, inspect that context instead of asking.\n5. Continue until goal, user-visible behavior, constraints, affected areas/files, non-goals, acceptance criteria, and test expectations are sufficiently clear.\n6. Record the clarification decision before planning: `needed` requires questionCount > 0; `skipped-sufficient` requires a non-empty rationale/evidence.\n7. Summarize the shared understanding and only then transition to planning.",
  },
  {
    name: "ged-planning",
    description: "Write SPEC.md, TASKS.md, and TESTS.md with bounded slices.",
    autoInstall: true,
    userTriggeredOnly: false,
    content:
      "Create planning artifacts in .ged/work/root/.\n\n## Steps\n1. Write SPEC.md — goal, constraints, acceptance criteria.\n2. Write TASKS.md — bounded slices, each 2-15 min.\n3. Write TESTS.md — verification plan.\n4. Update STATE.md — phase=implement, active task=first.",
  },
  {
    name: "ged-execution",
    description: "Execute a single bounded task slice.",
    autoInstall: true,
    userTriggeredOnly: false,
    content:
      "Implement the active task from .ged/work/root/TASKS.md.\n\n## Rules\n1. Read STATE.md for active task.\n2. Implement ONLY that task.\n3. Run verification after.\n4. Update STATE.md: mark complete, set next task.",
  },
  {
    name: "ged-verification",
    description: "Post-implementation verification and state update.",
    autoInstall: true,
    userTriggeredOnly: false,
    content:
      "Verify implementation meets spec.\n\n## Steps\n1. Run all checks (format, lint, typecheck, test).\n2. Review against SPEC.md criteria.\n3. Record evidence in TESTS.md.\n4. Update STATE.md.",
  },
];
