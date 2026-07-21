import type {
  OrchestrationStageRole,
  OrchestrationStageOwnershipViolationPaths,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import { TASK_WORKTREE_HOOKS_DIR } from "./workerSafety.ts";

const DOCUMENTATION_EXTENSIONS = [".adoc", ".md", ".mdx", ".mmd", ".rst", ".txt"];

export function isStageDocumentationPath(path: string): boolean {
  if (path === ".ged/MANIFEST.json" || path.startsWith(".ged/")) {
    return (
      path.endsWith(".json") || DOCUMENTATION_EXTENSIONS.some((suffix) => path.endsWith(suffix))
    );
  }
  return DOCUMENTATION_EXTENSIONS.some((suffix) => path.endsWith(suffix));
}

const parseNulPaths = (output: string): ReadonlyArray<string> =>
  output
    .split("\0")
    .filter((path) => path.length > 0 && !path.startsWith(`${TASK_WORKTREE_HOOKS_DIR}/`));

export const inspectStageOwnershipViolations = Effect.fn("inspectStageOwnershipViolations")(
  function* (input: {
    readonly worktreePath: string;
    readonly startHead: string;
    readonly role: OrchestrationStageRole;
    readonly process: Pick<VcsProcessShape, "run">;
  }) {
    if (input.role !== "plan" && input.role !== "verify") {
      return [] satisfies OrchestrationStageOwnershipViolationPaths;
    }

    const [tracked, untracked] = yield* Effect.all(
      [
        input.process.run({
          operation: "OrchestratorStageOwnership.tracked",
          command: "git",
          args: ["diff", "--name-only", "-z", input.startHead, "--", "."],
          cwd: input.worktreePath,
        }),
        input.process.run({
          operation: "OrchestratorStageOwnership.untracked",
          command: "git",
          args: ["ls-files", "--others", "--exclude-standard", "-z", "--", "."],
          cwd: input.worktreePath,
        }),
      ],
      { concurrency: "unbounded" },
    );

    return [...new Set([...parseNulPaths(tracked.stdout), ...parseNulPaths(untracked.stdout)])]
      .filter((path) => !isStageDocumentationPath(path))
      .toSorted()
      .slice(0, 256) satisfies OrchestrationStageOwnershipViolationPaths;
  },
);
