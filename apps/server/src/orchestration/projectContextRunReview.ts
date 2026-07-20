import {
  type OrchestrationProjectContextRun,
  type OrchestratorProjectContextRunReview,
  type ProjectContextRunId,
} from "@t3tools/contracts";
import { createHash } from "node:crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import type {
  ProjectContextOwnershipBaseline,
  ProjectContextRawFileState,
  ProjectContextSnapshot,
} from "../project/ProjectContext.ts";
import {
  auditProjectContextGitStateDrift,
  auditProjectContextWorkspaceDrift,
  captureProjectContextRunGitState,
  captureProjectContextWorkspaceStatus,
  compareProjectContextOwnership,
  sameProjectContextRunGitState,
} from "../project/ProjectContextRunChanges.ts";
import type { VcsProcessShape } from "../vcs/VcsProcess.ts";

export class ProjectContextRunReviewError extends Data.TaggedError("ProjectContextRunReviewError")<{
  readonly projectContextRunId: ProjectContextRunId;
  readonly detail: string;
}> {
  override get message(): string {
    return this.detail;
  }
}

export interface ProjectContextRunReviewServices {
  readonly scan: (
    workspaceRoot: string,
  ) => Effect.Effect<ProjectContextSnapshot, ProjectContextRunReviewError>;
  readonly vcsProcess: Pick<VcsProcessShape, "run">;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
}

export interface ProjectContextRunReviewInspection {
  readonly currentSnapshot: ProjectContextSnapshot;
  readonly expectedOwnership: ProjectContextOwnershipBaseline;
}

export interface ProjectContextRunReviewCommitResult {
  /** Null when a human explicitly accepted a run that produced no owned changes. */
  readonly commitSha: string | null;
}

const rawStateEquals = (left: ProjectContextRawFileState, right: ProjectContextRawFileState) =>
  left.presence === right.presence &&
  left.digest === right.digest &&
  left.size === right.size &&
  left.content === right.content;

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const reviewError = (run: OrchestrationProjectContextRun, detail: string) =>
  new ProjectContextRunReviewError({ projectContextRunId: run.id, detail });

const rawStateFromContent = (content: string | null): ProjectContextRawFileState =>
  content === null
    ? { presence: "absent", digest: null, size: 0, content: null }
    : {
        presence: "present",
        digest: `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`,
        size: Buffer.byteLength(content, "utf8"),
        content,
      };

function baselineToMap(
  run: OrchestrationProjectContextRun,
): Map<string, ProjectContextRawFileState> {
  const entries = new Map<string, ProjectContextRawFileState>();
  for (const entry of run.baselineManifest) {
    if (entries.has(entry.path)) {
      throw reviewError(run, `Project-context baseline contains duplicate path '${entry.path}'.`);
    }
    entries.set(entry.path, rawStateFromContent(entry.rawContent));
  }
  return entries;
}

function expectedOwnershipForRun(
  run: OrchestrationProjectContextRun,
): ProjectContextOwnershipBaseline {
  const states = baselineToMap(run);
  const changed = new Set<string>();
  for (const change of run.changes) {
    if (changed.has(change.path)) {
      throw reviewError(run, `Project-context review contains duplicate change '${change.path}'.`);
    }
    changed.add(change.path);
    const baseline = states.get(change.path);
    const expectedBefore = baseline?.content ?? null;
    if (expectedBefore !== change.beforeRawContent) {
      throw reviewError(
        run,
        `Project-context review change '${change.path}' no longer matches its immutable baseline.`,
      );
    }
    states.set(change.path, rawStateFromContent(change.afterRawContent));
  }
  return {
    files: [...states.entries()]
      .toSorted(([left], [right]) => compareCodeUnits(left, right))
      .map(([relativePath, state]) => ({ relativePath, state })),
  };
}

/**
 * The persisted B→A review is sufficient to render a deterministic diff. Do
 * not re-scan here: the UI must be able to display the exact completed-run
 * evidence, including recorded scope violations, even after the checkout has
 * subsequently changed.
 */
