// @effect-diagnostics nodeBuiltinImport:off - isolated Git publication owns temporary filesystem artifacts.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as Effect from "effect/Effect";

import type { SourceControlProviderShape } from "../../sourceControl/SourceControlProvider.ts";
import type * as VcsProcess from "../../vcs/VcsProcess.ts";
import {
  DirectPublicationError,
  type DirectPublicationInput,
  type DirectPublicationResult,
} from "./DirectPublicationPort.ts";

export interface PublishDirectCommitInput extends DirectPublicationInput {
  readonly workspaceRoot: string;
}

export interface DirectPublicationServices {
  readonly sourceControlProvider: Pick<
    SourceControlProviderShape,
    "createChangeRequest" | "updateChangeRequest"
  >;
  readonly vcsProcess: Pick<VcsProcess.VcsProcessShape, "run">;
}

const PROTECTED_DESTINATIONS = new Set([
  "main",
  "master",
  "develop",
  "development",
  "production",
  "release",
  "stable",
]);

const publicationError = (
  reason: DirectPublicationError["reason"],
  detail: string,
): DirectPublicationError => new DirectPublicationError({ reason, detail });

export const publishDirectCommitWithServices = Effect.fn(
  "DirectPublicationService.publishDirectCommitWithServices",
)(function* (services: DirectPublicationServices, input: PublishDirectCommitInput) {
  const workspaceRoot = resolve(input.workspaceRoot);
  const requestedSourceCommit = input.sourceCommit.trim();
  const destinationBranch = input.destinationBranch.trim();
  const baseBranch = input.baseBranch.trim();
  const vcsProcess = services.vcsProcess;
  const git = (operation: string, cwd: string, args: ReadonlyArray<string>) =>
    vcsProcess.run({ operation, command: "git", args, cwd });

  const status = yield* git("DirectPublication.status", workspaceRoot, [
    "status",
    "--porcelain",
  ]).pipe(
    Effect.mapError((cause) =>
      publicationError("project-invalid", `Could not inspect the primary checkout: ${cause}`),
    ),
  );
  if (status.stdout.trim().length > 0) {
    return yield* publicationError(
      "checkout-dirty",
      `Primary checkout '${workspaceRoot}' must be clean before direct publication.`,
    );
  }

  const repositoryRoot = yield* git("DirectPublication.repositoryRoot", workspaceRoot, [
    "rev-parse",
    "--show-toplevel",
  ]).pipe(
    Effect.mapError((cause) =>
      publicationError("project-invalid", `Could not resolve the project repository: ${cause}`),
    ),
  );
  if (resolve(repositoryRoot.stdout.trim()) !== workspaceRoot) {
    return yield* publicationError(
      "project-invalid",
      `Project checkout '${workspaceRoot}' is not the repository's primary root.`,
    );
  }

  const resolvedSource = yield* git("DirectPublication.sourceCommit", workspaceRoot, [
    "rev-parse",
    "--verify",
    `${requestedSourceCommit}^{commit}`,
  ]).pipe(
    Effect.mapError(() =>
      publicationError(
        "source-commit-invalid",
        `Source commit '${requestedSourceCommit}' does not resolve in the project repository.`,
      ),
    ),
  );
  const sourceCommit = resolvedSource.stdout.trim();

  for (const branch of [destinationBranch, baseBranch]) {
    yield* git("DirectPublication.branchName", workspaceRoot, [
      "check-ref-format",
      "--branch",
      branch,
    ]).pipe(
      Effect.mapError(() =>
        publicationError("destination-protected", `Branch name '${branch}' is not valid.`),
      ),
    );
  }
  if (
    destinationBranch === baseBranch ||
    PROTECTED_DESTINATIONS.has(destinationBranch.toLowerCase())
  ) {
    return yield* publicationError(
      "destination-protected",
      `Destination branch '${destinationBranch}' is protected from direct publication.`,
    );
  }

  yield* git("DirectPublication.baseBranch", workspaceRoot, [
    "rev-parse",
    "--verify",
    `origin/${baseBranch}^{commit}`,
  ]).pipe(
    Effect.mapError(() =>
      publicationError(
        "project-invalid",
        `Base branch 'origin/${baseBranch}' does not resolve in the project repository.`,
      ),
    ),
  );

  const bodyFile = join(workspaceRoot, ".gedcode", "direct-publication", "pr-body.md");
  const writePullRequestBody = Effect.tryPromise({
    try: async () => {
      await mkdir(join(workspaceRoot, ".gedcode", "direct-publication"), { recursive: true });
      await writeFile(bodyFile, `${input.pullRequest.body.trim()}\n`, "utf8");
    },
    catch: (cause) =>
      publicationError("provider-failed", `Could not prepare pull-request body: ${cause}`),
  });
  const removePullRequestBody = Effect.tryPromise({
    try: () => rm(bodyFile, { force: true }),
    catch: () => undefined,
  }).pipe(Effect.ignore);
  const destinationRef = `origin/${destinationBranch}`;
  const existingDestination = yield* git("DirectPublication.destinationBranch", workspaceRoot, [
    "branch",
    "--remotes",
    "--list",
    destinationRef,
  ]).pipe(
    Effect.mapError((cause) =>
      publicationError(
        "destination-mismatch",
        `Could not inspect destination branch '${destinationRef}': ${cause}`,
      ),
    ),
  );

  if (existingDestination.stdout.trim().length > 0) {
    if (input.existingPullRequestUrl === null) {
      return yield* publicationError(
        "destination-mismatch",
        `Destination branch '${destinationRef}' already exists; its exact pull-request URL is required.`,
      );
    }
    const message = yield* git("DirectPublication.destinationProvenance", workspaceRoot, [
      "log",
      "-1",
      "--format=%B",
      destinationRef,
    ]).pipe(
      Effect.mapError((cause) =>
        publicationError(
          "destination-mismatch",
          `Could not verify destination provenance: ${cause}`,
        ),
      ),
    );
    const provenance = `(cherry picked from commit ${sourceCommit})`;
    if (!message.stdout.split(/\r?\n/u).includes(provenance)) {
      return yield* publicationError(
        "destination-mismatch",
        `Destination branch '${destinationRef}' does not contain exact source provenance '${provenance}'.`,
      );
    }
    yield* git("DirectPublication.destinationBase", workspaceRoot, [
      "merge-base",
      "--is-ancestor",
      `origin/${baseBranch}`,
      destinationRef,
    ]).pipe(
      Effect.mapError(() =>
        publicationError(
          "destination-mismatch",
          `Destination branch '${destinationRef}' is not based on 'origin/${baseBranch}'.`,
        ),
      ),
    );

    return yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen(function* () {
          yield* writePullRequestBody;
          yield* services.sourceControlProvider
            .updateChangeRequest({
              cwd: workspaceRoot,
              reference: input.existingPullRequestUrl!,
              title: input.pullRequest.title.trim(),
              bodyFile,
            })
            .pipe(
              Effect.mapError((cause) =>
                publicationError("provider-failed", `Could not update pull request: ${cause}`),
              ),
            );
          return {
            pullRequestUrl: input.existingPullRequestUrl!,
            sourceCommit,
            destinationBranch,
          } satisfies DirectPublicationResult;
        }),
      () => removePullRequestBody,
    );
  }

  const temporaryRoot = yield* Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "gedcode-direct-publication-")),
    catch: (cause) =>
      publicationError("project-invalid", `Could not allocate publication worktree: ${cause}`),
  });
  const worktreePath = join(temporaryRoot, "worktree");

  const publish = Effect.gen(function* () {
    yield* git("DirectPublication.createWorktree", workspaceRoot, [
      "worktree",
      "add",
      "--detach",
      worktreePath,
      `origin/${baseBranch}`,
    ]).pipe(
      Effect.mapError((cause) =>
        publicationError("project-invalid", `Could not create isolated worktree: ${cause}`),
      ),
    );
    yield* git("DirectPublication.createBranch", worktreePath, [
      "switch",
      "-c",
      destinationBranch,
    ]).pipe(
      Effect.mapError((cause) =>
        publicationError("destination-protected", `Could not create destination branch: ${cause}`),
      ),
    );
    yield* git("DirectPublication.cherryPick", worktreePath, [
      "-c",
      "commit.gpgSign=false",
      "cherry-pick",
      "--allow-empty",
      "-x",
      sourceCommit,
    ]).pipe(
      Effect.mapError((cause) =>
        publicationError("cherry-pick-conflict", `Could not apply source commit: ${cause}`),
      ),
    );
    yield* git("DirectPublication.push", worktreePath, [
      "push",
      "origin",
      `HEAD:refs/heads/${destinationBranch}`,
    ]).pipe(
      Effect.mapError((cause) =>
        publicationError("push-failed", `Could not push destination branch: ${cause}`),
      ),
    );

    yield* writePullRequestBody;
    const changeRequest = yield* services.sourceControlProvider
      .createChangeRequest({
        cwd: workspaceRoot,
        baseRefName: baseBranch,
        headSelector: destinationBranch,
        title: input.pullRequest.title.trim(),
        bodyFile,
      })
      .pipe(
        Effect.mapError((cause) =>
          publicationError("provider-failed", `Could not create pull request: ${cause}`),
        ),
      );

    return {
      pullRequestUrl: changeRequest.url,
      sourceCommit,
      destinationBranch,
    } satisfies DirectPublicationResult;
  });

  return yield* Effect.acquireUseRelease(
    Effect.void,
    () => publish,
    () =>
      Effect.gen(function* () {
        yield* git("DirectPublication.removeWorktree", workspaceRoot, [
          "worktree",
          "remove",
          "--force",
          worktreePath,
        ]).pipe(Effect.ignore);
        yield* Effect.tryPromise({
          try: () => rm(temporaryRoot, { recursive: true, force: true }),
          catch: () => undefined,
        }).pipe(Effect.ignore);
        yield* removePullRequestBody;
      }),
  );
});
