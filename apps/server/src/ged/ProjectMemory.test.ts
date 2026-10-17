import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProjectMemory from "./ProjectMemory.ts";

// provideMerge so the tests themselves can use FileSystem and Path to build fixtures.
const layer = ProjectMemory.layer.pipe(Layer.provideMerge(NodeServices.layer));

/** A throwaway checkout with a `.ged` tree, torn down with the test's scope. */
const withProject = <A, E, R>(
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(path.join(root, ".ged", "roles"), { recursive: true });
    yield* fs.writeFileString(path.join(root, ".ged", "STANDARDS.md"), "# Standards\n");
    yield* fs.writeFileString(
      path.join(root, ".ged", "roles", "verifier.md"),
      "# Verifier\nYou rule on criteria.\n",
    );
    yield* fs.writeFileString(path.join(root, ".ged", "roles", "model-policy.md"), "# Policy\n");
    yield* fs.writeFileString(path.join(root, "secret.md"), "NOT MEMORY\n");
    return yield* use(root);
  }).pipe(Effect.scoped);

it.effect("lists the memory documents and reads one by key", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const memory = yield* ProjectMemory.ProjectMemory;
      const documents = yield* memory.list(root);
      expect(documents.map((document) => document.key).sort()).toEqual([
        "STANDARDS.md",
        "roles/model-policy.md",
        "roles/verifier.md",
      ]);
      const brief = yield* memory.read(root, "roles/verifier.md");
      expect(brief).toContain("You rule on criteria.");
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("refuses a key that would escape the memory tree", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const memory = yield* ProjectMemory.ProjectMemory;
      for (const key of [
        "../secret.md",
        "roles/../../secret.md",
        "/etc/hosts",
        "roles\\verifier.md",
        "./STANDARDS.md",
      ]) {
        const error = yield* Effect.flip(memory.read(root, key));
        expect(error._tag, `expected '${key}' to be refused`).toBe("GedMemoryError");
      }
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("refuses a document that is not .md or .json", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(path.join(root, ".ged", "run.sh"), "echo hi\n");
      const memory = yield* ProjectMemory.ProjectMemory;
      const error = yield* Effect.flip(memory.read(root, "run.sh"));
      expect(error.message).toContain(".md or .json");
      const documents = yield* memory.list(root);
      expect(documents.map((document) => document.key)).not.toContain("run.sh");
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("reports a project with no memory tree rather than inventing one", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const memory = yield* ProjectMemory.ProjectMemory;
    const present = yield* memory.present(root);
    expect(present).toBe(false);
    const error = yield* Effect.flip(memory.list(root));
    expect(error.message).toContain("no .ged/ memory tree");
  }).pipe(Effect.scoped, Effect.provide(layer)),
);

const ruling = (
  verifier: { driverKind: string; model?: string },
  overrides: { headSha?: string; status?: "pass" | "fail" } = {},
) => ({
  branch: "feat/memory-toolkit",
  headSha: overrides.headSha ?? "a".repeat(40),
  implementer: { driverKind: "codex" },
  review: {
    verifier,
    status: overrides.status ?? ("pass" as const),
    criteria: [{ criterion: "It works", verdict: "met" as const, evidence: "the tests pass" }],
    otherVendorAvailable: true,
  },
});

const readRecord = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const contents = yield* fs.readFileString(
      path.join(root, ".ged", "verdicts", "feat-memory-toolkit.json"),
    );
    return JSON.parse(contents) as {
      schemaVersion: number;
      headSha: string;
      reviews: ReadonlyArray<{ verifier: { driverKind: string }; status: string }>;
    };
  });