export function projectContextRunReviewPresentation(
  run: OrchestrationProjectContextRun,
): OrchestratorProjectContextRunReview {
  const baseline: ProjectContextOwnershipBaseline = {
    files: [...baselineToMap(run).entries()]
      .toSorted(([left], [right]) => compareCodeUnits(left, right))
      .map(([relativePath, state]) => ({ relativePath, state })),
  };
  const owned = compareProjectContextOwnership(baseline, expectedOwnershipForRun(run));
  return {
    runId: run.id,
    result: run.result ?? "Project-context agent completed without a written summary.",
    changes: owned.changes.map((change) => ({
      path: change.relativePath as OrchestratorProjectContextRunReview["changes"][number]["path"],
      kind: change.kind === "add" ? "added" : change.kind === "delete" ? "deleted" : "modified",
    })),
    diff: owned.diff,
    diffTruncated: owned.diffTruncated,
    scopeViolationPaths: run.scopeViolationPaths,
  };
}

function ownershipMismatch(
  run: OrchestrationProjectContextRun,
  expected: ProjectContextOwnershipBaseline,
  current: ProjectContextOwnershipBaseline,
): string | null {
  const expectedByPath = new Map(expected.files.map((file) => [file.relativePath, file.state]));
  const currentByPath = new Map(current.files.map((file) => [file.relativePath, file.state]));
  const paths = [...new Set([...expectedByPath.keys(), ...currentByPath.keys()])].toSorted(
    compareCodeUnits,
  );
  for (const relativePath of paths) {
    const before = expectedByPath.get(relativePath);
    const after = currentByPath.get(relativePath);
    if (before === undefined || after === undefined || !rawStateEquals(before, after)) {
      return `Project-context review is stale because '${relativePath}' changed after the provider completed. Refresh the review before mutating files.`;
    }
  }
  return null;
}

/**
 * Re-check the provider's exact before/after states, all non-context worktree
 * paths, and Git semantics immediately before a destructive review action.
 */
export const inspectProjectContextRunReview = Effect.fn("inspectProjectContextRunReview")(
  function* (
    services: ProjectContextRunReviewServices,
    run: OrchestrationProjectContextRun,
  ): Effect.fn.Return<ProjectContextRunReviewInspection, ProjectContextRunReviewError> {
    const expectedOwnership = expectedOwnershipForRun(run);
    const currentSnapshot = yield* services.scan(run.primaryCheckoutPath);
    const mismatch = ownershipMismatch(run, expectedOwnership, currentSnapshot.ownershipBaseline);
    if (mismatch !== null) return yield* reviewError(run, mismatch);

    const currentWorkspaceStatus = yield* captureProjectContextWorkspaceStatus({
      workspaceRoot: run.primaryCheckoutPath,
      process: services.vcsProcess,
      fileSystem: services.fileSystem,
      path: services.path,
    }).pipe(Effect.mapError((error) => reviewError(run, error.message)));
    const workspaceDrift = auditProjectContextWorkspaceDrift(
      run.workspaceStatusManifest,
      currentWorkspaceStatus,
    );
    if (workspaceDrift.outsideAllowedScope.length > 0) {
      return yield* reviewError(
        run,
        `Project-context review cannot mutate while non-context workspace paths changed: ${workspaceDrift.outsideAllowedScope.map((entry) => entry.relativePath).join(", ")}.`,
      );
    }

    const currentGitState = yield* captureProjectContextRunGitState({
      workspaceRoot: run.primaryCheckoutPath,
      process: services.vcsProcess,
      fileSystem: services.fileSystem,
      path: services.path,
    }).pipe(Effect.mapError((error) => reviewError(run, error.message)));
    if (!sameProjectContextRunGitState(run.gitState, currentGitState)) {
      const changed = auditProjectContextGitStateDrift(run.gitState, currentGitState);
      return yield* reviewError(
        run,
        `Project-context review cannot mutate because Git state changed since the run: ${changed.scopeViolationPaths.join(", ") || "unknown Git metadata"}.`,
      );
    }

    return { currentSnapshot, expectedOwnership };
  },
);

