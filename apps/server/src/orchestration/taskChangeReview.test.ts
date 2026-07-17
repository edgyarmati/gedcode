import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { VcsProcess, layer as VcsProcessLive } from "../vcs/VcsProcess.ts";
import {
  commitTaskWorktreeChanges,
  discardTaskWorktreeChanges,
  inspectTaskWorktreeChanges,
} from "./taskChangeReview.ts";

const TestLayer = VcsProcessLive.pipe(Layer.provideMerge(NodeServices.layer));

const git = Effect.fn("taskChangeReviewTest.git")(function* (
  cwd: string,
  args: ReadonlyArray<string>,
) {
  const process = yield* VcsProcess;
  return yield* process.run({ operation: "TaskChangeReview.test", command: "git", args, cwd });
});

const makeRepository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-change-review-" });
  yield* git(cwd, ["init"]);
  yield* git(cwd, ["config", "user.email", "tests@gedcode.dev"]);
  yield* git(cwd, ["config", "user.name", "GedCode Tests"]);
  yield* fs.writeFileString(`${cwd}/selected.txt`, "one\ntwo\nthree\nfour\n");
  yield* fs.writeFileString(`${cwd}/other.txt`, "base\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "Initial fixture"]);
  return cwd;
});

it.layer(TestLayer)("task change review git operations", (it) => {
  it.effect("commits an exact patch hunk while preserving unselected worktree changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* makeRepository;
        yield* fs.writeFileString(`${cwd}/selected.txt`, "ONE\ntwo\nthree\nFOUR\n");
        yield* fs.writeFileString(`${cwd}/other.txt`, "remaining\n");

        const result = yield* commitTaskWorktreeChanges({
          worktreePath: cwd,
          process,
          patch: [
            "diff --git a/selected.txt b/selected.txt",
            "--- a/selected.txt",
            "+++ b/selected.txt",
            "@@ -1 +1 @@",
            "-one",
            "+ONE",
            "",
          ].join("\n"),
          message: "fix: preserve selected review hunk",
        });

        assert.equal(result.changes.dirty, true);
        assert.deepStrictEqual(result.changes.paths, ["other.txt", "selected.txt"]);
        assert.equal(yield* fs.readFileString(`${cwd}/selected.txt`), "ONE\ntwo\nthree\nFOUR\n");
        assert.equal(
          (yield* git(cwd, ["show", "HEAD:selected.txt"])).stdout,
          "ONE\ntwo\nthree\nfour\n",
        );
        assert.match((yield* git(cwd, ["show", "-s", "--format=%s", "HEAD"])).stdout, /preserve/);
      }),
    ),
  );

  it.effect("rejects foreign paths and pre-staged changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* makeRepository;
        yield* fs.writeFileString(`${cwd}/selected.txt`, "changed\n");
        const foreign = yield* Effect.flip(
          commitTaskWorktreeChanges({
            worktreePath: cwd,
            process,
            paths: ["../outside.txt"],
            message: "fix: reject foreign selection",
          }),
        );
        assert.equal(foreign._tag, "TaskChangeReviewError");

        yield* git(cwd, ["add", "selected.txt"]);
        const staged = yield* Effect.flip(
          commitTaskWorktreeChanges({
            worktreePath: cwd,
            process,
            paths: ["selected.txt"],
            message: "fix: reject staged selection",
          }),
        );
        assert.equal(staged._tag, "TaskChangeReviewError");
        if (staged._tag === "TaskChangeReviewError") {
          assert.match(staged.detail, /already contains staged changes/);
        }
      }),
    ),
  );

  it.effect("discards selected tracked and untracked paths while preserving the rest", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* makeRepository;
        yield* fs.writeFileString(`${cwd}/selected.txt`, "discard me\n");
        yield* fs.writeFileString(`${cwd}/temporary.txt`, "discard me too\n");
        yield* fs.writeFileString(`${cwd}/other.txt`, "keep me\n");

        const result = yield* discardTaskWorktreeChanges({
          worktreePath: cwd,
          process,
          paths: ["selected.txt", "temporary.txt"],
        });

        assert.deepStrictEqual(result.changes.paths, ["other.txt"]);
        assert.equal(yield* fs.readFileString(`${cwd}/selected.txt`), "one\ntwo\nthree\nfour\n");
        assert.equal(yield* fs.exists(`${cwd}/temporary.txt`), false);
        assert.equal(yield* fs.readFileString(`${cwd}/other.txt`), "keep me\n");
      }),
    ),
  );

  it.effect("reports hooks as managed rather than task changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* makeRepository;
        yield* fs.makeDirectory(`${cwd}/.gedcode-hooks`, { recursive: true });
        yield* fs.writeFileString(`${cwd}/.gedcode-hooks/pre-push`, "managed\n");

        const changes = yield* inspectTaskWorktreeChanges({ worktreePath: cwd, process });
        assert.equal(changes.dirty, false);
      }),
    ),
  );
});