it.effect("records a ruling under the slug the land gate reads", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const memory = yield* ProjectMemory.ProjectMemory;
      const written = yield* memory.recordRuling(root, ruling({ driverKind: "claudeAgent" }));
      expect(written).toBe(".ged/verdicts/feat-memory-toolkit.json");
      const record = yield* readRecord(root);
      expect(record.schemaVersion).toBe(2);
      expect(record.reviews.map((review) => review.verifier.driverKind)).toEqual(["claudeAgent"]);
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("keeps every verifier's ruling on one commit, and restarts on a new one", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const memory = yield* ProjectMemory.ProjectMemory;
      // Parallel verifiers record at once; neither may lose the other's ruling.
      yield* Effect.all(
        [
          memory.recordRuling(root, ruling({ driverKind: "claudeAgent" })),
          memory.recordRuling(root, ruling({ driverKind: "codex", model: "gpt-6-sol" })),
        ],
        { concurrency: "unbounded" },
      );
      expect((yield* readRecord(root)).reviews).toHaveLength(2);

      // A verifier that rules again replaces its own earlier ruling.
      yield* memory.recordRuling(root, ruling({ driverKind: "claudeAgent" }, { status: "fail" }));
      const replaced = yield* readRecord(root);
      expect(replaced.reviews).toHaveLength(2);
      expect(replaced.reviews.find((r) => r.verifier.driverKind === "claudeAgent")?.status).toBe(
        "fail",
      );

      yield* memory.recordRuling(
        root,
        ruling({ driverKind: "claudeAgent" }, { headSha: "b".repeat(40) }),
      );
      const restarted = yield* readRecord(root);
      expect(restarted.headSha).toBe("b".repeat(40));
      expect(restarted.reviews).toHaveLength(1);
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("starts a corrupt or malformed record over instead of failing", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const memory = yield* ProjectMemory.ProjectMemory;
      const file = path.join(root, ".ged", "verdicts", "feat-memory-toolkit.json");
      yield* fs.makeDirectory(path.dirname(file), { recursive: true });
      const { branch, headSha, implementer } = ruling({ driverKind: "claudeAgent" });
      // Matches the next ruling's commit, so only the null review can force the restart.
      const malformed = JSON.stringify({
        schemaVersion: 2,
        branch,
        headSha,
        implementer,
        reviews: [null],
      });
      for (const contents of ["{ not json", malformed]) {
        yield* fs.writeFileString(file, contents);
        yield* memory.recordRuling(root, ruling({ driverKind: "claudeAgent" }));
        expect((yield* readRecord(root)).reviews).toHaveLength(1);
      }
    }),
  ).pipe(Effect.provide(layer)),
);

it.effect("refuses a branch name that cannot key a verdict", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const memory = yield* ProjectMemory.ProjectMemory;
      for (const branch of ["HEAD", "--version", "a/../../b", "wat?", ""]) {
        const error = yield* Effect.flip(
          memory.recordRuling(root, { ...ruling({ driverKind: "claudeAgent" }), branch }),
        );
        expect(error._tag, `expected branch '${branch}' to be refused`).toBe("GedMemoryError");
      }
    }),
  ).pipe(Effect.provide(layer)),
);

it("keeps the verdict slug identical to the land gate's rule", () => {
  // The gate maps a branch to a filename the same way. If these drift, an agent
  // writes a record the gate never looks for, and the gate fails open.
  expect(ProjectMemory.verdictSlug("feat/a/b")).toBe("feat-a-b");
  expect(ProjectMemory.verdictSlug("main")).toBe("main");
  expect(ProjectMemory.verdictSlug("HEAD")).toBeUndefined();
  expect(ProjectMemory.verdictSlug("-dash")).toBeUndefined();
  expect(ProjectMemory.verdictSlug("a b")).toBeUndefined();
});

it.effect("reports blocked when the gate refuses, and error when it cannot evaluate", () =>
  withProject((root) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const memory = yield* ProjectMemory.ProjectMemory;

      const missing = yield* Effect.flip(memory.landCheck(root));
      expect(missing.message, "no gate script").toContain("no land gate");

      const bin = path.join(root, ".ged", "bin");
      yield* fs.makeDirectory(bin, { recursive: true });
      const gate = path.join(bin, "land-gate.sh");

      yield* fs.writeFileString(gate, 'echo "nope" >&2\nexit 1\n');
      const blocked = yield* memory.landCheck(root);
      expect(blocked.allowed).toBe(false);
      expect(blocked.outcome).toBe("blocked");
      expect(blocked.detail).toContain("nope");

      yield* fs.writeFileString(gate, "exit 2\n");
      const errored = yield* memory.landCheck(root);
      expect(errored.outcome).toBe("error");

      yield* fs.writeFileString(gate, 'echo "ok"\n');
      const allowed = yield* memory.landCheck(root);
      expect(allowed.allowed).toBe(true);
      expect(allowed.outcome).toBe("allowed");
    }),
  ).pipe(Effect.provide(layer)),
);
