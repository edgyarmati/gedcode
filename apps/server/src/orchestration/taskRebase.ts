import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";

import type { VcsProcessOutput, VcsProcessShape } from "../vcs/VcsProcess.ts";
import { prepareTaskRepository } from "./taskRepositoryPreparation.ts";
import {
  classifyTaskRebasePaths,
  isDocumentationRebasePath,
  taskRebaseProofFitsContract,
} from "./taskRebasePolicy.ts";

export { isDocumentationRebasePath } from "./taskRebasePolicy.ts";

const MAX_GIT_OUTPUT_BYTES = 1_000_000;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export class TaskRebaseError extends Data.TaggedError("TaskRebaseError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

export type RebaseProofKind = "identical" | "docs-only" | "content";

export type TaskRebaseOutcome =
  | {
      readonly status: "already-current";
      readonly baseHead: string;
      readonly fromHead: string;
    }
  | {
      readonly status: "rebased";
      readonly baseHead: string;
      readonly fromHead: string;
      readonly toHead: string;
      readonly proofKind: RebaseProofKind;
      readonly paths: ReadonlyArray<string>;
    }
  | {
      readonly status: "doc-conflicts";
      readonly baseHead: string;
      readonly fromHead: string;
      readonly paths: ReadonlyArray<string>;
    }
  | {
      readonly status: "code-conflicts";
      readonly baseHead: string;
      readonly fromHead: string;
      readonly paths: ReadonlyArray<string>;
    }
  | {
      readonly status: "proof-limit";
      readonly baseHead: string;
      readonly fromHead: string;
      readonly pathCount: number;
    };

const isDocsOnly = (paths: ReadonlyArray<string>): boolean =>
  paths.length > 0 && paths.every(isDocumentationRebasePath);

const rebaseError = (detail: string, cause?: unknown) =>
  new TaskRebaseError({ detail, ...(cause === undefined ? {} : { cause }) });

const run = Effect.fn("TaskRebase.run")(function* (
  process: Pick<VcsProcessShape, "run">,
  cwd: string,
  operation: string,
  args: ReadonlyArray<string>,
  allowNonZeroExit = false,
) {
  return yield* process
    .run({
      operation: `TaskRebase.${operation}`,
      command: "git",
      args,
      cwd,
      allowNonZeroExit,
      timeoutMs: 60_000,
      maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
    })
    .pipe(
      Effect.mapError((cause) =>
        rebaseError(`Could not run git ${args.join(" ")} in '${cwd}'.`, cause),
      ),
    );
});

const requireCompleteOutput = (
  result: VcsProcessOutput,
  detail: string,
): Effect.Effect<VcsProcessOutput, TaskRebaseError> =>
  result.stdoutTruncated || result.stderrTruncated
    ? Effect.fail(rebaseError(detail))
    : Effect.succeed(result);

const parseNulPaths = (
  result: VcsProcessOutput,
  detail: string,
): Effect.Effect<ReadonlyArray<string>, TaskRebaseError> =>
  requireCompleteOutput(result, detail).pipe(
    Effect.map(({ stdout }) => stdout.split("\0").filter((path) => path.length > 0)),
  );

const readHead = Effect.fn("TaskRebase.readHead")(function* (
  process: Pick<VcsProcessShape, "run">,
  cwd: string,
  revision = "HEAD",
) {
  const head = (yield* run(process, cwd, "head", [
    "rev-parse",
    "--verify",
    `${revision}^{commit}`,
  ])).stdout.trim();
  if (!OBJECT_ID.test(head)) {
    return yield* rebaseError(`Git returned an invalid commit ID for '${revision}' in '${cwd}'.`);
  }
  return head;
});

const requireCleanVerifiedHead = Effect.fn("TaskRebase.requireCleanVerifiedHead")(
  function* (input: {
    readonly process: Pick<VcsProcessShape, "run">;
    readonly worktreePath: string;
    readonly verifiedHead: string;
  }) {
    const status = yield* run(input.process, input.worktreePath, "status", [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
    ]);
    yield* requireCompleteOutput(
      status,
      `Git status output was truncated while inspecting '${input.worktreePath}'.`,
    );
    if (status.stdout.length > 0) {
      return yield* rebaseError(
        `Cannot rebase because task worktree '${input.worktreePath}' has uncommitted changes. Commit or discard them first.`,
      );
    }
    const head = yield* readHead(input.process, input.worktreePath);
    if (head !== input.verifiedHead) {
      return yield* rebaseError(
        `Task branch HEAD '${head}' no longer matches verified commit '${input.verifiedHead}'. Run a fresh Verify handoff instead of rebasing.`,
      );
    }
    return head;
  },
);

const listConflicts = Effect.fn("TaskRebase.listConflicts")(function* (
  process: Pick<VcsProcessShape, "run">,
  cwd: string,
) {
  return yield* parseNulPaths(
    yield* run(process, cwd, "conflicts", ["diff", "--name-only", "--diff-filter=U", "-z", "--"]),
    `Git conflict output was truncated while rebasing '${cwd}'.`,
  );
});

const probeConflicts = Effect.fn("TaskRebase.probeConflicts")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly fromHead: string;
  readonly baseHead: string;
}) {
  const result = yield* run(
    input.process,
    input.worktreePath,
    "probe",
    [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "--no-messages",
      "-z",
      input.baseHead,
      input.fromHead,
    ],
    true,
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return yield* rebaseError(
      `Could not probe task HEAD '${input.fromHead}' against base '${input.baseHead}': ${result.stderr.trim() || `git merge-tree exited ${result.exitCode}`}`,
    );
  }
  const records = yield* parseNulPaths(
    result,
    `Git conflict-probe output was truncated while inspecting '${input.worktreePath}'.`,
  );
  if (!OBJECT_ID.test(records[0] ?? "")) {
    return yield* rebaseError(
      `Git conflict probe returned an invalid tree ID for '${input.worktreePath}'.`,
    );
  }
  return {
    treeHead: records[0]!,
    conflicted: result.exitCode === 1,
    paths: result.exitCode === 0 ? [] : records.slice(1),
  } as const;
});

