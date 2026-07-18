import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { MAX_PROJECT_CONTEXT_FILE_BYTES } from "../ProjectContext.ts";
import { ProjectContextScanner } from "../Services/ProjectContextScanner.ts";
import { WorkspacePathsLive } from "../../workspace/Layers/WorkspacePaths.ts";
import { ProjectContextScannerLive } from "./ProjectContextScanner.ts";

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectContextScannerLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.fn("makeProjectContextTempDir")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-context-" });
});

const writeTextFile = Effect.fn("writeProjectContextTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("ProjectContextScannerLive", (it) => {
  describe("scan", () => {
    it.effect("classifies the fixed canonical files and root ADRs in deterministic order", () =>
      Effect.gen(function* () {
        const scanner = yield* ProjectContextScanner;
        const cwd = yield* makeTempDir();
        yield* writeTextFile(cwd, "AGENTS.md", "# Agent instructions\n");
        yield* writeTextFile(cwd, ".ged/PROJECT.md", " \n");
        yield* writeTextFile(cwd, ".ged/ARCHITECTURE.md", "# Architecture\nDetails\n");
        yield* writeTextFile(cwd, "docs/adr/0002.md", "# Two\n");
        yield* writeTextFile(cwd, "docs/adr/0001.md", "# One\nDecision\n");
        yield* writeTextFile(cwd, "docs/adr/nested/0003.md", "# Nested\nDecision\n");

        const snapshot = yield* scanner.scan(cwd);

        expect(snapshot.files.map((file) => [file.relativePath, file.classification])).toEqual([
          ["AGENTS.md", "template"],
          [".ged/PROJECT.md", "whitespace"],
          [".ged/ARCHITECTURE.md", "substantive"],
          ["CONTEXT.md", "missing"],
          ["docs/adr/0001.md", "substantive"],
          ["docs/adr/0002.md", "template"],
        ]);
        expect(snapshot.promptKind).toBe("review");
      }),
    );

    it.effect("excludes GedCode runtime files from the snapshot and fingerprint", () =>
      Effect.gen(function* () {
        const scanner = yield* ProjectContextScanner;
        const cwd = yield* makeTempDir();
        yield* writeTextFile(cwd, "AGENTS.md", "# Agent instructions\n");

        const before = yield* scanner.scan(cwd);
        yield* writeTextFile(cwd, ".gedcode/CONTEXT.md", "secret runtime state\n");
        yield* writeTextFile(cwd, ".gedcode/work/root/STATE.md", "runtime state\n");
        const after = yield* scanner.scan(cwd);

        expect(after).toEqual(before);
      }),
    );

    it.effect("distinguishes an empty context file from a missing one", () =>
      Effect.gen(function* () {
        const scanner = yield* ProjectContextScanner;
        const cwd = yield* makeTempDir();
        yield* writeTextFile(cwd, "CONTEXT.md", "");

        const snapshot = yield* scanner.scan(cwd);

        expect(snapshot.files.map((file) => [file.relativePath, file.classification])).toEqual([
          ["AGENTS.md", "missing"],
          [".ged/PROJECT.md", "missing"],
          [".ged/ARCHITECTURE.md", "missing"],
          ["CONTEXT.md", "empty"],
        ]);
        expect(snapshot.promptKind).toBe("populate");
      }),
    );

    it.effect("rejects escaping symlinks, oversized, and invalid UTF-8 context files", () =>
      Effect.gen(function* () {
        const scanner = yield* ProjectContextScanner;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir();
        const external = yield* makeTempDir();
        yield* writeTextFile(external, "outside.md", "outside\n");
        yield* fileSystem.symlink(path.join(external, "outside.md"), path.join(cwd, "AGENTS.md"));

        const symlinkError = yield* scanner.scan(cwd).pipe(Effect.flip);
        expect(symlinkError.detail).toContain("escapes workspace root");

        yield* fileSystem.remove(path.join(cwd, "AGENTS.md"));
        yield* writeTextFile(cwd, "AGENTS.md", "x".repeat(MAX_PROJECT_CONTEXT_FILE_BYTES + 1));
        const largeError = yield* scanner.scan(cwd).pipe(Effect.flip);
        expect(largeError.detail).toContain("exceeds");

        yield* fileSystem.remove(path.join(cwd, "AGENTS.md"));
        yield* fileSystem.writeFile(path.join(cwd, "AGENTS.md"), new Uint8Array([0xc3, 0x28]));
        const utf8Error = yield* scanner.scan(cwd).pipe(Effect.flip);
        expect(utf8Error.detail).toContain("not UTF-8");
      }),
    );

    it.effect("rejects directories where a context file is expected", () =>
      Effect.gen(function* () {
        const scanner = yield* ProjectContextScanner;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir();
        yield* fileSystem.makeDirectory(path.join(cwd, "AGENTS.md")).pipe(Effect.orDie);

        const error = yield* scanner.scan(cwd).pipe(Effect.flip);

        expect(error.detail).toContain("not a regular file");
      }),
    );
  });
});