const runGit = Effect.fn("ProjectContextRunReview.git")(function* (
  services: Pick<ProjectContextRunReviewServices, "vcsProcess">,
  run: OrchestrationProjectContextRun,
  operation: string,
  args: ReadonlyArray<string>,
  options?: { readonly stdin?: string; readonly allowNonZeroExit?: boolean },
) {
  return yield* services.vcsProcess
    .run({
      operation,
      command: "git",
      args,
      cwd: run.primaryCheckoutPath,
      ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options?.allowNonZeroExit === true ? { allowNonZeroExit: true } : {}),
    })
    .pipe(Effect.mapError((error) => reviewError(run, error.message)));
});

const requireDescriptiveCommitMessage = (run: OrchestrationProjectContextRun, message: string) => {
  const normalized = message.trim();
  if (normalized.length < 12 || normalized.split(/\s+/u).length < 2) {
    return null;
  }
  return normalized;
};

interface HeadBlob {
  readonly mode: string;
  readonly content: string;
}

const headBlob = Effect.fn("ProjectContextRunReview.headBlob")(function* (
  services: Pick<ProjectContextRunReviewServices, "vcsProcess">,
  run: OrchestrationProjectContextRun,
  relativePath: string,
): Effect.fn.Return<HeadBlob | null, ProjectContextRunReviewError> {
  if (run.gitState.head === null) return null;
  const tree = yield* runGit(services, run, "ProjectContextRunReview.lsTree", [
    "ls-tree",
    "-z",
    run.gitState.head,
    "--",
    relativePath,
  ]);
  if (tree.stdout.length === 0) return null;
  const record = tree.stdout.split("\0")[0] ?? "";
  const match = /^(100[0-7]{3}) blob ([a-f0-9]{40}|[a-f0-9]{64})\t/u.exec(record);
  if (match?.[1] === undefined || match[2] === undefined)
    return yield* reviewError(
      run,
      `Could not safely resolve tracked context file '${relativePath}'.`,
    );
  const content = yield* runGit(services, run, "ProjectContextRunReview.readHeadBlob", [
    "cat-file",
    "blob",
    match[2],
  ]);
  return { mode: match[1], content: content.stdout };
});

const mergeAgentChange = Effect.fn("ProjectContextRunReview.mergeAgentChange")(function* (
  services: Pick<ProjectContextRunReviewServices, "vcsProcess" | "fileSystem" | "path">,
  run: OrchestrationProjectContextRun,
  input: {
    readonly relativePath: string;
    readonly baseline: string | null;
    readonly after: string | null;
    readonly head: HeadBlob | null;
  },
): Effect.fn.Return<string | null, ProjectContextRunReviewError> {
  const { baseline, after, head } = input;
  if (baseline === null && head === null) return after;
  if (baseline === null || head === null) {
    return yield* reviewError(
      run,
      `Cannot safely commit '${input.relativePath}' because it was a pre-existing untracked file or changed tracking state during the context run.`,
    );
  }
  if (after === null) {
    if (head.content !== baseline) {
      return yield* reviewError(
        run,
        `Cannot safely delete '${input.relativePath}' because it overlaps pre-existing user edits.`,
      );
    }
    return null;
  }
  if (head.content === baseline) return after;
  if (after === baseline) return head.content;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* services.fileSystem.makeTempDirectoryScoped({
        prefix: "gedcode-project-context-merge-",
      });
      const ours = services.path.join(directory, "head.md");
      const base = services.path.join(directory, "baseline.md");
      const theirs = services.path.join(directory, "agent.md");
      yield* Effect.all([
        services.fileSystem.writeFileString(ours, head.content),
        services.fileSystem.writeFileString(base, baseline),
        services.fileSystem.writeFileString(theirs, after),
      ]);
      const merged = yield* runGit(
        services,
        run,
        "ProjectContextRunReview.threeWayMerge",
        ["merge-file", "-p", ours, base, theirs],
        { allowNonZeroExit: true },
      );
      if (merged.exitCode === 1) {
        return yield* reviewError(
          run,
          `Cannot safely commit '${input.relativePath}' because provider changes overlap pre-existing user edits.`,
        );
      }
      if (merged.exitCode !== 0) {
        return yield* reviewError(
          run,
          `Three-way merge for '${input.relativePath}' exited ${merged.exitCode}.`,
        );
      }
      return merged.stdout;
    }),
  ).pipe(Effect.mapError((error) => reviewError(run, error.message)));
});