const listTreeDiffPaths = Effect.fn("TaskRebase.listTreeDiffPaths")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly operation: "probeProof" | "proof";
  readonly fromHead: string;
  readonly toHead: string;
}) {
  return yield* parseNulPaths(
    yield* run(input.process, input.worktreePath, input.operation, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "--name-only",
      "-z",
      "--no-renames",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=none",
      input.fromHead,
      input.toHead,
      "--",
    ]),
    `Git proof output was truncated while rebasing '${input.worktreePath}'.`,
  );
});

const inspectProof = Effect.fn("TaskRebase.inspectProof")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly fromHead: string;
  readonly toHead: string;
}) {
  const [fromTree, toTree] = yield* Effect.all([
    run(input.process, input.worktreePath, "fromTree", [
      "rev-parse",
      "--verify",
      `${input.fromHead}^{tree}`,
    ]),
    run(input.process, input.worktreePath, "toTree", [
      "rev-parse",
      "--verify",
      `${input.toHead}^{tree}`,
    ]),
  ]);
  if (fromTree.stdout.trim() === toTree.stdout.trim()) {
    return { proofKind: "identical", paths: [] } as const;
  }

  const paths = yield* listTreeDiffPaths({ ...input, operation: "proof" });
  return {
    proofKind: classifyTaskRebasePaths(paths),
    paths,
  } as const;
});

const abortAndVerify = Effect.fn("TaskRebase.abortAndVerify")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly verifiedHead: string;
}) {
  yield* run(input.process, input.worktreePath, "abort", ["rebase", "--abort"]);
  yield* requireCleanVerifiedHead(input);
});

const restoreVerifiedHead = Effect.fn("TaskRebase.restoreVerifiedHead")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly verifiedHead: string;
}) {
  yield* run(input.process, input.worktreePath, "restore", [
    "-c",
    "core.hooksPath=/dev/null",
    "reset",
    "--hard",
    input.verifiedHead,
  ]);
  yield* requireCleanVerifiedHead(input);
});

const classifyStoppedRebase = Effect.fn("TaskRebase.classifyStoppedRebase")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly verifiedHead: string;
  readonly baseHead: string;
  readonly stderr: string;
}) {
  const paths = yield* listConflicts(input.process, input.worktreePath);
  if (paths.length === 0) {
    yield* abortAndVerify(input);
    return yield* rebaseError(
      `Git rebase stopped without file conflicts in '${input.worktreePath}': ${input.stderr.trim() || "no error detail"}`,
    );
  }
  if (isDocsOnly(paths)) {
    return {
      status: "doc-conflicts",
      baseHead: input.baseHead,
      fromHead: input.verifiedHead,
      paths,
    } as const;
  }
  yield* abortAndVerify(input);
  return {
    status: "code-conflicts",
    baseHead: input.baseHead,
    fromHead: input.verifiedHead,
    paths,
  } as const;
});

