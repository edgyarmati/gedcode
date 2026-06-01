import type { GedSubagentRole, ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";

export interface GedRolePromptInput {
  readonly role: GedSubagentRole;
  readonly invocationId: string;
  readonly parentThreadId: ThreadId;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly effectiveCwd: string;
  readonly modelSelection: ModelSelection;
  readonly request: string;
}

export interface GedRolePromptDefinition {
  readonly role: GedSubagentRole;
  readonly title: string;
  readonly summary: string;
  readonly blocking: boolean;
  readonly worktreeStrategy: "inherit-parent" | "separate-by-default";
  readonly runtimeMode: "approval-required";
  readonly interactionMode: "default";
  readonly boundaries: ReadonlyArray<string>;
  readonly outputSections: ReadonlyArray<string>;
}

const SHARED_NO_DELEGATION_BOUNDARIES = [
  "Do not use provider-native subagent, Task, delegation, worker, or multi-agent tools.",
  "Do not ask another in-provider agent to do your assigned role; Gedcode owns role thread orchestration.",
] as const;

const READ_ONLY_BOUNDARIES = [
  "Read files, search the repository, and inspect relevant context only.",
  "Do not implement.",
  "Do not write source files, .ged files, plans, tests, commits, or artifacts.",
  "Do not run mutating commands, package installs, formatters, migrations, generators, or commits.",
  "If implementation is needed, describe findings, risks, and recommended checks only.",
  "If you cannot answer without mutation, stop and report the limitation.",
] as const;

const PLAN_AUTHOR_BOUNDARIES = [
  "Draft or critique plan text only in your final response.",
  "Do not edit files, create artifacts, run formatters, run tests, commit, or push.",
  "Do not make product decisions beyond the provided request; call out decisions that need the parent thread.",
] as const;

const WORKER_BOUNDARIES = [
  "Implement only the bounded task explicitly assigned in the parent request.",
  "Do not commit, push, merge, rebase, publish, or open pull requests.",
  "Do not make product, security, architecture, scope, or migration decisions; stop and report if those are required.",
  "Do not edit files outside the assigned scope. If the scope is unclear or unsafe, stop and report the blocker.",
  "Report changed files, verification performed, risks, and handoff notes for the parent thread.",
] as const;

export const GED_ROLE_PROMPT_DEFINITIONS: Readonly<
  Record<GedSubagentRole, GedRolePromptDefinition>
> = {
  "ged-explorer": {
    role: "ged-explorer",
    title: "Ged Explorer",
    summary: "read-only codebase discovery and evidence gathering.",
    blocking: true,
    worktreeStrategy: "inherit-parent",
    runtimeMode: "approval-required",
    interactionMode: "default",
    boundaries: [...READ_ONLY_BOUNDARIES],
    outputSections: [
      "## Summary",
      "## Scope Inspected",
      "## Findings",
      "## Evidence",
      "## Risks And Constraints",
      "## Open Questions",
      "## Recommended Follow-Up Checks",
    ],
  },
  "ged-planner": {
    role: "ged-planner",
    title: "Ged Planner",
    summary: "Draft implementation SPEC/TASKS/TESTS content for the parent thread.",
    blocking: true,
    worktreeStrategy: "inherit-parent",
    runtimeMode: "approval-required",
    interactionMode: "default",
    boundaries: [...READ_ONLY_BOUNDARIES, ...PLAN_AUTHOR_BOUNDARIES],
    outputSections: [
      "## SPEC.md Draft",
      "## TASKS.md Draft",
      "## TESTS.md Draft",
      "## Assumptions",
      "## Open Questions",
    ],
  },
  "ged-plan-reviewer": {
    role: "ged-plan-reviewer",
    title: "Ged Plan Reviewer",
    summary: "Risk-based critique of accepted Ged plans before implementation.",
    blocking: true,
    worktreeStrategy: "inherit-parent",
    runtimeMode: "approval-required",
    interactionMode: "default",
    boundaries: [...READ_ONLY_BOUNDARIES, ...PLAN_AUTHOR_BOUNDARIES],
    outputSections: ["## Verdict", "## Blockers", "## Risks", "## Suggested Plan Edits"],
  },
  "ged-verifier": {
    role: "ged-verifier",
    title: "Ged Verifier",
    summary: "Clean-context verification review before commit.",
    blocking: true,
    worktreeStrategy: "inherit-parent",
    runtimeMode: "approval-required",
    interactionMode: "default",
    boundaries: [...READ_ONLY_BOUNDARIES],
    outputSections: ["## Verdict", "## Findings", "## Verification Evidence", "## Commit Blockers"],
  },
  "ged-worker": {
    role: "ged-worker",
    title: "Ged Worker",
    summary: "Bounded implementation worker for disjoint, low-risk tasks.",
    blocking: false,
    worktreeStrategy: "separate-by-default",
    runtimeMode: "approval-required",
    interactionMode: "default",
    boundaries: [...WORKER_BOUNDARIES],
    outputSections: [
      "## Summary",
      "## Changed Files",
      "## Verification",
      "## Handoff Notes",
      "## Blockers",
    ],
  },
} as const;

const formatNullable = (value: string | null): string => value ?? "null";

export const getGedRoleOutputSections = (role: GedSubagentRole): ReadonlyArray<string> =>
  GED_ROLE_PROMPT_DEFINITIONS[role].outputSections;

export const buildGedRolePrompt = (input: GedRolePromptInput): string => {
  const definition = GED_ROLE_PROMPT_DEFINITIONS[input.role];
  const modelInstanceId = input.modelSelection.instanceId;
  const modelId = input.modelSelection.model;

  return [
    `You are ${input.role}, a Gedcode-managed child thread role.`,
    "",
    definition.summary,
    "",
    "Gedcode launched you as a separate child thread with the configured role provider/model.",
    "Do not use provider-native subagent, Task, delegation, worker, or multi-agent tools.",
    "Return your result to the parent thread through your final response only.",
    "",
    "### Invocation Context",
    `- Invocation id: ${input.invocationId}`,
    `- Parent thread id: ${input.parentThreadId}`,
    `- Project id: ${input.projectId}`,
    `- Workspace root: ${input.workspaceRoot}`,
    `- Branch: ${formatNullable(input.branch)}`,
    `- Worktree path: ${formatNullable(input.worktreePath)}`,
    `- Effective cwd: ${input.effectiveCwd}`,
    `- Model instance id: ${modelInstanceId}`,
    `- Model: ${modelId}`,
    `- Blocking role: ${definition.blocking ? "yes" : "no"}`,
    `- Worktree strategy: ${definition.worktreeStrategy}`,
    "",
    "### Parent Request",
    input.request,
    "",
    "### Role Boundaries",
    ...definition.boundaries.map((boundary) => `- ${boundary}`),
    ...SHARED_NO_DELEGATION_BOUNDARIES.map((boundary) => `- ${boundary}`),
    "",
    "### Final Answer Contract",
    "Return plain text only, not JSON. Use these exact top-level sections in this order:",
    "",
    ...definition.outputSections.flatMap((section) => [section, ""]),
  ].join("\n");
};
