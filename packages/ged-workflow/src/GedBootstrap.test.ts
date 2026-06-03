import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { DEFAULT_STANDARDS_CONTENT } from "./GedMemoryTemplates.ts";
import { bootstrapGedDirectory, discoverStandards, populateStandards } from "./GedBootstrap.ts";

const makeTestLayer = (
  existingFiles: ReadonlyArray<string>,
  fileContents?: Record<string, string>,
) => {
  const existingSet = new Set(existingFiles);
  const contents: Record<string, string> = { ...fileContents };

  const fsLayer = FileSystem.layerNoop({
    exists: (path) => Effect.succeed(existingSet.has(path)),
    makeDirectory: (path) =>
      Effect.sync(() => {
        existingSet.add(path);
      }),
    readFileString: (path) => {
      const content = contents[path];
      if (content !== undefined) {
        return Effect.succeed(content);
      }
      return Effect.fail(
        new (class extends Error {
          readonly _tag = "SystemError";
          readonly reason = "NotFound";
          readonly module = "FileSystem";
          readonly method = "readFileString";
          readonly pathOrDescriptor = path;
        })(`File not found: ${path}`),
      ) as never;
    },
    writeFileString: (path, data) =>
      Effect.sync(() => {
        contents[path] = data;
        existingSet.add(path);
      }),
  });

  return {
    layer: Layer.merge(fsLayer, Path.layer),
    getWrittenContent: (path: string) => contents[path],
    hasPath: (path: string) => existingSet.has(path),
  };
};

describe("discoverStandards", () => {
  it("finds files that exist in project root", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer } = makeTestLayer(["/project/AGENTS.md", "/project/CLAUDE.md"]);

        const discovered = yield* Effect.provide(discoverStandards("/project"), layer);

        expect(discovered).toContain("AGENTS.md");
        expect(discovered).toContain("CLAUDE.md");
        expect(discovered).toHaveLength(2);
      }),
    );
  });

  it("returns empty array when no standards files exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer } = makeTestLayer([]);

        const discovered = yield* Effect.provide(discoverStandards("/project"), layer);

        expect(discovered).toEqual([]);
      }),
    );
  });

  it("only returns files from KNOWN_STANDARDS_FILES list", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer } = makeTestLayer([
          "/project/AGENTS.md",
          "/project/random-file.txt",
          "/project/.editorconfig",
        ]);

        const discovered = yield* Effect.provide(discoverStandards("/project"), layer);

        expect(discovered).toContain("AGENTS.md");
        expect(discovered).toContain(".editorconfig");
        expect(discovered).not.toContain("random-file.txt");
        expect(discovered).toHaveLength(2);
      }),
    );
  });

  it("preserves order from KNOWN_STANDARDS_FILES", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer } = makeTestLayer([
          "/project/.editorconfig",
          "/project/AGENTS.md",
          "/project/biome.json",
        ]);

        const discovered = yield* Effect.provide(discoverStandards("/project"), layer);

        expect(discovered).toEqual(["AGENTS.md", ".editorconfig", "biome.json"]);
      }),
    );
  });
});

describe("bootstrapGedDirectory bundled skills", () => {
  it("writes missing grill-me Claude skill with bundled content", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer, getWrittenContent, hasPath } = makeTestLayer([]);

        yield* Effect.provide(bootstrapGedDirectory("/project"), layer);

        const content = getWrittenContent("/project/.claude/skills/grill-me/SKILL.md");
        expect(hasPath("/project/.claude/skills/grill-me")).toBe(true);
        expect(content).toContain("name: grill-me");
        expect(content).toContain("Interview the user relentlessly");
        expect(content).toContain("Ask exactly ONE question per turn");
      }),
    );
  });

  it("does not overwrite an existing grill-me Claude skill", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const existingSkill = "custom grill-me skill";
        const { layer, getWrittenContent } = makeTestLayer(
          ["/project/.claude/skills/grill-me/SKILL.md"],
          {
            "/project/.claude/skills/grill-me/SKILL.md": existingSkill,
          },
        );

        yield* Effect.provide(bootstrapGedDirectory("/project"), layer);

        expect(getWrittenContent("/project/.claude/skills/grill-me/SKILL.md")).toBe(existingSkill);
      }),
    );
  });

  it("only installs the grill-me bundled skill", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer, getWrittenContent } = makeTestLayer([]);

        yield* Effect.provide(bootstrapGedDirectory("/project"), layer);

        expect(getWrittenContent("/project/.claude/skills/grill-me/SKILL.md")).toBeDefined();
        expect(getWrittenContent("/project/.claude/skills/ged-planning/SKILL.md")).toBeUndefined();
      }),
    );
  });
});

describe("populateStandards", () => {
  it("writes correct content with discovered files", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer, getWrittenContent } = makeTestLayer(["/project/.ged/STANDARDS.md"], {
          "/project/.ged/STANDARDS.md": DEFAULT_STANDARDS_CONTENT,
        });

        yield* Effect.provide(populateStandards("/project", ["AGENTS.md", "CLAUDE.md"]), layer);

        const content = getWrittenContent("/project/.ged/STANDARDS.md");
        expect(content).toContain("# Standards");
        expect(content).toContain("Auto-discovered project standards.");
        expect(content).toContain("- [AGENTS.md](../AGENTS.md)");
        expect(content).toContain("- [CLAUDE.md](../CLAUDE.md)");
      }),
    );
  });

  it("does not write when discovered files array is empty", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer, getWrittenContent } = makeTestLayer(["/project/.ged/STANDARDS.md"], {
          "/project/.ged/STANDARDS.md": DEFAULT_STANDARDS_CONTENT,
        });

        yield* Effect.provide(populateStandards("/project", []), layer);

        const content = getWrittenContent("/project/.ged/STANDARDS.md");
        expect(content).toBe(DEFAULT_STANDARDS_CONTENT);
      }),
    );
  });

  it("does not overwrite manually edited STANDARDS.md", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const manualContent = "# Standards\n\nCustom standards content.\n";
        const { layer, getWrittenContent } = makeTestLayer(["/project/.ged/STANDARDS.md"], {
          "/project/.ged/STANDARDS.md": manualContent,
        });

        yield* Effect.provide(populateStandards("/project", ["AGENTS.md"]), layer);

        const content = getWrittenContent("/project/.ged/STANDARDS.md");
        expect(content).toBe(manualContent);
      }),
    );
  });

  it("writes when STANDARDS.md does not yet exist", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const { layer, getWrittenContent } = makeTestLayer([]);

        yield* Effect.provide(populateStandards("/project", ["AGENTS.md"]), layer);

        const content = getWrittenContent("/project/.ged/STANDARDS.md");
        expect(content).toContain("- [AGENTS.md](../AGENTS.md)");
      }),
    );
  });
});
