import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";
import { TASK_WORKTREE_HOOKS_DIR } from "./workerSafety.ts";

const STATUS_PREFIX_LENGTH = 3;
const MAX_DIFF_BYTES = 250_000;

export class TaskChangeReviewError extends Data.TaggedError("TaskChangeReviewError")<{
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface TaskWorktreeChanges {
  readonly head: string;
  readonly dirty: boolean;
  readonly paths: ReadonlyArray<string>;
  readonly staged: boolean;
  readonly diff: string;
  readonly diffTruncated: boolean;
}

const reviewPathspec = [".", `:(exclude)${TASK_WORKTREE_HOOKS_DIR}/**`] as const;

function parsePorcelainPaths(output: string): ReadonlyArray<string> {
  const records = output.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const status = record.slice(0, 2);
    const statusCodes = new Set(status);
    const path = record.slice(STATUS_PREFIX_LENGTH);
    if (path.length > 0) paths.push(path);
    if (statusCodes.has("R") || statusCodes.has("C")) {
      const originalPath = records[index + 1];
      if (originalPath) paths.push(originalPath);
      index += 1;
    }
  }
  return [...new Set(paths)].toSorted();
}

function validateSelectedPaths(
  selectedPaths: ReadonlyArray<string>,
  dirtyPaths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, TaskChangeReviewError> {
  const normalized = [...new Set(selectedPaths.map((path) => path.trim()))];
  if (normalized.length === 0 || normalized.some((path) => path.length === 0)) {
    return Effect.fail(
      new TaskChangeReviewError({ detail: "Select at least one changed task-worktree path." }),
    );
  }
  const dirty = new Set(dirtyPaths);
  for (const path of normalized) {
    if (
      path.startsWith("/") ||
      path === ".." ||
      path.startsWith("../") ||
      path.includes("/../") ||
      path.includes("\\") ||
      path === TASK_WORKTREE_HOOKS_DIR ||
      path.startsWith(`${TASK_WORKTREE_HOOKS_DIR}/`)
    ) {
      return Effect.fail(
        new TaskChangeReviewError({
          detail: `Path '${path}' is outside the reviewable task changes.`,
        }),
      );
    }
    if (!dirty.has(path)) {
      return Effect.fail(
        new TaskChangeReviewError({
          detail: `Path '${path}' is not a current task-worktree change.`,
        }),
      );
    }
  }
  return Effect.succeed(normalized);
}

export const inspectTaskWorktreeChanges = Effect.fn("inspectTaskWorktreeChanges")(
  function* (input: {
    readonly worktreePath: string;
    readonly process: Pick<VcsProcessShape, "run">;
  }) {
    const [head, status, staged, diff] = yield* Effect.all(
      [
        input.process.run({
          operation: "TaskChangeReview.head",
          command: "git",
          args: ["rev-parse", "--verify", "HEAD"],
          cwd: input.worktreePath,
        }),
        input.process.run({
          operation: "TaskChangeReview.status",
          command: "git",
          args: [
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            ...reviewPathspec,
          ],
          cwd: input.worktreePath,
        }),
        input.process.run({
          operation: "TaskChangeReview.staged",
          command: "git",
          args: ["diff", "--cached", "--quiet", "--", ...reviewPathspec],
          cwd: input.worktreePath,
          allowNonZeroExit: true,
        }),
        input.process.run({
          operation: "TaskChangeReview.diff",
          command: "git",
          args: ["diff", "--no-ext-diff", "--binary", "HEAD", "--", ...reviewPathspec],
          cwd: input.worktreePath,
          maxOutputBytes: MAX_DIFF_BYTES,
          appendTruncationMarker: true,
        }),
      ],
      { concurrency: "unbounded" },
    );
    const paths = parsePorcelainPaths(status.stdout);
    if (head.stdout.trim().length === 0) {
      return yield* new TaskChangeReviewError({
        detail: "Task worktree HEAD could not be resolved.",
      });
    }
    if (staged.exitCode !== 0 && staged.exitCode !== 1) {
      return yield* new TaskChangeReviewError({
        detail: `Could not inspect the task index (git diff exited ${staged.exitCode}).`,
      });
    }
    return {
      head: head.stdout.trim(),
      dirty: paths.length > 0,
      paths,
      staged: staged.exitCode !== 0,
      diff: diff.stdout,
      diffTruncated: diff.stdoutTruncated,
    } satisfies TaskWorktreeChanges;
  },
);

function requireDescriptiveCommitMessage(message: string) {
  const normalized = message.trim();
  return normalized.length >= 12 && normalized.split(/\s+/u).length >= 2
    ? Effect.succeed(normalized)
    : Effect.fail(
        new TaskChangeReviewError({
          detail: "Commit message must be descriptive (at least 12 characters and two words).",
        }),
      );
}

function pathsFromPatch(
  patch: string,
): Effect.Effect<ReadonlyArray<string>, TaskChangeReviewError> {
  const paths: string[] = [];
  const fileHeaders: string[] = [];
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
      if (match?.[1] === undefined || match[2] === undefined || match[1] !== match[2]) {
        return Effect.fail(
          new TaskChangeReviewError({
            detail:
              "Scoped patch commits require ordinary, unquoted paths and do not support renames.",
          }),
        );
      }
      paths.push(match[1]);
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const header = line.slice(4);
      if (header === "/dev/null") continue;
      const match = /^[ab]\/(.+)$/u.exec(header);
      if (match?.[1] === undefined) {
        return Effect.fail(
          new TaskChangeReviewError({
            detail: "The selected patch contains an unsafe file header.",
          }),
        );
      }
      fileHeaders.push(match[1]);
    }
  }
  if (paths.length === 0) {
    return Effect.fail(
      new TaskChangeReviewError({ detail: "The selected patch contains no reviewable file diff." }),
    );
  }
  const selected = new Set(paths);
  if (fileHeaders.some((path) => !selected.has(path))) {
    return Effect.fail(
      new TaskChangeReviewError({
        detail: "The selected patch contains an undeclared file change.",
      }),
    );
  }
  return Effect.succeed([...selected]);
}

