// @effect-diagnostics nodeBuiltinImport:off - this integration test creates isolated Git repositories.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ProjectId,
  SourceControlProviderError,
  VcsProcessExitError,
  type ChangeRequest,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";

import type { DirectPublicationServices } from "./DirectPublicationService.ts";
import { publishDirectCommitWithServices } from "./DirectPublicationService.ts";
import { DirectPublicationError } from "./DirectPublicationPort.ts";
import type { VcsProcessInput, VcsProcessShape } from "../../vcs/VcsProcess.ts";

const testFailure = (operation: string, cause: unknown) =>
  new DirectPublicationError({
    reason: "project-invalid",
    detail: `${operation}: ${String(cause)}`,
  });

const changeRequest = (title: string, baseRefName: string, headRefName: string): ChangeRequest => ({
  provider: "github",
  number: 42,
  title,
  url: "https://github.com/acme/project/pull/42",
  baseRefName,
  headRefName,
  state: "open",
  updatedAt: Option.none(),
});

const providerFailure = (operation: string) =>
  new SourceControlProviderError({
    provider: "github",
    operation,
    detail: "provider unavailable",
  });

const runGit = (cwd: string, args: ReadonlyArray<string>) =>
  execFileSync("git", [...args], { cwd, encoding: "utf8" }).trim();

