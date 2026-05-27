import type { ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";

export interface GedExplorerPromptInput {
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

const OUTPUT_SECTIONS = [
  "## Summary",
  "## Scope Inspected",
  "## Findings",
  "## Evidence",
  "## Risks And Constraints",
  "## Open Questions",
  "## Recommended Follow-Up Checks",
] as const;

const formatNullable = (value: string | null): string => value ?? "null";

export const getGedExplorerOutputSections = (): ReadonlyArray<string> => OUTPUT_SECTIONS;

export const buildGedExplorerPrompt = (input: GedExplorerPromptInput): string => {
  const modelInstanceId = input.modelSelection.instanceId;
  const modelId = input.modelSelection.model;

  return [
    "You are ged-explorer, a read-only codebase discovery role.",
    "",
    "Your job is to inspect and report findings for the parent thread. Do not implement.",
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
    "",
    "### Parent Request",
    input.request,
    "",
    "### Role Boundaries",
    "- Read files, search the repository, and inspect relevant context only.",
    "- Do not write source files, .ged files, plans, tests, commits, or artifacts.",
    "- Do not run mutating commands, package installs, formatters, migrations, generators, or commits.",
    "- If implementation is needed, describe findings, risks, and recommended checks only.",
    "- If you cannot answer without mutation, stop and report the limitation.",
    "",
    "### Final Answer Contract",
    "Return plain text only, not JSON. Use these exact top-level sections in this order:",
    "",
    ...OUTPUT_SECTIONS.flatMap((section) => [section, ""]),
  ].join("\n");
};