const assertCleanIndex = Effect.fn("ProjectContextRunReview.assertCleanIndex")(function* (
  services: Pick<ProjectContextRunReviewServices, "vcsProcess">,
  run: OrchestrationProjectContextRun,
) {
  const staged = yield* runGit(
    services,
    run,
    "ProjectContextRunReview.staged",
    ["diff", "--cached", "--quiet"],
    { allowNonZeroExit: true },
  );
  if (staged.exitCode !== 0) {
    return yield* reviewError(
      run,
      "Project-context commits require a clean Git index so pre-existing staged changes cannot be altered. Keep staged work separate, then retry.",
    );
  }
});

const hashAndStage = Effect.fn("ProjectContextRunReview.hashAndStage")(function* (
  services: Pick<ProjectContextRunReviewServices, "vcsProcess">,
  run: OrchestrationProjectContextRun,
  input: { readonly relativePath: string; readonly mode: string; readonly content: string | null },
) {
  if (input.content === null) {
    yield* runGit(services, run, "ProjectContextRunReview.removeFromIndex", [
      "update-index",
      "--force-remove",
      "--",
      input.relativePath,
    ]);
    return;
  }
  const object = yield* runGit(
    services,
    run,
    "ProjectContextRunReview.hashObject",
    ["hash-object", "-w", "--stdin"],
    { stdin: input.content },
  );
  const objectId = object.stdout.trim();
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(objectId)) {
    return yield* reviewError(
      run,
      `Git returned an invalid object ID while staging '${input.relativePath}'.`,
    );
  }
  yield* runGit(
    services,
    run,
    "ProjectContextRunReview.stageExactContent",
    ["update-index", "--add", "-z", "--index-info"],
    { stdin: `${input.mode} ${objectId}\t${input.relativePath}\0` },
  );
});

const resetReviewedIndexPaths = Effect.fn("ProjectContextRunReview.resetIndex")(function* (
  services: Pick<ProjectContextRunReviewServices, "vcsProcess">,
  run: OrchestrationProjectContextRun,
  paths: ReadonlyArray<string>,
) {
  if (paths.length === 0) return;
  yield* runGit(services, run, "ProjectContextRunReview.rollbackIndex", [
    "reset",
    "--quiet",
    "HEAD",
    "--",
    ...paths,
  ]).pipe(Effect.ignore);
});

/**
 * Commit only provider-authored context deltas. It derives a merged target
 * tree from HEAD/Baseline/Provider-after, stages exact blobs, and therefore
 * leaves same-file pre-existing *unstaged* user hunks in the working tree.
 */
export const commitProjectContextRunReview = Effect.fn("commitProjectContextRunReview")(function* (
  services: ProjectContextRunReviewServices,
  run: OrchestrationProjectContextRun,
  message: string,
): Effect.fn.Return<ProjectContextRunReviewCommitResult, ProjectContextRunReviewError> {
  const normalizedMessage = requireDescriptiveCommitMessage(run, message);
  if (normalizedMessage === null) {
    return yield* reviewError(
      run,
      "Project-context commit messages must be descriptive (at least 12 characters and two words).",
    );
  }
  yield* inspectProjectContextRunReview(services, run);
  yield* assertCleanIndex(services, run);
  const changes = run.changes;
  if (changes.length === 0) return { commitSha: null };

  const stagedPaths: string[] = [];
  return yield* Effect.gen(function* () {
    for (const change of changes) {
      const head = yield* headBlob(services, run, change.path);
      const content = yield* mergeAgentChange(services, run, {
        relativePath: change.path,
        baseline: change.beforeRawContent,
        after: change.afterRawContent,
        head,
      });
      if (head?.content === content && head !== null) continue;
      if (head === null && content === null) continue;
      yield* hashAndStage(services, run, {
        relativePath: change.path,
        mode: head?.mode ?? "100644",
        content,
      });
      stagedPaths.push(change.path);
    }
    if (stagedPaths.length === 0) return { commitSha: null };

    const committed = yield* runGit(services, run, "ProjectContextRunReview.commit", [
      "commit",
      "-m",
      normalizedMessage,
      "-m",
      `GedCode-Project-Context-Run: ${run.id}`,
    ]).pipe(Effect.tapError(() => resetReviewedIndexPaths(services, run, stagedPaths)));
    const head = yield* runGit(services, run, "ProjectContextRunReview.commitHead", [
      "rev-parse",
      "--verify",
      "HEAD",
    ]);
    const commitSha = head.stdout.trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commitSha)) {
      return yield* reviewError(run, "Git commit completed without a valid HEAD object ID.");
    }
    if (committed.stdoutTruncated || committed.stderrTruncated) {
      return yield* reviewError(run, "Git commit output exceeded the review safety bound.");
    }
    return { commitSha };
  }).pipe(Effect.tapError(() => resetReviewedIndexPaths(services, run, stagedPaths)));
});

