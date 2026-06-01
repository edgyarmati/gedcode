import type { ModelSelection, ProjectId, ThreadId } from "@t3tools/contracts";

import { buildGedRolePrompt, getGedRoleOutputSections } from "./GedRolePrompts.ts";

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

export const getGedExplorerOutputSections = (): ReadonlyArray<string> =>
  getGedRoleOutputSections("ged-explorer");

export const buildGedExplorerPrompt = (input: GedExplorerPromptInput): string => {
  return buildGedRolePrompt({ ...input, role: "ged-explorer" });
};