const stageDocumentationConflictResolutions = Effect.fn(
  "TaskRebase.stageDocumentationConflictResolutions",
)(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly verifiedHead: string;
  readonly baseHead: string;
}) {
  const conflicts = yield* listConflicts(input.process, input.worktreePath);
  if (conflicts.length === 0) {
    return yield* rebaseError(
      `The active rebase in '${input.worktreePath}' has no unresolved documentation paths to stage.`,
    );
  }
  if (!isDocsOnly(conflicts)) {
    yield* abortAndVerify(input);
    return {
      status: "code-conflicts",
      baseHead: input.baseHead,
      fromHead: input.verifiedHead,
      paths: conflicts,
    } as const;
  }

  const [unstagedResult, untrackedResult] = yield* Effect.all([
    run(input.process, input.worktreePath, "unstaged", ["diff", "--name-only", "-z", "--"]),
    run(input.process, input.worktreePath, "untracked", [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
    ]),
  ]);
  const [unstaged, untracked] = yield* Effect.all([
    parseNulPaths(
      unstagedResult,
      `Git unstaged-path output was truncated while continuing '${input.worktreePath}'.`,
    ),
    parseNulPaths(
      untrackedResult,
      `Git untracked-path output was truncated while continuing '${input.worktreePath}'.`,
    ),
  ]);
  const conflictSet = new Set(conflicts);
  const foreignPaths = [...unstaged, ...untracked].filter((path) => !conflictSet.has(path));
  if (foreignPaths.length > 0) {
    return yield* rebaseError(
      `Cannot continue the documentation rebase because unrelated paths changed: ${foreignPaths.join(", ")}.`,
    );
  }
  const resolutionCheck = yield* run(
    input.process,
    input.worktreePath,
    "resolutionCheck",
    ["diff", "--check", "--", ...conflicts],
    true,
  );
  yield* requireCompleteOutput(
    resolutionCheck,
    `Git resolution-check output was truncated while continuing '${input.worktreePath}'.`,
  );
  if (resolutionCheck.exitCode !== 0) {
    return yield* rebaseError(
      `Documentation conflict resolution is incomplete: ${resolutionCheck.stdout.trim() || resolutionCheck.stderr.trim() || "git diff --check failed"}`,
    );
  }
  yield* run(input.process, input.worktreePath, "stageResolutions", ["add", "--", ...conflicts]);
  return null;
});

const completeRebase = Effect.fn("TaskRebase.completeRebase")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly worktreePath: string;
  readonly verifiedHead: string;
  readonly baseHead: string;
}) {
  const toHead = yield* readHead(input.process, input.worktreePath);
  const status = yield* run(input.process, input.worktreePath, "completedStatus", [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
  ]);
  yield* requireCompleteOutput(
    status,
    `Git status output was truncated after rebasing '${input.worktreePath}'.`,
  );
  if (status.stdout.length > 0) {
    return yield* rebaseError(
      `Task worktree '${input.worktreePath}' is not clean after its rebase completed.`,
    );
  }
  const proof = yield* inspectProof({
    ...input,
    fromHead: input.verifiedHead,
    toHead,
  });
  if (!taskRebaseProofFitsContract(proof.paths)) {
    yield* restoreVerifiedHead(input);
    return {
      status: "proof-limit",
      baseHead: input.baseHead,
      fromHead: input.verifiedHead,
      pathCount: proof.paths.length,
    } as const;
  }
  return {
    status: "rebased",
    baseHead: input.baseHead,
    fromHead: input.verifiedHead,
    toHead,
    ...proof,
  } as const;
});

export const rebaseTaskBranchOntoPrimary = Effect.fn("rebaseTaskBranchOntoPrimary")(
  function* (input: {
    readonly primaryCheckoutPath: string;
    readonly worktreePath: string;
    readonly verifiedHead: string;
    readonly process: Pick<VcsProcessShape, "run">;
  }) {
    const primary = yield* prepareTaskRepository({
      cwd: input.primaryCheckoutPath,
      process: input.process,
      disableHooks: true,
    }).pipe(
      Effect.mapError((cause) =>
        rebaseError(`Could not refresh primary checkout '${input.primaryCheckoutPath}'.`, cause),
      ),
    );
    const fromHead = yield* requireCleanVerifiedHead(input);
    const current = yield* run(
      input.process,
      input.worktreePath,
      "currentBase",
      ["merge-base", "--is-ancestor", primary.head, fromHead],
      true,
    );
    if (current.exitCode === 0) {
      return { status: "already-current", baseHead: primary.head, fromHead } as const;
    }
    if (current.exitCode !== 1) {
      return yield* rebaseError(
        `Could not determine whether task HEAD '${fromHead}' already contains base '${primary.head}'.`,
      );
    }

    const probe = yield* probeConflicts({
      process: input.process,
      worktreePath: input.worktreePath,
      fromHead,
      baseHead: primary.head,
    });
    const predictedPaths = yield* listTreeDiffPaths({
      process: input.process,
      worktreePath: input.worktreePath,
      operation: "probeProof",
      fromHead,
      toHead: probe.treeHead,
    });
    if (!taskRebaseProofFitsContract(predictedPaths)) {
      return {
        status: "proof-limit",
        baseHead: primary.head,
        fromHead,
        pathCount: predictedPaths.length,
      } as const;
    }
    if (probe.conflicted && !isDocsOnly(probe.paths)) {
      return {
        status: "code-conflicts",
        baseHead: primary.head,
        fromHead,
        paths: probe.paths,
      } as const;
    }

    const result = yield* run(
      input.process,
      input.worktreePath,
      "rebase",
      [
        "-c",
        "rebase.autoStash=false",
        "-c",
        "rebase.updateRefs=false",
        "-c",
        "core.hooksPath=/dev/null",
        "rebase",
        "--merge",
        "--no-autostash",
        "--no-verify",
        primary.head,
      ],
      true,
    );
    if (result.exitCode !== 0) {
      return yield* classifyStoppedRebase({
        process: input.process,
        worktreePath: input.worktreePath,
        verifiedHead: fromHead,
        baseHead: primary.head,
        stderr: result.stderr,
      });
    }
    return yield* completeRebase({
      process: input.process,
      worktreePath: input.worktreePath,
      verifiedHead: fromHead,
      baseHead: primary.head,
    });
  },
);

