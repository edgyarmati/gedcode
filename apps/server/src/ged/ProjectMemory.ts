import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ProcessRunner from "../processRunner.ts";

/**
 * The Ged project memory: the `.ged/` tree a project keeps alongside its code.
 *
 * It holds the role briefs, the model policy, the standards, the decision log,
 * and the verdict records the land gate reads. Serving it through MCP is what
 * makes it available to every provider — a Codex worker and a Claude worker read
 * the same briefs, which is the whole point of keeping them on disk rather than
 * in one harness's prompt.
 *
 * Everything here is path-confined to `<root>/.ged`. Tool input names a document
 * by a relative key, never a path the caller composes.
 */

const MEMORY_DIR = ".ged";
const VERDICTS_DIR = "verdicts";
const GATE_SCRIPT = "bin/land-gate.sh";

/** Documents an agent may read. Anything outside this set is not memory. */
const READABLE_EXTENSIONS = new Set([".md", ".json"]);

/** Ceiling on a single document, so a stray large file cannot flood a context window. */
const MAX_DOCUMENT_BYTES = 256 * 1024;

export interface MemoryDocument {
  readonly key: string;
  readonly bytes: number;
}

export interface LandRuling {
  readonly allowed: boolean;
  /** `error` means the gate could not evaluate — an unusable ref, a detached HEAD. */
  readonly outcome: "allowed" | "blocked" | "error";
  readonly detail: string;
}

export class GedMemoryError extends Error {
  readonly _tag = "GedMemoryError";
  constructor(message: string) {
    super(message);
    this.name = "GedMemoryError";
  }
}

export class ProjectMemory extends Context.Service<
  ProjectMemory,
  {
    /** Whether this checkout carries a Ged memory tree at all. */
    readonly present: (root: string) => Effect.Effect<boolean>;
    readonly list: (root: string) => Effect.Effect<ReadonlyArray<MemoryDocument>, GedMemoryError>;
    readonly read: (root: string, key: string) => Effect.Effect<string, GedMemoryError>;
    readonly writeVerdict: (
      root: string,
      branch: string,
      record: unknown,
    ) => Effect.Effect<string, GedMemoryError>;
    readonly landCheck: (root: string) => Effect.Effect<LandRuling, GedMemoryError>;
  }
>()("t3/ged/ProjectMemory") {}

/**
 * A memory key is a relative path inside `.ged`. It is validated rather than
 * sanitised: a key that could escape the tree is rejected outright, so no
 * normalisation step can quietly turn a bad key into a readable one.
 */
const validateKey = (key: string): string | undefined => {
  if (key.length === 0 || key.length > 200) return "A memory key must be 1-200 characters.";
  if (key.startsWith("/") || key.includes("\\")) return "A memory key is a relative POSIX path.";
  if (key.includes("\0")) return "A memory key may not contain a null byte.";
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".."))
    return "A memory key may not contain empty, '.' or '..' segments.";
  if (!/^[A-Za-z0-9._/-]+$/.test(key))
    return "A memory key may contain only letters, digits, '.', '_', '-' and '/'.";
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || !READABLE_EXTENSIONS.has(key.slice(dot)))
    return "A memory document is a .md or .json file.";
  return undefined;
};

/**
 * The verdict filename the land gate looks for. This must stay identical to the
 * slug rule in `.ged/bin/land-gate.sh`; a divergence would let an agent write a
 * record the gate never reads, which fails open in the one place that matters.
 */
export const verdictSlug = (branch: string): string | undefined => {
  const slug = branch.replaceAll("/", "-");
  if (slug.length === 0 || slug.startsWith("-") || slug === "HEAD") return undefined;
  if (!/^[A-Za-z0-9._-]+$/.test(slug)) return undefined;
  if (slug.includes("..")) return undefined;
  return slug;
};