export const commitTaskWorktreeChanges = Effect.fn("commitTaskWorktreeChanges")(function* (input: {
  readonly worktreePath: string;
  readonly process: Pick<VcsProcessShape, "run">;
  readonly paths?: ReadonlyArray<string>;
  readonly patch?: string;
  readonly message: string;
}) {
  const before = yield* inspectTaskWorktreeChanges(input);
  if (before.staged) {
    return yield* new TaskChangeReviewError({
      detail:
        "The task index already contains staged changes; review or return them before a scoped PM commit.",
    });
  }
  const hasPaths = input.paths !== undefined;
  const hasPatch = input.patch !== undefined;
  if (hasPaths === hasPatch) {
    return yield* new TaskChangeReviewError({
      detail: "Select exactly one commit mode: changed paths or a unified patch.",
    });
  }
  const requestedPaths = hasPaths ? input.paths : yield* pathsFromPatch(input.patch as string);
  const paths = yield* validateSelectedPaths(requestedPaths, before.paths);
  const message = yield* requireDescriptiveCommitMessage(input.message);
  if (hasPatch) {
    yield* input.process.run({
      operation: "TaskChangeReview.checkPatch",
      command: "git",
      args: ["apply", "--cached", "--check", "--unidiff-zero", "--whitespace=nowarn", "-"],
      cwd: input.worktreePath,
      stdin: input.patch,
    });
    yield* input.process.run({
      operation: "TaskChangeReview.stagePatch",
      command: "git",
      args: ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", "-"],
      cwd: input.worktreePath,
      stdin: input.patch,
    });
  } else {
    yield* input.process.run({
      operation: "TaskChangeReview.stageSelection",
      command: "git",
      args: ["add", "-A", "--", ...paths],
      cwd: input.worktreePath,
    });
  }
  const commit = yield* input.process
    .run({
      operation: "TaskChangeReview.commitSelection",
      command: "git",
      args: hasPatch ? ["commit", "-m", message] : ["commit", "-m", message, "--", ...paths],
      cwd: input.worktreePath,
    })
    .pipe(
      Effect.tapError(() =>
        input.process.run({
          operation: "TaskChangeReview.rollbackIndex",
          command: "git",
          args: ["reset", "--quiet", "HEAD", "--", ...paths],
          cwd: input.worktreePath,
          allowNonZeroExit: true,
        }),
      ),
    );
  const after = yield* inspectTaskWorktreeChanges(input);
  return { commit: commit.stdout.trim(), changes: after };
});

export const discardTaskWorktreeChanges = Effect.fn("discardTaskWorktreeChanges")(
  function* (input: {
    readonly worktreePath: string;
    readonly process: Pick<VcsProcessShape, "run">;
    readonly paths: ReadonlyArray<string>;
  }) {
    const before = yield* inspectTaskWorktreeChanges(input);
    const paths = yield* validateSelectedPaths(input.paths, before.paths);
    for (const path of paths) {
      yield* input.process.run({
        operation: "TaskChangeReview.restoreSelection",
        command: "git",
        args: ["restore", "--source", "HEAD", "--staged", "--worktree", "--", path],
        cwd: input.worktreePath,
        allowNonZeroExit: true,
      });
      yield* input.process.run({
        operation: "TaskChangeReview.cleanSelection",
        command: "git",
        args: ["clean", "-fd", "--", path],
        cwd: input.worktreePath,
      });
    }
    const after = yield* inspectTaskWorktreeChanges(input);
    const remainingSelectedPaths = paths.filter((path) => after.paths.includes(path));
    if (remainingSelectedPaths.length > 0) {
      return yield* new TaskChangeReviewError({
        detail: `Could not discard selected path(s): ${remainingSelectedPaths.join(", ")}.`,
      });
    }
    return { changes: after };
  },
);
