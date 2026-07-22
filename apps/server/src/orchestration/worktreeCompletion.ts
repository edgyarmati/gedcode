import type {
  OrchestrationStageRole,
  OrchestrationTaskWorktreeCompletion,
  TaskId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import { TASK_WORKTREE_HOOKS_DIR } from "./workerSafety.ts";
import { inspectStageOwnershipViolations } from "./stageOwnership.ts";
import { withTaskLifecycleLock } from "./taskLifecycleCoordinator.ts";

const TASK_WORKTREE_PATHSPEC = [".", `:(exclude)${TASK_WORKTREE_HOOKS_DIR}/**`] as const;
const VERIFICATION_COMMIT_TITLE_MAX_CHARS = 72;
const VERIFICATION_FINALIZATION_ERROR_MAX_CHARS = 4_096;

function verificationCommitSubject(taskTitle: string, taskId: TaskId): string {
  const boundedTitle = taskTitle
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, VERIFICATION_COMMIT_TITLE_MAX_CHARS);
  return `docs: record verification evidence for ${boundedTitle || taskId}`;
}

function boundedFinalizationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    detail.trim().slice(0, VERIFICATION_FINALIZATION_ERROR_MAX_CHARS) ||
    "GedCode could not finalize verifier documentation."
  );
}

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

export const inspectTaskStageStartHead = Effect.fn("inspectTaskStageStartHead")(function* (input: {
  readonly worktreePath: string;
  readonly primaryCheckoutPath: string;
  readonly branch: string;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly fileSystem: Pick<FileSystem.FileSystem, "exists">;
}) {
  if (yield* input.fileSystem.exists(input.worktreePath)) {
    return (yield* inspectTaskWorktreeCompletion(input)).head;
  }

  const result = yield* input.process.run({
    operation: "OrchestratorTaskCompletion.startHead",
    command: "git",
    args: ["rev-parse", "--verify", input.branch],
    cwd: input.primaryCheckoutPath,
  });
  return result.stdout.trim();
});

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

/**
 * Finalizes verifier-owned documentation from the trusted server process.
 *
 * Codex verifier sessions use workspace-write sandboxing. A linked worktree's
 * index, object database, and refs live outside that writable root, so asking
 * the verifier itself to commit creates an impossible prompt/runtime contract.
 * This boundary audits every change against the stage start HEAD, stages only
 * after the audit passes, creates one documentation commit under the per-task
 * lifecycle lock, and re-inspects the exact resulting HEAD before settlement.
 *
 * A Git failure is returned as a dirty, recoverable settlement instead of
 * failing the reactor and leaving an idle verifier stage active forever.
 */
export const finalizeStageWorktreeSettlement = Effect.fn("finalizeStageWorktreeSettlement")(
  function* (input: {
    readonly taskId: TaskId;
    readonly taskTitle: string;
    readonly worktreePath: string;
    readonly process: Pick<VcsProcessShape, "run">;
    readonly role: OrchestrationStageRole;
    readonly startHead: string | undefined;
  }) {
    return yield* withTaskLifecycleLock(
      input.taskId,
      Effect.gen(function* () {
        const initial = yield* inspectStageWorktreeSettlement(input);
        if (input.role !== "verify" || initial.worktreeCompletion.dirty === false) {
          return initial;
        }
        if ((initial.ownershipViolationPaths?.length ?? 0) > 0) {
          return initial;
        }
        if (input.startHead === undefined) {
          return {
            ...initial,
            verificationFinalizationError:
              "GedCode cannot safely commit verifier documentation because the stage start HEAD is unavailable.",
          };
        }
        const startHead = input.startHead;

        const commitResult = yield* Effect.result(
          Effect.gen(function* () {
            yield* input.process.run({
              operation: "OrchestratorVerifyFinalization.stageDocumentation",
              command: "git",
              args: ["add", "-A", "--", ...TASK_WORKTREE_PATHSPEC],
              cwd: input.worktreePath,
            });

            // Re-audit after staging so a path that appeared between inspection
            // and mutation can never be included in the server-owned commit.
            const stagedViolations = yield* inspectStageOwnershipViolations({
              ...input,
              startHead,
            });
            if (stagedViolations.length > 0) {
              return yield* Effect.fail(
                `Verifier finalization stopped because implementation paths changed during audit: ${stagedViolations.join(", ")}`,
              );
            }

            yield* input.process.run({
              operation: "OrchestratorVerifyFinalization.commitDocumentation",
              command: "git",
              args: [
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--no-verify",
                "-m",
                verificationCommitSubject(input.taskTitle, input.taskId),
                "-m",
                `GedCode finalized documentation and verification evidence produced by verifier stage ${input.taskId}.`,
              ],
              cwd: input.worktreePath,
            });
          }),
        );

        const settled = yield* inspectStageWorktreeSettlement(input);
        if (commitResult._tag === "Failure") {
          return {
            ...settled,
            verificationFinalizationError: boundedFinalizationError(commitResult.failure),
          };
        }
        if (settled.worktreeCompletion.dirty) {
          return {
            ...settled,
            verificationFinalizationError:
              "GedCode created the verifier documentation commit, but additional worktree changes remain.",
          };
        }
        return settled;
      }),
    );
  },
);
