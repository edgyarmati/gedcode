import type {
  OrchestrationStageRole,
  OrchestrationTaskWorktreeCompletion,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import { TASK_WORKTREE_HOOKS_DIR } from "./workerSafety.ts";
import { inspectStageOwnershipViolations } from "./stageOwnership.ts";

export const inspectTaskWorktreeCompletion = Effect.fn("inspectTaskWorktreeCompletion")(
  function* (input: {
    readonly worktreePath: string;
    readonly process: Pick<VcsProcessShape, "run">;
  }) {
    const [headResult, statusResult] = yield* Effect.all(
      [
        input.process.run({
          operation: "OrchestratorTaskCompletion.head",
          command: "git",
          args: ["rev-parse", "--verify", "HEAD"],
          cwd: input.worktreePath,
        }),
        input.process.run({
          operation: "OrchestratorTaskCompletion.status",
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
    return {
      head: headResult.stdout.trim(),
      dirty: statusResult.stdout.trim().length > 0,
    } satisfies OrchestrationTaskWorktreeCompletion;
  },
);

export const inspectStageWorktreeSettlement = Effect.fn("inspectStageWorktreeSettlement")(
  function* (input: {
    readonly worktreePath: string;
    readonly process: Pick<VcsProcessShape, "run">;
    readonly role: OrchestrationStageRole;
    readonly startHead: string | undefined;
  }) {
    const worktreeCompletion = yield* inspectTaskWorktreeCompletion(input);
    const ownershipViolationPaths =
      input.startHead === undefined
        ? []
        : yield* inspectStageOwnershipViolations({
            ...input,
            startHead: input.startHead,
          });
    return {
      worktreeCompletion,
      ...(ownershipViolationPaths.length === 0 ? {} : { ownershipViolationPaths }),
    };
  },
);
