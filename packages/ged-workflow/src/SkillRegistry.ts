export interface GedSkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly autoInstall: boolean;
  readonly userTriggeredOnly: boolean;
}

export const BUNDLED_SKILLS: ReadonlyArray<GedSkillDefinition> = [
  {
    name: "grill-me",
    description: "Structured clarification before planning.",
    autoInstall: true,
    userTriggeredOnly: false,
    content:
      "Ask clarifying questions one at a time before planning.\n\n## Rules\n1. ONE question per turn.\n2. Provide 2-4 recommended answers.\n3. Continue until enough context for SPEC.md.\n4. Summarize and transition to planning.",
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
