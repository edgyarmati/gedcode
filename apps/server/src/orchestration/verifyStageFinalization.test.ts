import * as NodeServices from "@effect/platform-node/NodeServices";
import { TaskId } from "@t3tools/contracts";
import { assert, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { VcsProcess, layer as VcsProcessLive } from "../vcs/VcsProcess.ts";
import { finalizeStageWorktreeSettlement } from "./worktreeCompletion.ts";

const TestLayer = VcsProcessLive.pipe(Layer.provideMerge(NodeServices.layer));

it.layer(TestLayer)("verifier documentation finalization", (it) => {
  it.effect(
    "commits allowed verifier documentation through the server and returns a clean new HEAD",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const process = yield* VcsProcess;
          const root = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-verify-finalize-" });
          const worktree = `${root}/task-worktree`;
          const git = (cwd: string, args: ReadonlyArray<string>) =>
            process.run({ operation: "VerifyStageFinalization.test", command: "git", args, cwd });

          yield* git(root, ["init"]);
          yield* git(root, ["config", "user.email", "tests@gedcode.dev"]);
          yield* git(root, ["config", "user.name", "GedCode Tests"]);
          yield* fs.makeDirectory(`${root}/.ged/work/root`, { recursive: true });
          yield* fs.writeFileString(`${root}/.ged/work/root/TESTS.md`, "# Initial evidence\n");
          yield* git(root, ["add", "."]);
          yield* git(root, ["commit", "-m", "initial"]);
          yield* git(root, ["worktree", "add", "-b", "ged/feature/finalize-evidence", worktree]);
          const startHead = (yield* git(worktree, ["rev-parse", "HEAD"])).stdout.trim();

          yield* fs.writeFileString(
            `${worktree}/.ged/work/root/TESTS.md`,
            "# Verification evidence\n\n- focused tests passed\n",
          );

          const finalizeInput = {
            taskId: TaskId.make("task-verify-finalize"),
            taskTitle: "Finalize verifier evidence",
            worktreePath: worktree,
            process,
            role: "verify",
            startHead,
          } as const;
          const [result, duplicateResult] = yield* Effect.all(
            [
              finalizeStageWorktreeSettlement(finalizeInput),
              finalizeStageWorktreeSettlement(finalizeInput),
            ],
            { concurrency: "unbounded" },
          );

          expect(result.worktreeCompletion.dirty).toBe(false);
          expect(result.worktreeCompletion.head).not.toBe(startHead);
          expect(duplicateResult.worktreeCompletion).toEqual(result.worktreeCompletion);
          expect(result.ownershipViolationPaths).toBeUndefined();
          expect(
            "verificationFinalizationError" in result
              ? result.verificationFinalizationError
              : undefined,
          ).toBeUndefined();
          expect((yield* git(worktree, ["status", "--porcelain"])).stdout).toBe("");
          expect((yield* git(worktree, ["log", "-1", "--pretty=%s"])).stdout.trim()).toBe(
            "docs: record verification evidence for Finalize verifier evidence",
          );
          assert.deepStrictEqual(
            (yield* git(worktree, ["diff", "--name-only", startHead, "HEAD"])).stdout
              .trim()
              .split("\n"),
            [".ged/work/root/TESTS.md"],
          );
          expect(
            (yield* git(worktree, ["rev-list", "--count", `${startHead}..HEAD`])).stdout.trim(),
          ).toBe("1");
        }),
      ),
  );

  it.effect("does not commit when a verifier changed an implementation path", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-verify-violation-" });
        const git = (args: ReadonlyArray<string>) =>
          process.run({ operation: "VerifyStageFinalization.test", command: "git", args, cwd });

        yield* git(["init"]);
        yield* git(["config", "user.email", "tests@gedcode.dev"]);
        yield* git(["config", "user.name", "GedCode Tests"]);
        yield* fs.makeDirectory(`${cwd}/src`, { recursive: true });
        yield* fs.writeFileString(`${cwd}/src/index.ts`, "export const value = 1;\n");
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "initial"]);
        const startHead = (yield* git(["rev-parse", "HEAD"])).stdout.trim();
        yield* fs.writeFileString(`${cwd}/src/index.ts`, "export const value = 2;\n");

        const result = yield* finalizeStageWorktreeSettlement({
          taskId: TaskId.make("task-verify-violation"),
          taskTitle: "Reject verifier code",
          worktreePath: cwd,
          process,
          role: "verify",
          startHead,
        });

        expect(result.worktreeCompletion).toEqual({ head: startHead, dirty: true });
        expect(result.ownershipViolationPaths).toEqual(["src/index.ts"]);
        expect((yield* git(["rev-parse", "HEAD"])).stdout.trim()).toBe(startHead);
      }),
    ),
  );

  it.effect(
    "returns a recoverable dirty result when the server commit cannot acquire the index",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const process = yield* VcsProcess;
          const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-verify-failure-" });
          const git = (args: ReadonlyArray<string>) =>
            process.run({ operation: "VerifyStageFinalization.test", command: "git", args, cwd });

          yield* git(["init"]);
          yield* git(["config", "user.email", "tests@gedcode.dev"]);
          yield* git(["config", "user.name", "GedCode Tests"]);
          yield* fs.writeFileString(`${cwd}/TESTS.md`, "# Initial\n");
          yield* git(["add", "."]);
          yield* git(["commit", "-m", "initial"]);
          const startHead = (yield* git(["rev-parse", "HEAD"])).stdout.trim();
          const gitDir = (yield* git([
            "rev-parse",
            "--path-format=absolute",
            "--git-dir",
          ])).stdout.trim();
          yield* fs.writeFileString(`${cwd}/TESTS.md`, "# Updated\n");
          yield* fs.writeFileString(`${gitDir}/index.lock`, "locked\n");

          const result = yield* finalizeStageWorktreeSettlement({
            taskId: TaskId.make("task-verify-failure"),
            taskTitle: "Recover failed finalization",
            worktreePath: cwd,
            process,
            role: "verify",
            startHead,
          });

          expect(result.worktreeCompletion).toEqual({ head: startHead, dirty: true });
          expect(
            "verificationFinalizationError" in result
              ? result.verificationFinalizationError
              : undefined,
          ).toContain("index.lock");
          expect((yield* git(["rev-parse", "HEAD"])).stdout.trim()).toBe(startHead);
        }),
      ),
  );
});
