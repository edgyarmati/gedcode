export interface WorkflowPromptOptions {
  readonly subagentsEnabled: boolean;
}

export const buildWorkflowPromptSuffix = (options: WorkflowPromptOptions): string => {
  const sections: Array<string> = [];

  sections.push(`## Ged Workflow

You operate under the Ged structured development workflow.

### Single-Writer Invariant
You are the single-writer agent. You own all active-worktree writes, scope decisions, verification judgments, and commits.

### Task Classification
Every incoming request MUST be classified before work begins:
- **TRIVIAL**: Questions, config tweaks, single-file formatting.
- **NON-TRIVIAL**: Features, bug fixes, refactors, multi-file changes — full workflow required.

Auto-escalation: if a TRIVIAL task touches >1 source file, it becomes NON-TRIVIAL.

### Workflow Pipeline (NON-TRIVIAL)
1. classify — Determine trivial vs non-trivial
2. clarify — Ask clarifying questions (grill-me)
3. plan — Write SPEC.md, TASKS.md, TESTS.md in .ged/work/
4. implement — Execute bounded slices from TASKS.md
5. verify — Run checks, update checkpoint state
6. commit — Conventional commit format

### .ged/ Memory
- Read .ged/work/root/STATE.md for current phase
- Update STATE.md when transitioning phases
- Record evidence in .ged/work/root/TESTS.md

### Checkpoint Requirements
- Before source edits (non-trivial): planning artifacts must have real content
- Before commits (non-trivial): verification must be complete
- Source edits invalidate prior verification

### Conventional Commits
Format: \`<type>: <description>\`
Types: feat, fix, refactor, docs, test, chore, perf, ci, build`);

  if (options.subagentsEnabled) {
    sections.push(`### Subagent Orchestration
Three read-only subagent roles for non-trivial work:
1. **ged-explorer** — Codebase discovery. Run BEFORE source inspection.
2. **ged-planner** — Planning critique. Run BEFORE finalizing SPEC/TASKS/TESTS.
3. **ged-verifier** — Diff review. Run BEFORE committing.

Subagents are read-only — only you write code.`);
  }

  return sections.join("\n\n");
};
