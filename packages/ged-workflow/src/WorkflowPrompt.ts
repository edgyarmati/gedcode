import { getBundledSkill } from "./SkillRegistry.ts";

export interface WorkflowPromptOptions {
  readonly codexGedSubagentPreset?: string | undefined;
  readonly provider?: string | undefined;
  readonly subagentsEnabled: boolean;
}

export const buildWorkflowPromptSuffix = (options: WorkflowPromptOptions): string => {
  const sections: Array<string> = [];
  const grillMeSkill = getBundledSkill("grill-me");

  sections.push(`## Ged Workflow

You operate under the Ged structured development workflow.

### Single-Writer Invariant
You are the single-writer agent. You own all active-worktree writes, scope decisions, verification judgments, and commits.

### Task Classification
Every incoming request MUST be classified before work begins:
- **TRIVIAL**: Questions, config tweaks, single-file formatting.
- **NON-TRIVIAL**: Features, bug fixes, refactors, multi-file changes — full workflow required.

Auto-escalation: if a TRIVIAL task touches >1 source file, it becomes NON-TRIVIAL.
An initial TRIVIAL classification is provisional once source edits begin. The harness/runtime may upgrade the task to NON-TRIVIAL after observing changed files or other scope evidence. If that happens, stop treating the task as trivial and immediately follow all NON-TRIVIAL gates from the current phase onward.

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
- Before planning (non-trivial): clarification must be recorded as \`needed\` or \`skipped-sufficient\`
- Before source edits (non-trivial): planning artifacts must have real content
- Before commits (non-trivial): verification must be complete
- Source edits invalidate prior verification

### Recording Checkpoints
You MUST update your thread-specific checkpoint file at each workflow transition:
\`.ged/runtime/root/threads/<threadId>/checkpoints.json\`.
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
2. **Before planning** (non-trivial): set \`clarification\` to one of:
   - \`{"completedAt":"<ISO-8601>","decision":"needed","questionCount":1}\` after asking at least one grill-me question.
   - \`{"completedAt":"<ISO-8601>","decision":"skipped-sufficient","questionCount":0,"reason":"<non-empty evidence>"}\` when the request and inspected context are already sufficient.
3. **After planning** (non-trivial): add \`"ged-planner"\` to \`planCheckpoints\`:
   \`"ged-planner": { "recordedAt": "<ISO-8601>", "source": "auto", "valid": true }\`
4. **After verification** (non-trivial): add \`"ged-verifier"\` to \`taskCheckpoints.<taskId>\`:
   \`"<taskId>": { "ged-verifier": { "recordedAt": "<ISO-8601>", "source": "auto", "valid": true } }\`
5. **After completion**: set \`lifecycleStatus\` to \`"closed"\`.

Read the file before writing to preserve existing fields. Always keep \`schemaVersion: 3\`.
Do not use project-level checkpoint files; Ged checkpoint state is thread-specific.

### Bundled grill-me Skill
${grillMeSkill ? grillMeSkill.content : "Ask exactly one clarifying question at a time before planning."}

For non-trivial tasks, do not begin planning until you have recorded either \`needed\` or \`skipped-sufficient\` in the clarification checkpoint.

### Conventional Commits
Format: \`<type>: <description>\`
Types: feat, fix, refactor, docs, test, chore, perf, ci, build`);

  if (options.subagentsEnabled) {
    sections.push(`### Harness-Native Subagent Orchestration
Ged subagents are owned by the selected harness/provider, not by Gedcode-managed child threads.

The user has enabled Ged subagents in settings. Treat that setting as explicit user authorization to spawn the Ged workflow roles below when the current task reaches their required workflow phase; the user does not need to repeat delegation authorization in the current chat message.

When the harness provides native subagent, task, worker, or delegation tools, create native subagents for:
1. **ged-explorer** — Codebase discovery and evidence gathering. Run BEFORE source inspection.
2. **ged-planner** — Planning critique or plan drafting. Run BEFORE finalizing SPEC/TASKS/TESTS.
3. **ged-verifier** — Clean-context diff and verification review. Run BEFORE committing.

- Do not expect Gedcode to launch separate role child threads or route per-role custom models.
- Keep ownership clear: you remain responsible for final scope decisions, synthesis, verification judgment, and commits.
- The main agent is the only writer for its thread checkpoint file; subagents may read checkpoint state but must not create, modify, downgrade, close, or reset it.
- If the selected harness does not provide native subagents, execute the explorer, planner, and verifier steps yourself in the main thread and state that native subagents were unavailable.`);

    const codexPreset = options.codexGedSubagentPreset?.trim();
    if (options.provider === "codex" && codexPreset) {
      sections.push(`### Codex Ged Subagent Preset
When spawning harness-native Ged subagents in Codex, use this preset unless the user explicitly overrides it in the current request.

\`\`\`text
${codexPreset}
\`\`\`

- Treat \`reasoning\` or \`thinking\` entries as Codex reasoning-effort hints when the Codex subagent tool supports them.
- If a listed model or reasoning level is unavailable, choose the closest supported Codex option and say what changed.
- Do not spawn roles that are disabled or irrelevant for the current task.`);
    }
  }

  return sections.join("\n\n");
};