const make = Effect.fn("ged.ProjectMemory.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* ProcessRunner.ProcessRunner;

  const memoryRoot = (root: string) => path.join(root, MEMORY_DIR);

  const fail = (message: string) => Effect.fail(new GedMemoryError(message));

  const present = (root: string) =>
    fs.exists(memoryRoot(root)).pipe(Effect.orElseSucceed(() => false));

  /** Walks `.ged`, skipping `node_modules`-style noise and anything unreadable. */
  const walk = (
    dir: string,
    prefix: string,
  ): Effect.Effect<ReadonlyArray<MemoryDocument>, GedMemoryError> =>
    fs.readDirectory(dir).pipe(
      Effect.orElseSucceed((): ReadonlyArray<string> => []),
      Effect.flatMap((entries) =>
        Effect.forEach([...entries].sort(), (entry) =>
          Effect.gen(function* () {
            if (entry.startsWith(".")) return [] as ReadonlyArray<MemoryDocument>;
            const full = path.join(dir, entry);
            const key = prefix === "" ? entry : `${prefix}/${entry}`;
            const info = yield* fs.stat(full).pipe(Effect.orElseSucceed(() => undefined));
            if (info === undefined) return [];
            if (info.type === "Directory") return yield* walk(full, key);
            if (info.type !== "File") return [];
            if (validateKey(key) !== undefined) return [];
            return [{ key, bytes: Number(info.size) }];
          }),
        ),
      ),
      Effect.map((groups) => groups.flat()),
    );

  const list = (root: string) =>
    Effect.gen(function* () {
      if (!(yield* present(root)))
        return yield* fail(`This project has no ${MEMORY_DIR}/ memory tree.`);
      return yield* walk(memoryRoot(root), "");
    });

  const read = (root: string, key: string) =>
    Effect.gen(function* () {
      const problem = validateKey(key);
      if (problem !== undefined) return yield* fail(problem);
      const full = path.join(memoryRoot(root), key);
      // A symlink could point anywhere; the key check above does not cover it.
      const info = yield* fs
        .stat(full)
        .pipe(Effect.mapError(() => new GedMemoryError(`No memory document '${key}'.`)));
      if (info.type !== "File") return yield* fail(`'${key}' is not a readable document.`);
      if (Number(info.size) > MAX_DOCUMENT_BYTES)
        return yield* fail(
          `'${key}' is ${Number(info.size)} bytes; the limit is ${MAX_DOCUMENT_BYTES}.`,
        );
      return yield* fs
        .readFileString(full)
        .pipe(Effect.mapError(() => new GedMemoryError(`'${key}' could not be read.`)));
    });

  const writeVerdict = (root: string, branch: string, record: unknown) =>
    Effect.gen(function* () {
      const slug = verdictSlug(branch);
      if (slug === undefined)
        return yield* fail(`Branch '${branch}' has no name the land gate can key a verdict to.`);
      const dir = path.join(memoryRoot(root), VERDICTS_DIR);
      yield* fs
        .makeDirectory(dir, { recursive: true })
        .pipe(Effect.mapError(() => new GedMemoryError(`Could not open ${MEMORY_DIR}/verdicts.`)));
      const file = path.join(dir, `${slug}.json`);
      // The toolkit validated this record against its schema before handing it over. It is
      // written indented rather than through a codec because the gate reads it as a document
      // a human also opens and edits by hand.
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const body = `${JSON.stringify(record, null, 2)}\n`;
      yield* fs
        .writeFileString(file, body)
        .pipe(
          Effect.mapError(() => new GedMemoryError(`Could not write the verdict for ${slug}.`)),
        );
      return `${MEMORY_DIR}/${VERDICTS_DIR}/${slug}.json`;
    });

  /**
   * Runs the gate script rather than reimplementing its rules. One implementation
   * means the answer an agent gets here and the answer a pre-push hook gives are
   * the same answer, and cannot drift apart release by release.
   */
  const landCheck = (root: string) =>
    Effect.gen(function* () {
      const script = path.join(memoryRoot(root), GATE_SCRIPT);
      if (!(yield* fs.exists(script).pipe(Effect.orElseSucceed(() => false))))
        return yield* fail(`This project has no land gate at ${MEMORY_DIR}/${GATE_SCRIPT}.`);
      const output = yield* processes
        .run({
          command: "sh",
          args: [script],
          cwd: root,
          timeout: "30 seconds",
          maxOutputBytes: 64 * 1024,
          outputMode: "truncate",
        })
        .pipe(Effect.mapError(() => new GedMemoryError("The land gate could not be run.")));
      const detail = `${output.stdout}${output.stderr}`.trim();
      if (output.code === 0)
        return { allowed: true, outcome: "allowed", detail } satisfies LandRuling;
      if (output.code === 1)
        return { allowed: false, outcome: "blocked", detail } satisfies LandRuling;
      return { allowed: false, outcome: "error", detail } satisfies LandRuling;
    });

  return { present, list, read, writeVerdict, landCheck } as const;
});

// ProcessRunner is stateless over the spawner, so it is provided here rather than
// threaded through the MCP context, matching TerminalManager and PortScanner.
export const layer = Layer.effect(ProjectMemory, make()).pipe(Layer.provide(ProcessRunner.layer));
