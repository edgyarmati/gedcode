import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import type { VcsProcessShape } from "../vcs/VcsProcess.ts";

export class TaskRepositoryPreparationError extends Data.TaggedError(
  "TaskRepositoryPreparationError",
)<{
  readonly detail: string;
  readonly cause?: unknown;
}> {
  override get message(): string {
    return this.detail;
  }
}

export function isGitHubRemoteUrl(url: string): boolean {
  const normalized = url.trim().toLowerCase();
  return (
    /^https?:\/\/(?:www\.)?github\.com\//u.test(normalized) ||
    normalized.startsWith("git@github.com:") ||
    /^ssh:\/\/(?:git@)?github\.com\//u.test(normalized)
  );
}

const run = Effect.fn("TaskRepositoryPreparation.run")(function* (
  process: Pick<VcsProcessShape, "run">,
  cwd: string,
  operation: string,
  args: ReadonlyArray<string>,
) {
  return yield* process
    .run({
      operation: `TaskRepositoryPreparation.${operation}`,
      command: "git",
      args,
      cwd,
      timeoutMs: 60_000,
      maxOutputBytes: 256_000,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new TaskRepositoryPreparationError({
            detail: `Could not prepare '${cwd}' for orchestrated work while running git ${args.join(" ")}.`,
            cause,
          }),
      ),
    );
});

/** Refresh a clean primary checkout from its GitHub upstream without rewriting local history. */
export const prepareTaskRepository = Effect.fn("prepareTaskRepository")(function* (input: {
  readonly cwd: string;
  readonly process: Pick<VcsProcessShape, "run">;
}) {
  const status = yield* run(input.process, input.cwd, "status", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.stdout.trim().length > 0) {
    return yield* new TaskRepositoryPreparationError({
      detail: `Cannot start orchestrated work from '${input.cwd}' because the primary checkout has uncommitted changes. Commit, stash, or discard them first.`,
    });
  }

  const branch = (yield* run(input.process, input.cwd, "branch", [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ])).stdout.trim();
  if (branch.length === 0) {
    return yield* new TaskRepositoryPreparationError({
      detail: `Cannot start orchestrated work from detached HEAD in '${input.cwd}'. Check out the primary branch first.`,
    });
  }

  const upstream = (yield* run(input.process, input.cwd, "upstream", [
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ])).stdout.trim();
  const separator = upstream.indexOf("/");
  if (separator <= 0) {
    return yield* new TaskRepositoryPreparationError({
      detail: `Branch '${branch}' in '${input.cwd}' has no remote upstream. Configure a GitHub upstream before creating orchestrator tasks.`,
    });
  }
  const remote = upstream.slice(0, separator);
  const remoteUrl = (yield* run(input.process, input.cwd, "remote", [
    "remote",
    "get-url",
    remote,
  ])).stdout.trim();
  if (!isGitHubRemoteUrl(remoteUrl)) {
    return yield* new TaskRepositoryPreparationError({
      detail: `Remote '${remote}' for '${input.cwd}' is not a supported GitHub remote. Orchestrated landing requires GitHub pull requests.`,
    });
  }

  yield* run(input.process, input.cwd, "fetch", ["fetch", "--prune", remote]);
  const counts = (yield* run(input.process, input.cwd, "aheadBehind", [
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${upstream}`,
  ])).stdout.trim();
  const [aheadText, behindText] = counts.split(/\s+/u);
  const ahead = Number.parseInt(aheadText ?? "", 10);
  const behind = Number.parseInt(behindText ?? "", 10);
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) {
    return yield* new TaskRepositoryPreparationError({
      detail: `Git returned invalid ahead/behind counts for '${branch}' against '${upstream}'.`,
    });
  }
  if (ahead > 0) {
    return yield* new TaskRepositoryPreparationError({
      detail:
        behind > 0
          ? `Primary branch '${branch}' has diverged from '${upstream}'. Reconcile it before creating orchestrator tasks.`
          : `Primary branch '${branch}' is ahead of '${upstream}'. Push or reconcile those commits before creating orchestrator tasks.`,
    });
  }
  if (behind > 0) {
    yield* run(input.process, input.cwd, "fastForward", ["merge", "--ff-only", upstream]);
  }

  const head = (yield* run(input.process, input.cwd, "head", [
    "rev-parse",
    "--verify",
    "HEAD",
  ])).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/iu.test(head)) {
    return yield* new TaskRepositoryPreparationError({
      detail: `Git returned an invalid HEAD after refreshing '${input.cwd}'.`,
    });
  }
  return { branch, upstream, head } as const;
});

/** Refresh primary Git and rebase a clean task branch before exact-HEAD verification. */
export const prepareTaskForVerification = Effect.fn("prepareTaskForVerification")(
  function* (input: {
    readonly primaryCheckoutPath: string;
    readonly worktreePath: string;
    readonly process: Pick<VcsProcessShape, "run">;
  }) {
    const primary = yield* prepareTaskRepository({
      cwd: input.primaryCheckoutPath,
      process: input.process,
    });
    const status = yield* run(input.process, input.worktreePath, "verificationStatus", [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (status.stdout.trim().length > 0) {
      return yield* new TaskRepositoryPreparationError({
        detail: `Cannot start verification because task worktree '${input.worktreePath}' has uncommitted changes. Return it to Work or Change review first.`,
      });
    }
    const beforeHead = (yield* run(input.process, input.worktreePath, "verificationHeadBefore", [
      "rev-parse",
      "--verify",
      "HEAD",
    ])).stdout.trim();
    const rebase = yield* Effect.exit(
      run(input.process, input.worktreePath, "verificationRebase", ["rebase", primary.head]),
    );
    if (rebase._tag === "Failure") {
      yield* input.process
        .run({
          operation: "TaskRepositoryPreparation.verificationRebaseAbort",
          command: "git",
          args: ["rebase", "--abort"],
          cwd: input.worktreePath,
          allowNonZeroExit: true,
          timeoutMs: 30_000,
          maxOutputBytes: 256_000,
        })
        .pipe(Effect.ignore);
      return yield* new TaskRepositoryPreparationError({
        detail: `Task worktree '${input.worktreePath}' could not be rebased cleanly onto refreshed primary HEAD '${primary.head}'. Resolve the target movement in a Work stage before verification.`,
        cause: rebase.cause,
      });
    }
    const taskHead = (yield* run(input.process, input.worktreePath, "verificationHeadAfter", [
      "rev-parse",
      "--verify",
      "HEAD",
    ])).stdout.trim();
    if (!/^[0-9a-f]{40,64}$/iu.test(beforeHead) || !/^[0-9a-f]{40,64}$/iu.test(taskHead)) {
      return yield* new TaskRepositoryPreparationError({
        detail: `Git returned an invalid task HEAD while preparing '${input.worktreePath}' for verification.`,
      });
    }
    return { primaryHead: primary.head, taskHead, rebased: taskHead !== beforeHead } as const;
  },
);
