import * as Effect from "effect/Effect";
import * as Data from "effect/Data";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import { TASK_WORKTREE_HOOKS_DIR } from "./workerSafety.ts";

export interface TaskNoChangeEvidence {
  readonly baseHead: string;
  readonly head: string;
  readonly dirty: boolean;
}

export class TaskNoChangeInspectionError extends Data.TaggedError("TaskNoChangeInspectionError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export const inspectTaskNoChangeEvidence = Effect.fn("inspectTaskNoChangeEvidence")(
  function* (input: {
    readonly repositoryPath: string;
    readonly branch: string;
    readonly worktreePath?: string;
    readonly process: Pick<VcsProcessShape, "run">;
  }) {
    const ref = `refs/heads/${input.branch}`;
    const [headResult, reflogResult, statusResult] = yield* Effect.all(
      [
        input.process.run({
          operation: "OrchestratorTaskNoChange.head",
          command: "git",
          args: ["rev-parse", "--verify", ref],
          cwd: input.repositoryPath,
        }),
        input.process.run({
          operation: "OrchestratorTaskNoChange.base",
          command: "git",
          args: ["reflog", "show", "--format=%H", ref],
          cwd: input.repositoryPath,
        }),
        input.worktreePath === undefined
          ? Effect.succeed(null)
          : input.process.run({
              operation: "OrchestratorTaskNoChange.status",
              command: "git",
              args: [
                "status",
                "--porcelain=v1",
                "--untracked-files=all",
                "--",
                ".",
                `:(exclude)${TASK_WORKTREE_HOOKS_DIR}/**`,
              ],
              cwd: input.worktreePath,
            }),
      ],
      { concurrency: "unbounded" },
    );
    const head = headResult.stdout.trim();
    const reflogHeads = reflogResult.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const baseHead = reflogHeads.at(-1);
    if (head.length === 0 || baseHead === undefined) {
      return yield* new TaskNoChangeInspectionError({
        detail: `Could not resolve creation baseline for task branch '${input.branch}'.`,
      });
    }
    return {
      baseHead,
      head,
      dirty: statusResult !== null && statusResult.stdout.trim().length > 0,
    } satisfies TaskNoChangeEvidence;
  },
);
