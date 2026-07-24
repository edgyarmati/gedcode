import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { VcsProcess, layer as VcsProcessLive } from "../vcs/VcsProcess.ts";
import { TASK_WORKTREE_HOOKS_DIR, installTaskWorktreePushBlockHook } from "./workerSafety.ts";

const TestLayer = VcsProcessLive.pipe(Layer.provideMerge(NodeServices.layer));

const git = Effect.fn("workerSafetyHooksTest.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const process = yield* VcsProcess;
  return yield* process.run({ operation: "WorkerSafety.test", command: "git", args, cwd });
});

const resolveInfoExclude = (cwd: string) =>
  git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"]).pipe(
    Effect.map((result) => result.stdout.trim()),
  );

const makeRepository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-worker-safety-" });
  yield* git(cwd, ["init"]);
  yield* git(cwd, ["config", "user.email", "tests@gedcode.dev"]);
  yield* git(cwd, ["config", "user.name", "GedCode Tests"]);
  // Deliberately do NOT gitignore the hooks dir: this fixture models a target
  // repo that has no `.gedcode-hooks` ignore rule, which is where the managed
  // hook used to leak into the server-owned commit.
  yield* fs.writeFileString(`${cwd}/seed.txt`, "seed\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "Initial fixture"]);
  return cwd;
});

it.layer(TestLayer)("worker safety hook installation", (it) => {
  it.effect(
    "registers the managed hooks dir in git exclude so staging skips it without failing",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const cwd = yield* makeRepository;

          yield* installTaskWorktreePushBlockHook(cwd);

          const excludeContent = yield* fs.readFileString(yield* resolveInfoExclude(cwd));
          assert.include(excludeContent, `/${TASK_WORKTREE_HOOKS_DIR}/`);
          assert.isTrue(yield* fs.exists(`${cwd}/${TASK_WORKTREE_HOOKS_DIR}/pre-push`));

          // Reproduce the finalizer staging step against a real change: it must
          // exit cleanly and never include the managed hook, even though the
          // repository does not gitignore the hooks directory.
          yield* fs.writeFileString(`${cwd}/work.txt`, "work\n");
          const staged = yield* git(cwd, ["add", "-A", "--", "."]);
          assert.equal(staged.exitCode, 0);
          const stagedPaths = (yield* git(cwd, ["diff", "--cached", "--name-only"])).stdout;
          assert.include(stagedPaths, "work.txt");
          assert.notInclude(stagedPaths, TASK_WORKTREE_HOOKS_DIR);
        }),
      ),
  );

  it.effect("registers the exclude rule only once across repeated handoffs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const cwd = yield* makeRepository;

        yield* installTaskWorktreePushBlockHook(cwd);
        yield* installTaskWorktreePushBlockHook(cwd);

        const excludeContent = yield* fs.readFileString(yield* resolveInfoExclude(cwd));
        const occurrences = excludeContent.split(`/${TASK_WORKTREE_HOOKS_DIR}/`).length - 1;
        assert.equal(occurrences, 1);
      }),
    ),
  );
});