const realGitProcess: Pick<VcsProcessShape, "run"> = {
  run: (input: VcsProcessInput) =>
    Effect.try({
      try: () => ({
        exitCode: ChildProcessSpawner.ExitCode(0),
        stdout: execFileSync(input.command, [...input.args], { cwd: input.cwd, encoding: "utf8" }),
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
      catch: (cause) =>
        new VcsProcessExitError({
          operation: input.operation,
          command: [input.command, ...input.args].join(" "),
          cwd: input.cwd,
          exitCode: 1,
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
};

const withDirectPublicationFixture = async (
  run: (fixture: {
    readonly primary: string;
    readonly sourceCommit: string;
    readonly workspaceRoot: string;
    readonly remoteRefsBefore: string;
    readonly worktreesBefore: string;
  }) => Promise<void>,
) => {
  const root = mkdtempSync(join(tmpdir(), "gedcode-direct-publication-validation-"));
  const primary = join(root, "primary");
  const remote = join(root, "remote.git");
  try {
    runGit(root, ["init", "--bare", remote]);
    runGit(root, ["init", "--initial-branch=main", primary]);
    runGit(primary, ["config", "user.email", "test@example.com"]);
    runGit(primary, ["config", "user.name", "GedCode Test"]);
    runGit(primary, ["commit", "--allow-empty", "-m", "base"]);
    runGit(primary, ["remote", "add", "origin", remote]);
    runGit(primary, ["push", "origin", "main"]);
    runGit(primary, ["commit", "--allow-empty", "-m", "source"]);
    await run({
      primary,
      sourceCommit: runGit(primary, ["rev-parse", "HEAD"]),
      workspaceRoot: realpathSync(primary),
      remoteRefsBefore: runGit(primary, [
        "for-each-ref",
        "--format=%(refname):%(objectname)",
        "refs/remotes/origin",
      ]),
      worktreesBefore: runGit(primary, ["worktree", "list", "--porcelain"]),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

it.effect(
  "rejects direct-publication validation boundaries before provider calls or repository mutation",
  () =>
    Effect.tryPromise({
      try: async () => {
        await withDirectPublicationFixture(async (fixture) => {
          const cases: ReadonlyArray<{
            readonly name: string;
            readonly expectedReason: string;
            readonly arrange: () => void;
            readonly input: Partial<{
              readonly sourceCommit: string;
              readonly destinationBranch: string;
              readonly existingPullRequestUrl: string | null;
            }>;
          }> = [
            {
              name: "a dirty primary checkout",
              expectedReason: "checkout-dirty",
              arrange: () => writeFileSync(join(fixture.primary, "dirty.txt"), "dirty\n"),
              input: {},
            },
            {
              name: "an invalid source commit",
              expectedReason: "source-commit-invalid",
              arrange: () => undefined,
              input: { sourceCommit: "not-a-commit" },
            },
            {
              name: "a protected destination branch",
              expectedReason: "destination-protected",
              arrange: () => undefined,
              input: { destinationBranch: "main" },
            },
            {
              name: "an existing destination without exact -x provenance",
              expectedReason: "destination-mismatch",
              arrange: () => {
                runGit(fixture.primary, ["branch", "ged/direct/unrelated", "origin/main"]);
                runGit(fixture.primary, ["push", "origin", "ged/direct/unrelated"]);
              },
              input: {
                destinationBranch: "ged/direct/unrelated",
                existingPullRequestUrl: "https://github.com/acme/project/pull/99",
              },
            },
          ];

          for (const testCase of cases) {
            testCase.arrange();
            let providerCalls = 0;
            const error = await Effect.runPromise(
              Effect.flip(
                publishDirectCommitWithServices(
                  {
                    sourceControlProvider: {
                      createChangeRequest: () => Effect.die("provider must not run"),
                      updateChangeRequest: () => Effect.die("provider must not run"),
                    },
                    vcsProcess: realGitProcess,
                  },
                  {
                    workspaceRoot: fixture.workspaceRoot,
                    projectId: ProjectId.make("project-direct-validation"),
                    sourceCommit: testCase.input.sourceCommit ?? fixture.sourceCommit,
                    destinationBranch: testCase.input.destinationBranch ?? "ged/direct/validation",
                    baseBranch: "main",
                    pullRequest: { title: "Validation boundary", body: "Validation boundary" },
                    existingPullRequestUrl: testCase.input.existingPullRequestUrl ?? null,
                  },
                ),
              ),
            );
            assert.equal(error.reason, testCase.expectedReason, testCase.name);
            assert.equal(providerCalls, 0, testCase.name);
            assert.equal(
              runGit(fixture.primary, ["worktree", "list", "--porcelain"]),
              fixture.worktreesBefore,
              testCase.name,
            );
            if (testCase.name !== "an existing destination without exact -x provenance") {
              assert.equal(
                runGit(fixture.primary, [
                  "for-each-ref",
                  "--format=%(refname):%(objectname)",
                  "refs/remotes/origin",
                ]),
                fixture.remoteRefsBefore,
                testCase.name,
              );
            }
            if (testCase.name === "a dirty primary checkout")
              runGit(fixture.primary, ["clean", "-fd"]);
          }
        });
      },
      catch: (cause) => testFailure("validation fixture", cause),
    }),
);

it.effect(
  "publishes one existing commit from an isolated worktree without changing the primary checkout",
  () =>
    Effect.tryPromise({
      try: async () => {
        const root = mkdtempSync(join(tmpdir(), "gedcode-direct-publication-"));
        const primary = join(root, "primary");
        const remote = join(root, "remote.git");
        try {
          runGit(root, ["init", "--bare", remote]);
          runGit(root, ["init", "--initial-branch=main", primary]);
          runGit(primary, ["config", "user.email", "test@example.com"]);
          runGit(primary, ["config", "user.name", "GedCode Test"]);
          runGit(primary, ["commit", "--allow-empty", "-m", "base"]);
          runGit(primary, ["remote", "add", "origin", remote]);
          runGit(primary, ["push", "origin", "main"]);
          runGit(primary, ["commit", "--allow-empty", "-m", "publish exactly this commit"]);
          const workspaceRoot = realpathSync(primary);
          const sourceCommit = runGit(primary, ["rev-parse", "HEAD"]);
          const primaryHeadBefore = sourceCommit;
          const providerCalls: Array<{
            readonly cwd: string;
            readonly baseRefName: string;
            readonly headSelector: string;
            readonly title: string;
            readonly bodyFile: string;
          }> = [];

          const result = await Effect.runPromise(
            publishDirectCommitWithServices(
              {
                sourceControlProvider: {
                  createChangeRequest: (input) =>
                    Effect.sync(() => {
                      providerCalls.push({
                        cwd: input.cwd,
                        baseRefName: input.baseRefName,
                        headSelector: input.headSelector,
                        title: input.title,
                        bodyFile: input.bodyFile,
                      });
                      return changeRequest(input.title, input.baseRefName, input.headSelector);
                    }),
                  updateChangeRequest: () => Effect.die("not used"),
                },
                vcsProcess: realGitProcess,
              },
              {
                workspaceRoot,
                projectId: ProjectId.make("project-direct-publication"),
                sourceCommit,
                destinationBranch: "ged/direct/one-commit",
                baseBranch: "main",
                pullRequest: {
                  title: "Publish exact commit",
                  body: "Publish only the reviewed source commit.",
                },
                existingPullRequestUrl: null,
              },
            ),
          );

          assert.deepEqual(result, {
            pullRequestUrl: "https://github.com/acme/project/pull/42",
            sourceCommit,
            destinationBranch: "ged/direct/one-commit",
          });
          assert.equal(runGit(primary, ["rev-parse", "HEAD"]), primaryHeadBefore);
          assert.equal(runGit(primary, ["status", "--porcelain"]), "");
          const destinationRef = "origin/ged/direct/one-commit";
          assert.include(
            runGit(primary, ["show", "-s", "--format=%B", destinationRef]),
            sourceCommit,
          );
          assert.equal(
            runGit(primary, ["rev-parse", `${destinationRef}^{tree}`]),
            runGit(primary, ["rev-parse", `${sourceCommit}^{tree}`]),
          );
          assert.equal(
            runGit(primary, ["rev-parse", `${destinationRef}^`]),
            runGit(primary, ["rev-parse", "origin/main"]),
          );
          assert.equal(providerCalls.length, 1);
          const providerCall = providerCalls[0];
          assert.equal(providerCall?.cwd, workspaceRoot);
          assert.equal(providerCall?.baseRefName, "main");
          assert.equal(providerCall?.headSelector, "ged/direct/one-commit");
          assert.equal(providerCall?.title, "Publish exact commit");
          assert.equal(
            providerCall?.bodyFile,
            join(workspaceRoot, ".gedcode", "direct-publication", "pr-body.md"),
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
      catch: (cause) => testFailure("publication fixture", cause),
    }),
);

it.effect("returns a typed cherry-pick conflict without push, PR, or retained worktree", () =>
  Effect.tryPromise({
    try: async () => {
      const root = mkdtempSync(join(tmpdir(), "gedcode-direct-publication-conflict-"));
      const primary = join(root, "primary");
      const remote = join(root, "remote.git");
      const updater = join(root, "updater");
      try {
        runGit(root, ["init", "--bare", "--initial-branch=main", remote]);
        runGit(root, ["init", "--initial-branch=main", primary]);
        runGit(primary, ["config", "user.email", "test@example.com"]);
        runGit(primary, ["config", "user.name", "GedCode Test"]);
        writeFileSync(join(primary, "conflict.txt"), "base\n");
        runGit(primary, ["add", "conflict.txt"]);
        runGit(primary, ["commit", "-m", "base"]);
        runGit(primary, ["remote", "add", "origin", remote]);
        runGit(primary, ["push", "origin", "main"]);
        writeFileSync(join(primary, "conflict.txt"), "source\n");
        runGit(primary, ["commit", "-am", "source"]);
        const sourceCommit = runGit(primary, ["rev-parse", "HEAD"]);
        const workspaceRoot = realpathSync(primary);
        runGit(root, ["clone", remote, updater]);
        runGit(updater, ["config", "user.email", "test@example.com"]);
        runGit(updater, ["config", "user.name", "GedCode Test"]);
        writeFileSync(join(updater, "conflict.txt"), "base update\n");
        runGit(updater, ["commit", "-am", "base update"]);
        runGit(updater, ["push", "origin", "main"]);
        runGit(primary, ["fetch", "origin"]);
        const head = runGit(primary, ["rev-parse", "HEAD"]);
        let providerCalls = 0;
        const error = await Effect.runPromise(
          Effect.flip(
            publishDirectCommitWithServices(
              {
                sourceControlProvider: {
                  createChangeRequest: () => Effect.die("must not create PR"),
                  updateChangeRequest: () => Effect.die("not used"),
                },
                vcsProcess: realGitProcess,
              },
              {
                workspaceRoot,
                projectId: ProjectId.make("project-direct-conflict"),
                sourceCommit,
                destinationBranch: "ged/direct/conflict",
                baseBranch: "main",
                pullRequest: { title: "Conflict", body: "Conflict" },
                existingPullRequestUrl: null,
              },
            ),
          ),
        );
        assert.equal(error.reason, "cherry-pick-conflict");
        assert.equal(providerCalls, 0);
        assert.equal(runGit(primary, ["rev-parse", "HEAD"]), head);
        assert.equal(runGit(primary, ["status", "--porcelain"]), "");
        assert.equal(runGit(primary, ["worktree", "list"]).split("\n").length, 1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    catch: (cause) => testFailure("conflict fixture", cause),
  }),
);

it.effect(
  "retries an identical direct publication by updating its existing pull request without republishing",
  () =>
    Effect.tryPromise({
      try: async () => {
        const root = mkdtempSync(join(tmpdir(), "gedcode-direct-publication-retry-"));
        const primary = join(root, "primary");
        const remote = join(root, "remote.git");
        try {
          runGit(root, ["init", "--bare", remote]);
          runGit(root, ["init", "--initial-branch=main", primary]);
          runGit(primary, ["config", "user.email", "test@example.com"]);
          runGit(primary, ["config", "user.name", "GedCode Test"]);
          runGit(primary, ["commit", "--allow-empty", "-m", "base"]);
          runGit(primary, ["remote", "add", "origin", remote]);
          runGit(primary, ["push", "origin", "main"]);
          runGit(primary, ["commit", "--allow-empty", "-m", "source"]);
          const sourceCommit = runGit(primary, ["rev-parse", "HEAD"]);
          const workspaceRoot = realpathSync(primary);
          let creates = 0;
          const updates: unknown[] = [];
          const provider: DirectPublicationServices["sourceControlProvider"] = {
            createChangeRequest: (input) =>
              Effect.sync(() => {
                creates += 1;
                return changeRequest(input.title, input.baseRefName, input.headSelector);
              }),
            updateChangeRequest: (input) =>
              Effect.sync(() => {
                updates.push(input);
              }),
          };
          const input = {
            workspaceRoot,
            projectId: ProjectId.make("project-direct-retry"),
            sourceCommit,
            destinationBranch: "ged/direct/retry",
            baseBranch: "main",
            pullRequest: { title: "Retry exact commit", body: "Retry" },
          };
          const first = await Effect.runPromise(
            publishDirectCommitWithServices(
              { sourceControlProvider: provider, vcsProcess: realGitProcess },
              { ...input, existingPullRequestUrl: null },
            ),
          );
          const remoteHead = runGit(primary, ["rev-parse", "origin/ged/direct/retry"]);
          const second = await Effect.runPromise(
            publishDirectCommitWithServices(
              { sourceControlProvider: provider, vcsProcess: realGitProcess },
              { ...input, existingPullRequestUrl: first.pullRequestUrl },
            ),
          );
          assert.deepEqual(second, first);
          assert.equal(runGit(primary, ["rev-parse", "origin/ged/direct/retry"]), remoteHead);
          assert.equal(creates, 1);
          assert.equal(updates.length, 1);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
      catch: (cause) => testFailure("retry fixture", cause),
    }),
);

it.effect(
  "cleans isolated publication state after provider failure while retaining the pushed destination",
  () =>
    Effect.tryPromise({
      try: async () => {
        const root = mkdtempSync(join(tmpdir(), "gedcode-direct-publication-provider-failure-"));
        const primary = join(root, "primary");
        const remote = join(root, "remote.git");
        try {
          runGit(root, ["init", "--bare", remote]);
          runGit(root, ["init", "--initial-branch=main", primary]);
          runGit(primary, ["config", "user.email", "test@example.com"]);
          runGit(primary, ["config", "user.name", "GedCode Test"]);
          runGit(primary, ["commit", "--allow-empty", "-m", "base"]);
          runGit(primary, ["remote", "add", "origin", remote]);
          runGit(primary, ["push", "origin", "main"]);
          runGit(primary, ["commit", "--allow-empty", "-m", "source"]);
          const sourceCommit = runGit(primary, ["rev-parse", "HEAD"]);
          const workspaceRoot = realpathSync(primary);
          const head = sourceCommit;
          const error = await Effect.runPromise(
            Effect.flip(
              publishDirectCommitWithServices(
                {
                  sourceControlProvider: {
                    createChangeRequest: () => Effect.fail(providerFailure("createChangeRequest")),
                    updateChangeRequest: () => Effect.die("not used"),
                  },
                  vcsProcess: realGitProcess,
                },
                {
                  workspaceRoot,
                  projectId: ProjectId.make("project-provider-failure"),
                  sourceCommit,
                  destinationBranch: "ged/direct/provider-failure",
                  baseBranch: "main",
                  pullRequest: { title: "Provider failure", body: "Body" },
                  existingPullRequestUrl: null,
                },
              ),
            ),
          );
          assert.equal(error.reason, "provider-failed");
          assert.equal(runGit(primary, ["rev-parse", "HEAD"]), head);
          assert.equal(runGit(primary, ["status", "--porcelain"]), "");
          assert.equal(runGit(primary, ["worktree", "list"]).split("\n").length, 1);
          assert.equal(
            runGit(primary, ["rev-parse", "origin/ged/direct/provider-failure"]).length,
            40,
          );
          assert.equal(
            existsSync(join(workspaceRoot, ".gedcode", "direct-publication", "pr-body.md")),
            false,
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
      catch: (cause) => testFailure("provider failure fixture", cause),
    }),
);
