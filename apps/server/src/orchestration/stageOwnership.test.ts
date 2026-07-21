import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import { VcsProcess, layer as VcsProcessLive } from "../vcs/VcsProcess.ts";
import { inspectStageOwnershipViolations, isStageDocumentationPath } from "./stageOwnership.ts";

const TestLayer = VcsProcessLive.pipe(Layer.provideMerge(NodeServices.layer));

describe("isStageDocumentationPath", () => {
  it.each(["AGENTS.md", "docs/design.mdx", ".ged/MANIFEST.json", ".ged/work/root/TESTS.md"])(
    "accepts documentation path %s",
    (path) => expect(isStageDocumentationPath(path)).toBe(true),
  );

  it.each(["src/index.ts", "docs/example.ts", "package.json", ".ged/scripts/migrate.ts"])(
    "rejects implementation path %s",
    (path) => expect(isStageDocumentationPath(path)).toBe(false),
  );
});

it.layer(TestLayer)("stage ownership inspection", (it) => {
  it.effect("reports committed, dirty, and untracked implementation paths but allows docs", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const process = yield* VcsProcess;
        const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "gedcode-stage-ownership-" });
        const git = (args: ReadonlyArray<string>) =>
          process.run({ operation: "StageOwnership.test", command: "git", args, cwd });

        yield* git(["init"]);
        yield* git(["config", "user.email", "tests@gedcode.dev"]);
        yield* git(["config", "user.name", "GedCode Tests"]);
        yield* fs.makeDirectory(`${cwd}/src`, { recursive: true });
        yield* fs.makeDirectory(`${cwd}/docs`, { recursive: true });
        yield* fs.writeFileString(`${cwd}/src/index.ts`, "export const value = 1;\n");
        yield* fs.writeFileString(`${cwd}/docs/design.md`, "# Initial\n");
        yield* git(["add", "."]);
        yield* git(["commit", "-m", "initial"]);
        const startHead = (yield* git(["rev-parse", "HEAD"])).stdout.trim();

        yield* fs.writeFileString(`${cwd}/src/index.ts`, "export const value = 2;\n");
        yield* fs.writeFileString(`${cwd}/docs/design.md`, "# Updated\n");
        yield* fs.writeFileString(`${cwd}/src/new.ts`, "export {};\n");

        const violations = yield* inspectStageOwnershipViolations({
          worktreePath: cwd,
          startHead,
          role: "verify",
          process,
        });

        assert.deepStrictEqual(violations, ["src/index.ts", "src/new.ts"]);
      }),
    ),
  );
});
