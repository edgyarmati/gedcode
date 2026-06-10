import { getBundledSkill } from "./SkillRegistry.ts";

export interface WorkflowPromptOptions {
  readonly codexGedSubagentPreset?: string | undefined;
  readonly provider?: string | undefined;
  readonly roleSettings?: Readonly<Record<string, { readonly enabled?: boolean | undefined }>>;
  readonly subagentsEnabled: boolean;
}

const GED_WORKFLOW_ROLES = ["ged-explorer", "ged-planner", "ged-verifier"] as const;

type GedWorkflowRole = (typeof GED_WORKFLOW_ROLES)[number];

const ROLE_LABELS = {
  "ged-explorer": "Explorer",
  "ged-planner": "Planner",
  "ged-verifier": "Verifier",
} as const satisfies Record<GedWorkflowRole, string>;

function isRoleNativeEnabled(options: WorkflowPromptOptions, role: GedWorkflowRole): boolean {
  return options.subagentsEnabled && options.roleSettings?.[role]?.enabled !== false;
}

function formatRoleModes(options: WorkflowPromptOptions): string {
  return GED_WORKFLOW_ROLES.map((role) => {
    const mode = isRoleNativeEnabled(options, role)
      ? "native subagent; main agent waits for structured evidence"
      : 'main-thread fallback; main agent performs this role and records `source: "main"`';
    return `- **${role}** (${ROLE_LABELS[role]}): ${mode}`;
  }).join("\n");
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

Checkpoint \`source\` values:
- \`"auto"\`: main-confirmed checkpoint backed by enabled native role evidence.
- \`"main"\`: the main agent performed the role because that role was disabled or unavailable.
- \`"manual"\`: explicit human/manual override.

Read the file before writing to preserve existing fields. Always keep \`schemaVersion: 3\`.
Do not use project-level checkpoint files; Ged checkpoint state is thread-specific.

### Bundled grill-me Skill
${grillMeSkill ? grillMeSkill.content : "Ask exactly one clarifying question at a time before planning."}

For non-trivial tasks, do not begin planning until you have recorded either \`needed\` or \`skipped-sufficient\` in the clarification checkpoint.

### Conventional Commits
Format: \`<type>: <description>\`
Types: feat, fix, refactor, docs, test, chore, perf, ci, build`);

  sections.push(`### Ged Role Execution
Ged subagents are owned by the selected harness/provider, not by Gedcode-managed child threads.

Role mode for this turn:
${formatRoleModes(options)}

For enabled native roles, the user has enabled Ged subagents in settings. Treat that setting as explicit user authorization to spawn the role subagent when the current task reaches that required workflow phase; the user does not need to repeat delegation authorization in the current chat message.

For disabled or unavailable roles, execute that role yourself in the main thread and record the same checkpoint gate with \`source: "main"\`.

Strict sequencing:
1. **ged-explorer** — Codebase discovery and evidence gathering. If native-enabled, spawn it before any local source inspection, wait for completion, then consolidate findings. If disabled or unavailable, do the discovery yourself before planning. Record \`planCheckpoints["ged-explorer"]\` after consolidation.
2. **ged-planner** — Planning critique or plan drafting. If native-enabled, spawn it after clarification and wait for completion before finalizing \`SPEC.md\`, \`TASKS.md\`, and \`TESTS.md\`. If disabled or unavailable, perform planning critique yourself. Record \`planCheckpoints["ged-planner"]\` after the plan is finalized.
3. **ged-verifier** — Clean-context diff and verification review. Run required checks first, then if native-enabled spawn verifier and wait for completion before committing. Fix findings, rerun checks, and rerun verifier until there are no blocking findings. If disabled or unavailable, perform the verification review yourself. Record \`taskCheckpoints.<taskId>["ged-verifier"]\` only after verification is clean.

- Do not expect Gedcode to launch separate role child threads or route per-role custom models.
- Keep ownership clear: you remain responsible for final scope decisions, synthesis, verification judgment, and commits.
- The main agent is the only writer for its thread checkpoint file. Subagents may read checkpoint state but must not create, modify, downgrade, close, or reset it.
- Subagents return structured evidence to the main agent; the main agent validates that result and writes checkpoint confirmations.`);

  const codexPreset = options.codexGedSubagentPreset?.trim();
  const hasNativeEnabledRole = GED_WORKFLOW_ROLES.some((role) =>
    isRoleNativeEnabled(options, role),
  );
  if (options.provider === "codex" && codexPreset && hasNativeEnabledRole) {
    sections.push(`### Codex Ged Subagent Preset
When spawning harness-native Ged subagents in Codex, use this preset unless the user explicitly overrides it in the current request.

\`\`\`text
${codexPreset}
\`\`\`

- Each preset line is authoritative for that Ged role. Pass the listed \`model\` as the Codex native subagent tool's model override, and pass \`reasoning\` as the native tool's reasoning-effort override when that field is supported.
- Apply preset lines only to roles currently marked native-enabled in the role mode list above.
- Treat \`reasoning\` or \`thinking\` entries as Codex reasoning-effort hints when the Codex subagent tool supports them.
- If a listed model or reasoning level is unavailable, choose the closest supported Codex option and say what changed.
- Do not spawn roles that are disabled or irrelevant for the current task.`);
  }

  return sections.join("\n\n");
};
