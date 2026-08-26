import type { OrchestrationTaskRebaseProofKind } from "@t3tools/contracts";

export const TASK_REBASE_PROOF_MAX_PATHS = 256;
export const TASK_REBASE_PROOF_MAX_PATH_LENGTH = 4_096;

export const isDocumentationRebasePath = (path: string): boolean =>
  path.startsWith(".ged/") || path.endsWith(".md");

export function classifyTaskRebasePaths(
  paths: ReadonlyArray<string>,
): OrchestrationTaskRebaseProofKind {
  if (paths.length === 0) return "identical";
  return paths.every(isDocumentationRebasePath) ? "docs-only" : "content";
}

export const taskRebaseProofFitsContract = (paths: ReadonlyArray<string>): boolean =>
  paths.length <= TASK_REBASE_PROOF_MAX_PATHS &&
  paths.every((path) => path.length <= TASK_REBASE_PROOF_MAX_PATH_LENGTH);
