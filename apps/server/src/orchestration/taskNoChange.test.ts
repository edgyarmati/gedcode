import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { VcsProcess, layer as VcsProcessLive } from "../vcs/VcsProcess.ts";
import { inspectTaskNoChangeEvidence } from "./taskNoChange.ts";

const TestLayer = VcsProcessLive.pipe(Layer.provideMerge(NodeServices.layer));

const git = Effect.fn("taskNoChangeTest.git")(function* (cwd: string, args: ReadonlyArray<string>) {
  const process = yield* VcsProcess;
  return yield* process.run({ operation: "TaskNoChange.test", command: "git", args, cwd });
});

const makeRepository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-no-change-" });
  yield* git(cwd, ["init"]);
  yield* git(cwd, ["config", "user.email", "tests@gedcode.dev"]);
  yield* git(cwd, ["config", "user.name", "GedCode Tests"]);
  yield* fs.writeFileString(`${cwd}/fixture.txt`, "base\n");
  yield* git(cwd, ["add", "."]);
  yield* git(cwd, ["commit", "-m", "Initial fixture"]);
  yield* git(cwd, ["switch", "-c", "ged/feature/noop"]);
  return cwd;
});

it.layer(TestLayer)("task no-change evidence", (it) => {
  it.effect("binds a task branch to its creation reflog and current cleanliness", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* makeRepository;

        const empty = yield* inspectTaskNoChangeEvidence({
          repositoryPath: cwd,
          branch: "ged/feature/noop",
          worktreePath: cwd,
          process,
        });
        assert.equal(empty.baseHead, empty.head);
        assert.equal(empty.dirty, false);

        yield* fs.writeFileString(`${cwd}/fixture.txt`, "changed\n");
        const dirty = yield* inspectTaskNoChangeEvidence({
          repositoryPath: cwd,
          branch: "ged/feature/noop",
          worktreePath: cwd,
          process,
        });
        assert.equal(dirty.baseHead, dirty.head);
        assert.equal(dirty.dirty, true);

        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "Change fixture"]);
        const committed = yield* inspectTaskNoChangeEvidence({
          repositoryPath: cwd,
          branch: "ged/feature/noop",
          worktreePath: cwd,
          process,
        });
        assert.notEqual(committed.baseHead, committed.head);
        assert.equal(committed.dirty, false);
      }),
    ),
  );
});
