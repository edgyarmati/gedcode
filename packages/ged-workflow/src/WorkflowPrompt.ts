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

### Recording Checkpoints
You MUST update \`.ged/runtime/root/checkpoints.json\` at each workflow transition.
The file uses this schema (schemaVersion 3):

\`\`\`json
{
  "schemaVersion": 3,
  "lifecycleStatus": "active",
  "classification": "trivial",
  "classificationReason": "...",
  "planCheckpoints": {},
  "taskCheckpoints": {}
}
\`\`\`

**When to update:**
1. **After classification**: set \`classification\` to \`"trivial"\` or \`"non-trivial"\` and update \`classificationReason\`.
2. **After planning** (non-trivial): add \`"ged-planner"\` to \`planCheckpoints\`:
   \`"ged-planner": { "recordedAt": "<ISO-8601>", "source": "auto", "valid": true }\`
3. **After verification** (non-trivial): add \`"ged-verifier"\` to \`taskCheckpoints.<taskId>\`:
   \`"<taskId>": { "ged-verifier": { "recordedAt": "<ISO-8601>", "source": "auto", "valid": true } }\`
4. **After completion**: set \`lifecycleStatus\` to \`"closed"\`.

Read the file before writing to preserve existing fields. Always keep \`schemaVersion: 3\`.

### Conventional Commits
Format: \`<type>: <description>\`
Types: feat, fix, refactor, docs, test, chore, perf, ci, build`);

  if (options.subagentsEnabled) {
    sections.push(`### Harness-Native Subagent Orchestration
Ged subagents are owned by the selected harness/provider, not by Gedcode-managed child threads.

When the harness provides native subagent, task, worker, or delegation tools, create native subagents for:
1. **ged-explorer** — Codebase discovery and evidence gathering. Run BEFORE source inspection.
2. **ged-planner** — Planning critique or plan drafting. Run BEFORE finalizing SPEC/TASKS/TESTS.
3. **ged-verifier** — Clean-context diff and verification review. Run BEFORE committing.

- Do not expect Gedcode to launch separate role child threads or route per-role custom models.
- Keep ownership clear: you remain responsible for final scope decisions, synthesis, verification judgment, and commits.
- If the selected harness does not provide native subagents, execute the explorer, planner, and verifier steps yourself in the main thread and state that native subagents were unavailable.`);
  }

  return sections.join("\n\n");
};