const readRebaseMetadata = Effect.fn("TaskRebase.readRebaseMetadata")(function* (input: {
  readonly process: Pick<VcsProcessShape, "run">;
  readonly fileSystem: Pick<FileSystem.FileSystem, "readFileString">;
  readonly worktreePath: string;
}) {
  const readMetadataFile = Effect.fn("TaskRebase.readMetadataFile")(function* (
    name: "orig-head" | "onto",
  ) {
    const path = (yield* run(input.process, input.worktreePath, `${name}Path`, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      `rebase-merge/${name}`,
    ])).stdout.trim();
    const value = yield* input.fileSystem
      .readFileString(path)
      .pipe(
        Effect.mapError((cause) =>
          rebaseError(`Could not read active rebase metadata '${path}'.`, cause),
        ),
      );
    const head = value.trim();
    if (!OBJECT_ID.test(head)) {
      return yield* rebaseError(`Active rebase metadata '${path}' has an invalid commit ID.`);
    }
    return head;
  });
  const [fromHead, baseHead] = yield* Effect.all([
    readMetadataFile("orig-head"),
    readMetadataFile("onto"),
  ]);
  return { fromHead, baseHead } as const;
});

export const continueTaskRebaseInWorktree = Effect.fn("continueTaskRebaseInWorktree")(
  function* (input: {
    readonly primaryCheckoutPath: string;
    readonly worktreePath: string;
    readonly verifiedHead: string;
    readonly process: Pick<VcsProcessShape, "run">;
    readonly fileSystem: Pick<FileSystem.FileSystem, "readFileString">;
  }) {
    const primary = yield* prepareTaskRepository({
      cwd: input.primaryCheckoutPath,
      process: input.process,
      disableHooks: true,
    }).pipe(
      Effect.mapError((cause) =>
        rebaseError(`Could not refresh primary checkout '${input.primaryCheckoutPath}'.`, cause),
      ),
    );
    const metadata = yield* readRebaseMetadata(input);
    if (metadata.fromHead !== input.verifiedHead) {
      return yield* rebaseError(
        `The active rebase started at '${metadata.fromHead}', not verified HEAD '${input.verifiedHead}'.`,
      );
    }
    if (metadata.baseHead !== primary.head) {
      yield* abortAndVerify({
        process: input.process,
        worktreePath: input.worktreePath,
        verifiedHead: metadata.fromHead,
      });
      return yield* rebaseError(
        `The active rebase targeted '${metadata.baseHead}', not refreshed primary HEAD '${primary.head}', so it was aborted. Call rebaseTaskBranch again.`,
      );
    }
    const blocked = yield* stageDocumentationConflictResolutions({
      process: input.process,
      worktreePath: input.worktreePath,
      verifiedHead: metadata.fromHead,
      baseHead: metadata.baseHead,
    });
    if (blocked !== null) return blocked;
    const result = yield* run(
      input.process,
      input.worktreePath,
      "continue",
      ["-c", "core.editor=true", "-c", "core.hooksPath=/dev/null", "rebase", "--continue"],
      true,
    );
    if (result.exitCode !== 0) {
      return yield* classifyStoppedRebase({
        process: input.process,
        worktreePath: input.worktreePath,
        verifiedHead: metadata.fromHead,
        baseHead: metadata.baseHead,
        stderr: result.stderr,
      });
    }
    return yield* completeRebase({
      process: input.process,
      worktreePath: input.worktreePath,
      verifiedHead: metadata.fromHead,
      baseHead: metadata.baseHead,
    });
  },
);