const ownershipStateAt = (
  snapshot: ProjectContextSnapshot,
  relativePath: string,
): ProjectContextRawFileState | undefined =>
  snapshot.ownershipBaseline.files.find((file) => file.relativePath === relativePath)?.state;

const setRawState = Effect.fn("ProjectContextRunReview.setRawState")(function* (
  services: Pick<ProjectContextRunReviewServices, "fileSystem" | "path" | "scan">,
  run: OrchestrationProjectContextRun,
  relativePath: string,
  expectedCurrent: ProjectContextRawFileState,
  target: ProjectContextRawFileState,
) {
  const current = yield* services.scan(run.primaryCheckoutPath);
  const state = ownershipStateAt(current, relativePath);
  if (state === undefined || !rawStateEquals(state, expectedCurrent)) {
    return yield* reviewError(
      run,
      `Project-context review changed concurrently at '${relativePath}'; no further files were discarded.`,
    );
  }
  const absolutePath = services.path.join(run.primaryCheckoutPath, relativePath);
  if (target.presence === "absent") {
    yield* services.fileSystem
      .remove(absolutePath, { force: true })
      .pipe(Effect.mapError((error) => reviewError(run, error.message)));
    return;
  }
  yield* Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* services.fileSystem.makeTempDirectoryScoped({
        directory: services.path.dirname(absolutePath),
        prefix: `${services.path.basename(absolutePath)}.`,
      });
      const tempPath = services.path.join(directory, "contents.tmp");
      yield* services.fileSystem.writeFileString(tempPath, target.content);
      yield* services.fileSystem.rename(tempPath, absolutePath);
    }),
  ).pipe(Effect.mapError((error) => reviewError(run, error.message)));
});

/**
 * Restore only the provider's raw B→A changes to their baseline B states.
 * This intentionally never invokes Git restore/clean: those commands would
 * erase the user's dirty baseline. The all-file preflight plus per-file CAS
 * checks fail closed; best-effort compensation only overwrites files still
 * equal to the value this action itself wrote.
 */
export const discardProjectContextRunReview = Effect.fn("discardProjectContextRunReview")(
  function* (
    services: ProjectContextRunReviewServices,
    run: OrchestrationProjectContextRun,
  ): Effect.fn.Return<void, ProjectContextRunReviewError> {
    yield* inspectProjectContextRunReview(services, run);
    const applied: Array<{
      readonly path: string;
      readonly before: ProjectContextRawFileState;
      readonly after: ProjectContextRawFileState;
    }> = [];
    yield* Effect.forEach(
      run.changes,
      (change) =>
        Effect.gen(function* () {
          const after = rawStateFromContent(change.afterRawContent);
          const before = rawStateFromContent(change.beforeRawContent);
          yield* setRawState(services, run, change.path, after, before);
          applied.push({ path: change.path, before, after });
        }),
      { discard: true },
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.forEach(
          applied.toReversed(),
          (entry) =>
            setRawState(services, run, entry.path, entry.before, entry.after).pipe(Effect.ignore),
          { discard: true },
        ).pipe(Effect.andThen(Effect.failCause(cause))),
      ),
    );
    const finalSnapshot = yield* services.scan(run.primaryCheckoutPath);
    const baseline: ProjectContextOwnershipBaseline = {
      files: run.baselineManifest.map((entry) => ({
        relativePath: entry.path,
        state: rawStateFromContent(entry.rawContent),
      })),
    };
    const mismatch = ownershipMismatch(run, baseline, finalSnapshot.ownershipBaseline);
    if (mismatch !== null) return yield* reviewError(run, mismatch);
  },
);
